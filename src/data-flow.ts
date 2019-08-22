import * as ast from './python-parser';
import { Block, ControlFlowGraph } from './control-flow';
import { Set, StringSet } from './set';
import { DefaultSpecs, JsonSpecs, FunctionSpec, TypeSpec } from './specs';
import { SymbolTable } from './symbol-table';


class DefUse {
  constructor(
    public DEFINITION = new RefSet(),
    public UPDATE = new RefSet(),
    public USE = new RefSet()
  ) { }

  public get defs() { return this.DEFINITION.union(this.UPDATE); }

  public union(that: DefUse) {
    return new DefUse(
      this.DEFINITION.union(that.DEFINITION),
      this.UPDATE.union(that.UPDATE),
      this.USE.union(that.USE));
  }

  public update(newRefs: DefUse) {

    const GEN_RULES = {
      USE: [ReferenceType.UPDATE, ReferenceType.DEFINITION],
      UPDATE: [ReferenceType.DEFINITION],
      DEFINITION: []
    };

    const KILL_RULES = {
      // Which types of references "kill" which other types of references?
      // In general, the rule of thumb here is, if x depends on y, x kills y, because anything that
      // depends on x will now depend on y transitively.
      // If x overwrites y, x also kills y.
      // The one case where a variable doesn't kill a previous variable is the global configuration, because
      // it neither depends on initializations or updates, nor clobbers them.
      DEFINITION: [ReferenceType.DEFINITION, ReferenceType.UPDATE],
      UPDATE: [ReferenceType.DEFINITION, ReferenceType.UPDATE],
      USE: []
    };

    for (let level of Object.keys(ReferenceType)) {

      let genSet = new RefSet();
      for (let genLevel of GEN_RULES[level]) {
        genSet = genSet.union(newRefs[genLevel]);
      }
      const killSet = this[level].filter(def =>
        genSet.items.some(gen =>
          gen.name == def.name && KILL_RULES[gen.level].indexOf(def.level) != -1));

      this[level] = this[level].minus(killSet).union(genSet);
    }
  }

  public equals(that: DefUse) {
    return this.DEFINITION.equals(that.DEFINITION) &&
      this.UPDATE.equals(that.UPDATE) &&
      this.USE.equals(that.USE);
  }

}


/**
 * Use a shared dataflow analyzer object for all dataflow analysis / querying for defs and uses.
 * It caches defs and uses for each statement, which can save time.
 * For caching to work, statements must be annotated with a cell's ID and execution count.
 */
export class DataflowAnalyzer {
  constructor(moduleMap?: JsonSpecs) {
    this._specs = moduleMap || DefaultSpecs;
  }

  getDefUseForStatement(statement: ast.SyntaxNode, defsForMethodResolution: RefSet, symbolTable?: SymbolTable): DefUse {
    symbolTable = symbolTable || new SymbolTable(this._specs);

    let cacheKey = ast.locationString(statement.location);
    const cached = this._defUsesCache[cacheKey];
    if (cached) { return cached; }

    let defSet = this.getDefs(statement, symbolTable, defsForMethodResolution);
    let useSet = this.getUses(statement, symbolTable);
    let result = new DefUse(
      defSet.filter(r => r.level === ReferenceType.DEFINITION),
      defSet.filter(r => r.level === ReferenceType.UPDATE),
      useSet
    );
    this._defUsesCache[cacheKey] = result;
    return result;
  }

  analyze(cfg: ControlFlowGraph, moduleMap?: JsonSpecs, namesDefined?: StringSet): DataflowAnalysisResult {
    let symbolTable = new SymbolTable(moduleMap || DefaultSpecs);
    const workQueue: Block[] = cfg.blocks.reverse();
    let undefinedRefs = new RefSet();
    let dataflows = new Set<Dataflow>(getDataflowId);
    let defUsePerBlock = new Map(workQueue.map(block => [block.id, new DefUse()]));

    while (workQueue.length) {
      const block = workQueue.pop();
      let oldBlockDefUse = defUsePerBlock.get(block.id);
      let blockDefUse = cfg.getPredecessors(block)
        .reduce((defuse, predBlock) => defuse.union(defUsePerBlock.get(predBlock.id)), oldBlockDefUse);

      for (let statement of block.statements) {
        let statementDefUse = this.getDefUseForStatement(statement, blockDefUse.defs, symbolTable);
        let [newFlows, definedRefs] = createFlowsFrom(statementDefUse, blockDefUse, statement);
        dataflows = dataflows.union(newFlows);
        undefinedRefs = undefinedRefs.union(statementDefUse.UPDATE).union(statementDefUse.USE).minus(definedRefs);
        blockDefUse.update(statementDefUse);
      }

      if (!oldBlockDefUse.equals(blockDefUse)) {
        defUsePerBlock.set(block.id, blockDefUse);
        // We've updated this block's info, so schedule its successor blocks.
        for (let succ of cfg.getSuccessors(block)) {
          if (workQueue.indexOf(succ) < 0) {
            workQueue.push(succ);
          }
        }
      }
    }

    if (namesDefined) {
      undefinedRefs = undefinedRefs.filter(r => !namesDefined.contains(r.name));
    }

    return { dataflows, undefinedRefs };
  }

  getDefs(statement: ast.SyntaxNode, symbolTable: SymbolTable, defsForMethodResolution: RefSet): RefSet {
    if (!statement) return new RefSet();

    let defs = runAnalysis(ApiCallAnalysis, defsForMethodResolution, statement, symbolTable)
      .union(runAnalysis(DefAnnotationAnalysis, defsForMethodResolution, statement, symbolTable));

    switch (statement.type) {
      case ast.IMPORT:
        defs = defs.union(this.getImportDefs(statement, symbolTable));
        break;
      case ast.FROM:
        defs = defs.union(this.getImportFromDefs(statement, symbolTable));
        break;
      case ast.DEF:
        defs = defs.union(this.getFuncDefs(statement));
        break;
      case ast.CLASS:
        defs = defs.union(this.getClassDefs(statement));
        break;
      case ast.ASSIGN:
        defs = defs.union(this.getAssignDefs(statement, symbolTable));
        break;
    }
    return defs;
  }

  private getClassDefs(classDecl: ast.Class) {
    return new RefSet({
      type: SymbolType.CLASS,
      level: ReferenceType.DEFINITION,
      name: classDecl.name,
      location: classDecl.location,
      statement: classDecl,
    });
  }

  private getFuncDefs(funcDecl: ast.Def) {
    return new RefSet({
      type: SymbolType.FUNCTION,
      level: ReferenceType.DEFINITION,
      name: funcDecl.name,
      location: funcDecl.location,
      statement: funcDecl,
    });
  }

  private getAssignDefs(assign: ast.Assignment, symbolTable: SymbolTable) {
    let targetsDefListener = new TargetsDefListener(assign, symbolTable);
    return targetsDefListener.defs;
  }

  private getImportFromDefs(from: ast.From, symbolTable: SymbolTable) {
    symbolTable.importModuleDefinitions(from.base, from.imports);
    return new RefSet(...from.imports.map(i => {
      return {
        type: SymbolType.IMPORT,
        level: ReferenceType.DEFINITION,
        name: i.name || i.path,
        location: i.location,
        statement: from,
      };
    }));
  }

  private getImportDefs(imprt: ast.Import, symbolTable: SymbolTable) {
    imprt.names.forEach(imp => {
      const spec = symbolTable.importModule(imp.path, imp.name);
    });
    return new RefSet(...imprt.names.map(nameNode => {
      return {
        type: SymbolType.IMPORT,
        level: ReferenceType.DEFINITION,
        name: nameNode.name || nameNode.path,
        location: nameNode.location,
        statement: imprt,
      };
    }));
  }

  getUses(statement: ast.SyntaxNode, symbolTable: SymbolTable): RefSet {
    switch (statement.type) {
      case ast.ASSIGN:
        return this.getAssignUses(statement);
      case ast.DEF:
        return this.getFuncDeclUses(statement);
      case ast.CLASS:
        return this.getClassDeclUses(statement, symbolTable);
      default: {
        return this.getNameUses(statement);
      }
    }
  }

  private getNameUses(statement: ast.SyntaxNode) {
    const usedNames = gatherNames(statement);
    return new RefSet(...usedNames.items.map(([name, node]) => {
      return {
        type: SymbolType.VARIABLE,
        level: ReferenceType.USE,
        name: name,
        location: node.location,
        statement: statement,
      };
    }));
  }

  private getClassDeclUses(statement: ast.Class, symbolTable: SymbolTable) {
    return statement.code.reduce((uses, classStatement) =>
      uses.union(this.getUses(classStatement, symbolTable)),
      new RefSet());
  }

  private getFuncDeclUses(statement: ast.Def) {
    let defCfg = new ControlFlowGraph(statement);
    let argNames = new StringSet(...statement.params.map(p => p.name).filter(n => n != undefined));
    let undefinedRefs = this.analyze(defCfg, this._specs, argNames).undefinedRefs;
    return undefinedRefs.filter(r => r.level == ReferenceType.USE);
  }

  private getAssignUses(statement: ast.Assignment) {
    // XXX: Is this supposed to union with funcArgs?
    const targetNames = gatherNames(statement.targets);
    const targets = new RefSet(...targetNames.items.map(([name, node]) => {
      return {
        type: SymbolType.VARIABLE,
        level: ReferenceType.USE,
        name: name,
        location: node.location,
        statement: statement,
      };
    }));
    const sourceNames = gatherNames(statement.sources);
    const sources = new RefSet(...sourceNames.items.map(([name, node]) => {
      return {
        type: SymbolType.VARIABLE,
        level: ReferenceType.USE,
        name: name,
        location: node.location,
        statement: statement,
      };
    }));
    return sources.union(statement.op ? targets : new RefSet());
  }

  private _specs: JsonSpecs;
  private _defUsesCache: { [statementLocation: string]: DefUse } = {};
}


export interface Dataflow {
  fromNode: ast.SyntaxNode;
  toNode: ast.SyntaxNode;
}


export enum ReferenceType {
  DEFINITION = 'DEFINITION',
  UPDATE = 'UPDATE',
  USE = 'USE',
}


export enum SymbolType {
  VARIABLE,
  CLASS,
  FUNCTION,
  IMPORT,
  MUTATION,
  MAGIC,
}


export interface Ref {
  type: SymbolType;
  level: ReferenceType;
  name: string;
  inferredType?: TypeSpec<FunctionSpec>;
  location: ast.Location;
  statement: ast.SyntaxNode;
}


export class RefSet extends Set<Ref> {
  constructor(...items: Ref[]) {
    super(r => r.name + r.level + ast.locationString(r.location), ...items);
  }
}


export function sameLocation(loc1: ast.Location, loc2: ast.Location): boolean {
  return (
    loc1.first_column === loc2.first_column &&
    loc1.first_line === loc2.first_line &&
    loc1.last_column === loc2.last_column &&
    loc1.last_line === loc2.last_line
  );
}

function getNameSetId([name, node]: [string, ast.SyntaxNode]) {
  if (!node.location) console.log('***', node);
  return `${name}@${ast.locationString(node.location)}`;
}

class NameSet extends Set<[string, ast.SyntaxNode]> {
  constructor(...items: [string, ast.SyntaxNode][]) {
    super(getNameSetId, ...items);
  }
}

function gatherNames(node: ast.SyntaxNode | ast.SyntaxNode[]): NameSet {
  if (Array.isArray(node)) {
    return new NameSet().union(...node.map(gatherNames));
  } else {
    return new NameSet(
      ...ast
        .walk(node)
        .filter(e => e.type == ast.NAME)
        .map((e: ast.Name): [string, ast.SyntaxNode] => [e.id, e])
    );
  }
}



abstract class AnalysisWalker implements ast.WalkListener {
  readonly defs: RefSet = new RefSet();
  constructor(protected _statement: ast.SyntaxNode, protected symbolTable: SymbolTable) { }
  abstract onEnterNode?(node: ast.SyntaxNode, type: string, ancestors: ast.SyntaxNode[]);
}

function runAnalysis(
  Analysis: new (statement: ast.SyntaxNode, symbolTable: SymbolTable, defsForMethodResolution: RefSet) => AnalysisWalker,
  defsForMethodResolution: RefSet,
  statement: ast.SyntaxNode,
  symbolTable: SymbolTable
) {
  const walker = new Analysis(statement, symbolTable, defsForMethodResolution);
  ast.walk(statement, walker);
  return walker.defs;
}


/**
 * Tree walk listener for collecting manual def annotations.
 */
class DefAnnotationAnalysis extends AnalysisWalker {
  constructor(statement: ast.SyntaxNode, symbolTable: SymbolTable) {
    super(statement, symbolTable);
  }

  onEnterNode(node: ast.SyntaxNode, type: string) {
    if (type == ast.LITERAL) {
      let literal = node as ast.Literal;

      // If this is a string, try to parse a def annotation from it
      if (typeof literal.value == 'string' || literal.value instanceof String) {
        let string = literal.value;
        let jsonMatch = string.match(/"defs: (.*)"/);
        if (jsonMatch && jsonMatch.length >= 2) {
          let jsonString = jsonMatch[1];
          let jsonStringUnescaped = jsonString.replace(/\\"/g, '"');
          try {
            let defSpecs = JSON.parse(jsonStringUnescaped);
            for (let defSpec of defSpecs) {
              this.defs.add({
                type: SymbolType.MAGIC,
                level: ReferenceType.DEFINITION,
                name: defSpec.name,
                location: {
                  first_line: defSpec.pos[0][0] + node.location.first_line,
                  first_column: defSpec.pos[0][1],
                  last_line: defSpec.pos[1][0] + node.location.first_line,
                  last_column: defSpec.pos[1][1],
                },
                statement: this._statement,
              });
            }
          } catch (e) { }
        }
      }
    }
  }
}




/**
 * Tree walk listener for collecting names used in function call.
 */
class ApiCallAnalysis extends AnalysisWalker {

  constructor(statement: ast.SyntaxNode, symbolTable: SymbolTable, private variableDefs: RefSet) {
    super(statement, symbolTable);
  }

  onEnterNode(node: ast.SyntaxNode, type: string, ancestors: ast.SyntaxNode[]) {
    if (node.type !== ast.CALL) { return; }

    let funcSpec: FunctionSpec;
    const func = node.func;
    if (func.type === ast.DOT && func.value.type === ast.NAME) {
      // It's a method call or module call.
      const receiver = func.value;
      const moduleSpec = this.symbolTable.modules[receiver.id];
      if (moduleSpec) {
        // It's a module call.
        funcSpec = moduleSpec.functions.find(f => f.name === func.name);
      } else {
        // It's a method call.
        const ref = this.variableDefs.items.find(r => r.name === receiver.id);
        if (ref) {
          // The lefthand side of the dot is a variable we're tracking, so it's a method call.
          const receiverType = ref.inferredType;
          if (receiverType) {
            const funcName: string = func.name;
            funcSpec = receiverType.methods.find(m => m.name === funcName);
          }
        }
      }
    } else if (func.type === ast.NAME) {
      // It's a function call.
      funcSpec = this.symbolTable.lookupFunction(func.id);
    }

    if (funcSpec && funcSpec.updates) {
      Object.keys(funcSpec.updates).forEach(paramName => {
        const position = parseInt(paramName);
        if (isNaN(position)) { return; } // TODO: think about mutation of global variables
        let actualArgName: string;
        if (0 < position && position - 1 < node.args.length) {
          const arg = node.args[position - 1].actual;
          if (arg.type === ast.NAME) { actualArgName = arg.id; }
        } else if (position === 0 && node.func.type === ast.DOT && node.func.value.type === ast.NAME) {
          actualArgName = node.func.value.id;
        }
        if (actualArgName) {
          this.defs.add({
            type: SymbolType.MUTATION,
            level: ReferenceType.UPDATE,
            name: actualArgName,
            location: node.location,
            statement: this._statement,
          });
        }
      });
    } else {
      // Be conservative. If we don't know what the call does, assume that it mutates its arguments.
      node.args.forEach(arg => {
        if (arg.actual.type === ast.NAME) {
          const name = arg.actual.id;
          this.defs.add({
            type: SymbolType.MUTATION,
            level: ReferenceType.UPDATE,
            name: name,
            location: node.location,
            statement: this._statement,
          });
        }
      });
      if (node.func.type === ast.DOT && node.func.value.type === ast.NAME) {
        const name = node.func.value.id;
        this.defs.add({
          type: SymbolType.MUTATION,
          level: ReferenceType.UPDATE,
          name: name,
          location: node.location,
          statement: this._statement,
        });
      }
    }

  }
}



/**
 * Tree walk listener for collecting definitions in the target of an assignment.
 */
class TargetsDefListener extends AnalysisWalker {
  private isAugAssign: boolean;

  constructor(assign: ast.Assignment, symbolTable: SymbolTable) {
    super(assign, symbolTable);
    this.isAugAssign = !!assign.op;
    if (assign.targets) {
      for (let target of assign.targets) {
        ast.walk(target, this);
      }
    }
    assign.sources.forEach((source, i) => {
      if (source.type === ast.CALL) {
        const func = source.func;
        const spec = func.type === ast.NAME ? symbolTable.lookupFunction(func.id) :
          func.type === ast.DOT && func.value.type === ast.NAME ? symbolTable.lookupModuleFunction(func.value.id, func.name)
            : undefined;
        if (spec && assign.targets[i]) {
          const target = assign.targets[i];
          if (target.type === ast.NAME) {
            const def = this.defs.items.find(d => d.name === target.id);
            if (def) {
              def.inferredType = spec.returnsType;
            }
          }
        }
      }
    });
  }

  onEnterNode(target: ast.SyntaxNode, type: string, ancestors: ast.SyntaxNode[]) {
    if (type == ast.NAME) {
      const isUpdate = this.isAugAssign || ancestors.some(a => a.type == ast.DOT || a.type == ast.INDEX);
      this.defs.add({
        type: SymbolType.VARIABLE,
        level: isUpdate ? ReferenceType.UPDATE : ReferenceType.DEFINITION,
        location: target.location,
        name: (target as ast.Name).id,
        statement: this._statement,
      });
    }
  }
}




function getDataflowId(df: Dataflow) {
  if (!df.fromNode.location) { console.log('*** FROM', df.fromNode, df.fromNode.location); }
  if (!df.toNode.location) { console.log('*** TO', df.toNode, df.toNode.location); }
  return `${ast.locationString(df.fromNode.location)}->${ast.locationString(df.toNode.location)}`;
}



function createFlowsFrom(fromSet: DefUse, toSet: DefUse, fromStatement: ast.SyntaxNode): [Set<Dataflow>, Set<Ref>] {
  let refsDefined = new RefSet();
  let newFlows = new Set<Dataflow>(getDataflowId);
  for (let level of Object.keys(ReferenceType)) {
    for (let from of fromSet[level].items) {
      for (let to of toSet[level].items) {
        if (to.name == from.name) {
          refsDefined.add(from);
          newFlows.add({ fromNode: to.statement, toNode: fromStatement });
        }
      }
    }
  }
  return [newFlows, refsDefined];
}


export type DataflowAnalysisResult = {
  dataflows: Set<Dataflow>;
  undefinedRefs: RefSet;
};
