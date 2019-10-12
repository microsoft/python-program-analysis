import { Cell } from './cell';
import * as ast from './python-parser';
import { DataflowAnalyzer, Ref, RefSet } from './data-flow';
import { MagicsRewriter } from './rewrite-magics';
import { Set, NumberSet, StringSet } from './set';
import { Graph } from './graph';

/**
 * Maps to find out what line numbers over a program correspond to what cells.
 */
export type CellToLineMap = { [cellExecutionEventId: string]: NumberSet };
export type LineToCellMap = { [line: number]: Cell };


const magicsRewriter: MagicsRewriter = new MagicsRewriter();

/**
 * A program built from cells.
 */
export class Program {
  /**
   * Construct a program.
   */
  constructor(cellPrograms: CellProgram[]) {
    let currentLine = 1;
    this.tree = { code: [], type: ast.MODULE };

    cellPrograms.forEach(cp => {
      let cell = cp.cell;

      // Build a mapping from the cells to their lines.
      let cellLength = cell.text.split('\n').length;
      let cellLines: number[] = [];
      for (let l = 0; l < cellLength; l++) {
        cellLines.push(currentLine + l);
      }
      cellLines.forEach(l => {
        this.lineToCellMap[l] = cell;
        if (!this.cellToLineMap[cell.executionEventId]) {
          this.cellToLineMap[cell.executionEventId] = new NumberSet();
        }
        this.cellToLineMap[cell.executionEventId].add(l);
      });

      // Accumulate the code text.
      currentLine += cellLength;

      // Accumulate the code statements.
      // This includes resetting the locations of all of the nodes in the tree,
      // relative to the cells that come before this one.
      // This can be sped up by saving this computation.
      this.tree.code.push(...shiftStatementLines(cp.statements, Math.min(...cellLines) - 1));
    });

    this.text = cellPrograms.map(cp => magicsRewriter.rewrite(cp.cell.text + '\n')).join('');
  }

  readonly text: string;
  readonly tree: ast.Module;
  readonly cellToLineMap: CellToLineMap = {};
  readonly lineToCellMap: LineToCellMap = {};
}

function shiftStatementLines(stmts: ast.SyntaxNode[], delta: number): ast.SyntaxNode[] {
  return stmts.map(statement => {
    let statementCopy: ast.SyntaxNode = JSON.parse(JSON.stringify(statement));
    for (let node of ast.walk(statementCopy)) {
      if (node.location) {
        node.location = shiftLines(node.location, delta);
      }
      if (node.type == ast.FOR) {
        node.decl_location = shiftLines(node.decl_location, delta);
      }
    }
    return statementCopy;
  });
}

function shiftLines(loc: ast.Location, delta: number): ast.Location {
  return Object.assign({}, loc, {
    first_line: loc.first_line + delta,
    first_column: loc.first_column,
    last_line: loc.last_line + delta,
    last_column: loc.last_column
  });
}



/**
 * Program fragment for a cell. Used to cache parsing results.
 */
export class CellProgram {
  /**
   * Construct a cell program
   */
  constructor(
    cell: Cell,
    statements: ast.SyntaxNode[],
    defs: Ref[],
    uses: Ref[],
    hasError: boolean
  ) {
    this.cell = cell;
    this.statements = statements;
    this.defs = defs;
    this.uses = uses;
    this.hasError = hasError;
  }

  readonly cell: Cell;
  readonly statements: ast.SyntaxNode[];
  readonly defs: Ref[];
  readonly uses: Ref[];
  readonly hasError: boolean;

  public usesSomethingFrom(that: CellProgram) {
    return this.uses.some(use => that.defs.some(def => use.name === def.name));
  }
}

/**
 * Builds programs from a list of executed cells.
 */
export class ProgramBuilder {
  /**
   * Construct a program builder.
   */
  constructor(dataflowAnalyzer?: DataflowAnalyzer) {
    this._dataflowAnalyzer = dataflowAnalyzer;
    this._cellPrograms = [];
  }

  /**
   * Add cells to the program builder.
   */
  public add(...cells: Cell[]) {
    for (let cell of cells) {
      // Proactively try to parse and find defs and uses in each block.
      // If there is a failure, discard that cell.
      let statements: ast.SyntaxNode[] = [];
      let defs: Ref[] = undefined;
      let uses: Ref[] = undefined;
      let hasError = cell.hasError;
      try {
        // Parse the cell's code.
        let tree = ast.parse(magicsRewriter.rewrite(cell.text) + '\n');
        statements = tree.code;
        // Annotate each node with cell ID info, for dataflow caching.
        for (let node of ast.walk(tree)) {
          // Sanity check that this is actually a node.
          if (node.hasOwnProperty('type')) {
            node.location.path = cell.executionEventId;
          }
        }
        // By querying for defs and uses right when a cell is added to the log, we
        // can cache these results, making dataflow analysis faster.
        if (this._dataflowAnalyzer) {
          defs = [];
          uses = [];
          for (let stmt of tree.code) {
            let defsUses = this._dataflowAnalyzer.getDefUseForStatement(stmt, new RefSet());
            defs.push(...defsUses.DEFINITION.union(defsUses.UPDATE).items);
            uses.push(...defsUses.USE.items);
          }
        } else {
          defs = [];
          uses = [];
        }
      } catch (e) {
        console.log(
          "Couldn't analyze block",
          cell.text,
          ', error encountered, ',
          e,
          ', not adding to programs.'
        );
        hasError = true;
      }
      this._cellPrograms.push(
        new CellProgram(cell, statements, defs, uses, hasError)
      );
    }
  }

  /**
   * Reset (removing all cells).
   */
  public reset() {
    this._cellPrograms = [];
  }

  /**
   * Build a program from the list of cells. Program will include the cells' contents in
   * the order they were added to the log. It will omit cells that raised errors (syntax or
   * runtime, except for the last cell).
   */
  public buildTo(cellExecutionEventId: string): Program {
    let cellPrograms: CellProgram[] = [];
    let i: number;
    for (i = this._cellPrograms.length - 1; i >= 0 && this._cellPrograms[i].cell.executionEventId !== cellExecutionEventId; i--);
    cellPrograms.unshift(this._cellPrograms[i]);
    let lastExecutionCountSeen = this._cellPrograms[i].cell.executionCount;
    for (i--; i >= 0; i--) {
      let cellProgram = this._cellPrograms[i];
      let cell = cellProgram.cell;
      if (cell.executionCount >= lastExecutionCountSeen) {
        break;
      }
      if (!cellProgram.hasError) {
        cellPrograms.unshift(cellProgram);
      }
      lastExecutionCountSeen = cell.executionCount;
    }
    return new Program(cellPrograms);
  }

  public buildFrom(executionEventId: string): Program {
    const cellProgram = this.getCellProgram(executionEventId);
    if (!cellProgram) { return null; }
    const i = this._cellPrograms.findIndex(cp => cp.cell.persistentId === cellProgram.cell.persistentId);
    return new Program(this._cellPrograms.slice(i));
  }


  public getCellProgram(executionEventId: string): CellProgram {
    let matchingPrograms = this._cellPrograms.filter(cp => cp.cell.executionEventId == executionEventId);
    if (matchingPrograms.length >= 1) { return matchingPrograms.pop(); }
    return null;
  }

  public getCellProgramsWithSameId(executionEventId: string): CellProgram[] {
    const cellProgram = this.getCellProgram(executionEventId);
    return this._cellPrograms.filter(cp => cp.cell.persistentId === cellProgram.cell.persistentId);
  }

  private _cellPrograms: CellProgram[];
  private _dataflowAnalyzer: DataflowAnalyzer;
}
