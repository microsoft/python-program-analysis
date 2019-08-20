import * as ast from './python-parser';
import { Block, ControlFlowGraph } from './control-flow';
import { Set, StringSet } from './set';
import { GlobalModuleMap, JsonSpecs, FunctionSpec, TypeSpec, ModuleSpec, FunctionDescription } from './specs';
import { SymbolTable } from './symbol-table';
import { symbol } from 'prop-types';

/**
 * Use a shared dataflow analyzer object for all dataflow analysis / querying for defs and uses.
 * It caches defs and uses for each statement, which can save time.
 * For caching to work, statements must be annotated with a cell's ID and execution count.
 */
export class DataflowAnalyzer {
  constructor(moduleMap?: JsonSpecs) {
    this._specs = moduleMap || GlobalModuleMap;
  }

  getDefsUses(
    statement: ast.SyntaxNode,
    symbolTable?: SymbolTable
  ): IDefUseInfo {
    symbolTable = symbolTable || new SymbolTable(this._specs);

    let cacheKey = ast.locationString(statement.location);
    const cached = this._defUsesCache[cacheKey];
    if (cached) { return cached; }

    let defSet = this.getDefs(statement, symbolTable, new RefSet());
    let useSet = this.getUses(statement, symbolTable);
    let result = { defs: defSet, uses: useSet };
    this._defUsesCache[cacheKey] = result;
    return result;
  }

  // tslint:disable-next-line: max-func-body-length
  analyze(
    cfg: ControlFlowGraph,
    moduleMap?: JsonSpecs,
    namesDefined?: StringSet
  ): DataflowAnalysisResult {
    moduleMap = moduleMap || GlobalModuleMap;
    let symbolTable = new SymbolTable(moduleMap);
    const workQueue: Block[] = cfg.blocks.reverse();
    let undefinedRefs = new RefSet();

    let defsForLevelByBlock: {
      [level: string]: { [blockId: number]: RefSet };
    } = {};
    for (let level of Object.keys(ReferenceType)) {
      defsForLevelByBlock[level] = {};
      for (let block of workQueue) {
        defsForLevelByBlock[level][block.id] = new RefSet();
      }
    }

    let dataflows = new Set<Dataflow>(getDataflowId);

    while (workQueue.length) {
      const block = workQueue.pop();

      let oldDefsForLevel: { [level: string]: RefSet } = {};
      let defsForLevel: { [level: string]: RefSet } = {};
      for (let level of Object.keys(ReferenceType)) {
        oldDefsForLevel[level] = defsForLevelByBlock[level][block.id];
        // incoming definitions are come from predecessor blocks
        defsForLevel[level] = oldDefsForLevel[level].union(
          ...cfg
            .getPredecessors(block)
            .map(block => defsForLevelByBlock[level][block.id])
            .filter(s => s != undefined)
        );
      }

      // TODO: fix up dataflow computation within this block: check for definitions in
      // defsWithinBlock first; if found, don't look to defs that come from the predecessor.
      for (let statement of block.statements) {
        // Note that defs includes both definitions and mutations and variables
        let { defs: definedHere, uses: usedHere } = this.getDefsUses(
          statement,
          symbolTable
        );

        // Sort definitions and uses into references.
        let statementRefs: { [level: string]: RefSet } = {};
        for (let level of Object.keys(ReferenceType)) {
          statementRefs[level] = new RefSet();
        }
        for (let def of definedHere.items) {
          statementRefs[def.level].add(def);
          if (TYPES_WITH_DEPENDENCIES.indexOf(def.level) != -1) {
            undefinedRefs.add(def);
          }
        }
        for (let use of usedHere.items) {
          statementRefs[ReferenceType.USE].add(use);
          undefinedRefs.add(use);
        }

        // Get all new dataflow dependencies.
        let newFlows = new Set<Dataflow>(getDataflowId);
        for (let level of Object.keys(ReferenceType)) {
          // For everything that's defined coming into this block, if it's used in this block, save connection.
          let result = createFlowsFrom(
            statementRefs[level],
            defsForLevel[level],
            statement
          );
          let flowsCreated = result[0].items;
          let defined = result[1];
          newFlows.add(...flowsCreated);
          for (let ref of defined.items) {
            undefinedRefs.remove(ref);
          }
        }
        dataflows = dataflows.union(newFlows);

        for (let level of Object.keys(ReferenceType)) {
          // 🙄 it doesn't really make sense to update the "use" set for a block but whatever
          defsForLevel[level] = updateDefsForLevel(
            defsForLevel[level],
            level,
            statementRefs
          );
        }
      }

      // Check to see if definitions have changed. If so, redo the successor blocks.
      for (let level of Object.keys(ReferenceType)) {
        if (!oldDefsForLevel[level].equals(defsForLevel[level])) {
          defsForLevelByBlock[level][block.id] = defsForLevel[level];
          for (let succ of cfg.getSuccessors(block)) {
            if (workQueue.indexOf(succ) < 0) {
              workQueue.push(succ);
            }
          }
        }
      }
    }

    // Check to see if any of the undefined names were defined coming into the graph. If so,
    // don't report them as being undefined.
    if (namesDefined) {
      for (let ref of undefinedRefs.items) {
        if (namesDefined.items.some(n => n == ref.name)) {
          undefinedRefs.remove(ref);
        }
      }
    }

    return {
      flows: dataflows,
      undefinedRefs: undefinedRefs,
    };
  }

  getDefs(statement: ast.SyntaxNode, symbolTable: SymbolTable, previousDefs: RefSet): RefSet {
    if (!statement) return previousDefs;

    runAnalysis(ApiCallAnalysis, previousDefs, statement, symbolTable);
    runAnalysis(DefAnnotationAnalysis, previousDefs, statement, symbolTable);

    switch (statement.type) {
      case ast.IMPORT: {
        this.getImportDefs(statement, previousDefs, symbolTable);
        break;
      }
      case ast.FROM: {
        this.getImportFromDefs(statement, previousDefs, symbolTable);
        break;
      }
      case ast.ASSIGN: {
        previousDefs = this.getAssignDefs(statement, previousDefs, symbolTable);
        break;
      }
      case ast.DEF: {
        this.getFuncDefs(statement, previousDefs, symbolTable);
        break;
      }
      case ast.CLASS: {
        this.getClassDefs(statement, previousDefs, symbolTable);
        break;
      }
    }
    return previousDefs;
  }

  private getClassDefs(classDecl: ast.Class, defs: RefSet, symbolTable: SymbolTable) {
    defs.add({
      type: SymbolType.CLASS,
      level: ReferenceType.DEFINITION,
      name: classDecl.name,
      location: classDecl.location,
      statement: classDecl,
    });
  }

  private getFuncDefs(funcDecl: ast.Def, defs: RefSet, symbolTable: SymbolTable) {
    defs.add({
      type: SymbolType.FUNCTION,
      level: ReferenceType.DEFINITION,
      name: funcDecl.name,
      location: funcDecl.location,
      statement: funcDecl,
    });
  }

  private getAssignDefs(assign: ast.Assignment, defs: RefSet, symbolTable: SymbolTable) {
    let targetsDefListener = new TargetsDefListener(assign, symbolTable);
    defs = defs.union(targetsDefListener.defs);
    return defs;
  }

  private getImportFromDefs(from: ast.From, defs: RefSet, symbolTable: SymbolTable) {
    let modnames: string[] = [];
    if (from.imports.constructor === Array) {
      defs.add(...from.imports.map(i => {
        return {
          type: SymbolType.IMPORT,
          level: ReferenceType.DEFINITION,
          name: i.name || i.path,
          location: i.location,
          statement: from,
        };
      }));
      symbolTable.importModuleDefinitions(from.base, from.imports);
    }
  }

  private getImportDefs(imprt: ast.Import, defs: RefSet, symbolTable: SymbolTable) {
    imprt.names.forEach(imp => {
      const spec = symbolTable.importModule(imp.path);
    });
    defs.add(...imprt.names.map(nameNode => {
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
    let uses = new RefSet();
    switch (statement.type) {
      // TODO: should we collect when importing with FROM from something else that was already imported...
      case ast.ASSIGN: {
        uses = this.getAssignUses(statement, uses);
        break;
      }
      case ast.DEF:
        uses = this.getFuncDeclUses(statement, uses);
        break;
      case ast.CLASS:
        this.getClassDeclUses(statement, uses, symbolTable);
        break;
      default: {
        uses = this.getNameUses(statement, uses);
        break;
      }
    }

    return uses;
  }

  private getNameUses(statement: ast.SyntaxNode, uses: RefSet) {
    const usedNames = gatherNames(statement);
    uses = new RefSet(...usedNames.items.map(([name, node]) => {
      return {
        type: SymbolType.VARIABLE,
        level: ReferenceType.USE,
        name: name,
        location: node.location,
        statement: statement,
      };
    }));
    return uses;
  }

  private getClassDeclUses(statement: ast.Class, uses: RefSet, symbolTable: SymbolTable) {
    statement.code.forEach(classStatement => uses.add(...this.getUses(classStatement, symbolTable).items));
  }

  private getFuncDeclUses(statement: ast.Def, uses: RefSet) {
    let defCfg = new ControlFlowGraph(statement);
    let argNames = new StringSet(...statement.params.map(p => p.name).filter(n => n != undefined));
    let undefinedRefs = this.analyze(defCfg, this._specs, argNames).undefinedRefs;
    uses = undefinedRefs.filter(r => r.level == ReferenceType.USE);
    return uses;
  }

  private getAssignUses(statement: ast.Assignment, uses: RefSet) {
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
    uses = uses.union(sources).union(statement.op ? targets : new RefSet());
    return uses;
  }

  private _specs: JsonSpecs;
  private _defUsesCache: { [statementLocation: string]: IDefUseInfo } = {};
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
  inferredType?: string;
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




interface IDefUseInfo {
  defs: RefSet;
  uses: RefSet;
}


abstract class AnalysisWalker implements ast.WalkListener {
  readonly defs: RefSet = new RefSet();
  constructor(protected _statement: ast.SyntaxNode, protected symbolTable: SymbolTable) { }

  onEnterNode?(node: ast.SyntaxNode, type: string, ancestors: ast.SyntaxNode[]) {

  }
}

function runAnalysis<T extends AnalysisWalker>(
  Analysis: new (statement: ast.SyntaxNode, symbolTable: SymbolTable, refSet: RefSet) => T,
  refSet: RefSet, statement: ast.SyntaxNode, symbolTable: SymbolTable) {
  const walker = new Analysis(statement, symbolTable, refSet);
  ast.walk(statement, walker);
  refSet.add(...walker.defs.items);
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

  constructor(statement: ast.SyntaxNode, symbolTable: SymbolTable, private refSet: RefSet) {
    super(statement, symbolTable);
  }

  onEnterNode(node: ast.SyntaxNode, type: string, ancestors: ast.SyntaxNode[]) {
    if (node.type !== ast.CALL) { return; }

    let spec: FunctionSpec;
    const func = node.func;
    if (func.type === ast.DOT && func.value.type === ast.NAME) {
      // It's a method call.
      const receiver = func.value;
      const ref = this.refSet.items.find(r => r.name === receiver.id);
      if (ref) {
        const receiverType = ref.inferredType;
        if (receiverType) {
          const funcName: string = func.name;
          spec = this.symbolTable.types[receiverType].methods.find(m => m.name === funcName);
        }
      }
    } else if (func.type === ast.NAME) {
      // It's a function call.
      spec = this.symbolTable.functions[func.id];
    }

    if (spec) {
      Object.keys(spec).forEach(paramName => {
        const position = parseInt(paramName);
        if (position === NaN) { return; } // TODO: think about mutation of global variables
        let name: string;
        if (0 < position && position - 1 < node.args.length) {
          const arg = node.args[position - 1].actual;
          if (arg.type === ast.NAME) { name = arg.id; }
        } else if (position === 0 && node.func.type === ast.DOT && node.func.value.type === ast.NAME) {
          name = node.func.value.id;
        }
        if (name) {
          this.defs.add({
            type: SymbolType.MUTATION,
            level: ReferenceType.UPDATE,
            name: name,
            location: node.location,
            statement: this._statement,
          });
        }
      });
    } else {
      // Be conservative. If we don't know what the call does, 
      // assume that it mutates its arguments.
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
      if (source.type === ast.CALL && source.func.type === ast.NAME) {
        const spec = symbolTable.getFunction(source.func.id);
        if (spec && assign.targets[i]) {
          const target = assign.targets[i];
          if (target.type === ast.NAME) {
            const def = this.defs.items.find(d => d.name === target.id);
            if (def) {
              def.inferredType = spec.returns;
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
  if (!df.fromNode.location)
    console.log('*** FROM', df.fromNode, df.fromNode.location);
  if (!df.toNode.location) console.log('*** TO', df.toNode, df.toNode.location);
  return `${ast.locationString(df.fromNode.location)}->${ast.locationString(df.toNode.location)}`;
}



function createFlowsFrom(fromSet: RefSet, toSet: RefSet, fromStatement: ast.SyntaxNode): [Set<Dataflow>, Set<Ref>] {
  let refsDefined = new RefSet();
  let newFlows = new Set<Dataflow>(getDataflowId);
  for (let from of fromSet.items) {
    for (let to of toSet.items) {
      if (to.name == from.name) {
        refsDefined.add(from);
        newFlows.add({ fromNode: to.statement, toNode: fromStatement });
      }
    }
  }
  return [newFlows, refsDefined];
}



let DEPENDENCY_RULES = [
  // "from" depends on all reference types in "to"
  {
    from: ReferenceType.USE,
    to: [ReferenceType.UPDATE, ReferenceType.DEFINITION],
  },
  {
    from: ReferenceType.UPDATE,
    to: [ReferenceType.DEFINITION],
  },
];

let TYPES_WITH_DEPENDENCIES = DEPENDENCY_RULES.map(r => r.from);

let KILL_RULES = [
  // Which types of references "kill" which other types of references?
  // In general, the rule of thumb here is, if x depends on y, x kills y, because anything that
  // depends on x will now depend on y transitively.
  // If x overwrites y, x also kills y.
  // The one case where a variable doesn't kill a previous variable is the global configuration, because
  // it neither depends on initializations or updates, nor clobbers them.
  {
    level: ReferenceType.DEFINITION,
    kills: [ReferenceType.DEFINITION, ReferenceType.UPDATE],
  },
  {
    level: ReferenceType.UPDATE,
    kills: [ReferenceType.DEFINITION, ReferenceType.UPDATE],
  },
];



function updateDefsForLevel(
  defsForLevel: RefSet,
  level: string,
  newRefs: { [level: string]: RefSet }
) {
  let genSet = new RefSet();
  let levelDependencies = DEPENDENCY_RULES.find(r => r.from == level);
  for (let level of Object.keys(ReferenceType)) {
    newRefs[level].items.forEach(ref => {
      if (levelDependencies && levelDependencies.to.indexOf(ref.level) != -1) {
        genSet.add(ref);
      }
    });
  }
  const killSet = defsForLevel.filter(def => {
    let found = false;
    genSet.items.forEach(gen => {
      if (gen.name == def.name) {
        let killRules = KILL_RULES.find(r => r.level == gen.level);
        if (killRules && killRules.kills.indexOf(def.level) != -1) {
          found = true;
        }
      }
    });
    return found;
  });
  return defsForLevel.minus(killSet).union(genSet);
}


export type DataflowAnalysisResult = {
  flows: Set<Dataflow>;
  undefinedRefs: RefSet;
};
