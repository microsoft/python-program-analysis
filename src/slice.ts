import { Location, Module, parse } from './python-parser';
import { ControlFlowGraph } from './control-flow';
import { DataflowAnalyzer } from './data-flow';
import { NumberSet, range, Set } from './set';


function lineRange(loc: Location): NumberSet {
  return range(loc.first_line, loc.last_line + (loc.last_column ? 1 : 0));
}

export class LocationSet extends Set<Location> {
  constructor(...items: Location[]) {
    super(
      l =>
        [l.first_line, l.first_column, l.last_line, l.last_column].toString(),
      ...items
    );
  }
}

function within(inner: Location, outer: Location): boolean {
  let leftWithin =
    outer.first_line < inner.first_line ||
    (outer.first_line == inner.first_line &&
      outer.first_column <= inner.first_column);
  let rightWithin =
    outer.last_line > inner.last_line ||
    (outer.last_line == inner.last_line &&
      outer.last_column >= inner.last_column);
  return leftWithin && rightWithin;
}

function isPositionBetween(
  line: number,
  column: number,
  start_line: number,
  start_column: number,
  end_line: number,
  end_column: number
) {
  let afterStart =
    line > start_line || (line == start_line && column >= start_column);
  let beforeEnd = line < end_line || (line == end_line && column <= end_column);
  return afterStart && beforeEnd;
}

function intersect(l1: Location, l2: Location): boolean {
  return (
    isPositionBetween(
      l1.first_line,
      l1.first_column,
      l2.first_line,
      l2.first_column,
      l2.last_line,
      l2.last_column
    ) ||
    isPositionBetween(
      l1.last_line,
      l1.last_column,
      l2.first_line,
      l2.first_column,
      l2.last_line,
      l2.last_column
    ) ||
    within(l1, l2) ||
    within(l2, l1)
  );
}

export enum SliceDirection { Forward, Backward }

/**
 * More general slice: given locations of important syntax nodes, find locations of all relevant
 * definitions. Locations can be mapped to lines later.
 * seedLocations are symbol locations.
 */
export function slice(
  ast: Module,
  seedLocations?: LocationSet,
  dataflowAnalyzer?: DataflowAnalyzer,
  direction = SliceDirection.Backward
): LocationSet {
  dataflowAnalyzer = dataflowAnalyzer || new DataflowAnalyzer();
  const cfg = new ControlFlowGraph(ast);
  const dfa = dataflowAnalyzer.analyze(cfg).dataflows;

  // Include at least the full statements for each seed.
  let acceptLocation = (loc: Location) => true;
  let sliceLocations = new LocationSet();
  if (seedLocations) {
    let seedStatementLocations = findSeedStatementLocations(seedLocations, cfg);
    acceptLocation = loc => seedStatementLocations.some(seedStmtLoc => intersect(seedStmtLoc, loc));
    sliceLocations = new LocationSet(...seedStatementLocations.items);
  }

  let lastSize: number;
  do {
    lastSize = sliceLocations.size;
    for (let flow of dfa.items) {
      const [start, end] = direction === SliceDirection.Backward ?
        [flow.fromNode.location, flow.toNode.location] :
        [flow.toNode.location, flow.fromNode.location];
      if (acceptLocation(end)) {
        sliceLocations.add(end);
      }
      if (sliceLocations.some(loc => within(end, loc))) {
        sliceLocations.add(start);
      }
    }
  } while (sliceLocations.size > lastSize);

  return sliceLocations;
}


function findSeedStatementLocations(seedLocations: LocationSet, cfg: ControlFlowGraph) {
  let seedStatementLocations = new LocationSet();
  seedLocations.items.forEach(seedLoc => {
    for (let block of cfg.blocks) {
      for (let statement of block.statements) {
        if (intersect(seedLoc, statement.location)) {
          seedStatementLocations.add(statement.location);
        }
      }
    }
  });
  return seedStatementLocations;
}

/**
 * Slice: given a set of lines in a program, return lines it depends on.
 * OUT OF DATE: use slice() instead of sliceLines().
 */
export function sliceLines(code: string, relevantLineNumbers: NumberSet) {
  const ast = parse(code);
  const cfg = new ControlFlowGraph(ast);
  let dataflowAnalyzer = new DataflowAnalyzer();
  const dfa = dataflowAnalyzer.analyze(cfg).dataflows;

  let lastSize: number;
  do {
    lastSize = relevantLineNumbers.size;
    for (let flow of dfa.items) {
      const fromLines = lineRange(flow.fromNode.location);
      const toLines = lineRange(flow.toNode.location);
      const startLines = toLines;
      const endLines = fromLines;
      if (!relevantLineNumbers.intersect(startLines).empty) {
        relevantLineNumbers = relevantLineNumbers.union(endLines);
      }
    }
  } while (relevantLineNumbers.size > lastSize);

  return relevantLineNumbers;
}
