import { parse as python3Parse, parser } from './python3';
import { printNode } from './printNode';

/**
 * Reset the lexer state after an error. Otherwise, parses after a failed parse can fail too.
 */
let yy = parser.yy as any;
let oldParseError = yy.parseError;
oldParseError = function (text: String, hash: any) {
  this.indents = [0];
  this.indent = 0;
  this.dedents = 0;
  this.brackets_count = 0;
  oldParseError.call(this, text, hash);
};

/**
 * This is the main interface for parsing code.
 * Call this instead of the `parse` method in python3.js.
 * If the `parse` method gets an error, all later calls will throw an error.
 * This method resets the state of the `parse` method so that doesn't happen.
 */
export function parse(program: string): Module {
  if (program.charCodeAt(0) === 65279) {
    // eliminate byte order mark
    program = program.slice(1);
  }
  // The parser is fussy about line endings, so remote
  // carriage returns and make sure we end with a newline.
  return python3Parse(program.replace(/\r/g, '') + '\n');
}

export type SyntaxNode =
  | Module
  | Import
  | From
  | Decorator
  | Decorate
  | Def
  | Parameter
  | Assignment
  | Assert
  | Pass
  | Return
  | Yield
  | Raise
  | Continue
  | Break
  | Global
  | Nonlocal
  | If
  | Else
  | While
  | For
  | Try
  | With
  | Call
  | Index
  | Slice
  | Dot
  | IfExpr
  | CompFor
  | CompIf
  | Lambda
  | UnaryOperator
  | BinaryOperator
  | Starred
  | Tuple
  | ListExpr
  | SetExpr
  | DictExpr
  | Name
  | Literal
  | Class;

/// Must be consistent with Jison (Bison) naming conventions
interface JisonLocation {
  first_line: number;
  first_column: number;
  last_line: number;
  last_column: number;
}

export interface Location extends JisonLocation {
  path?: string; // useful for error messages and other tracking
}

export function locationString(loc: Location) {
  return `${loc.path}${loc.last_line}:${loc.first_column}-${loc.last_line}:${loc.last_column}`;
}


// loc2 is inside loc1
export function locationContains(loc1: Location, loc2: Location) {
  function contains(loc: Location, line: number, col: number) {
    return (
      (loc.first_line < line ||
        (loc.first_line === line && loc.first_column <= col)) &&
      (line < loc.last_line ||
        (line === loc.last_line && col <= loc.last_column))
    );
  }
  return (
    contains(loc1, loc2.first_line, loc2.first_column) &&
    contains(loc1, loc2.last_line, loc2.last_column)
  );
}

export interface Locatable {
  location?: Location;
  cellId?: string;
  executionCount?: number;
}

const LocatableFields = ['location', 'cellId', 'executionCount'];

export const MODULE = 'module';

export interface Module extends Locatable {
  type: typeof MODULE;
  code: SyntaxNode[];
}

export const IMPORT = 'import';

export interface Import extends Locatable {
  type: typeof IMPORT;
  names: { path: string; name?: string; location: Location }[];
}

export const FROM = 'from';

export interface From extends Locatable {
  type: typeof FROM;
  base: string;
  imports: { path: string; name: string; location: Location }[];
}

export const DECORATOR = 'decorator';

export interface Decorator extends Locatable {
  type: typeof DECORATOR;
  decorator: string;
  args: SyntaxNode[];
}

export const DECORATE = 'decorate';

export interface Decorate extends Locatable {
  type: typeof DECORATE;
  decorators: Decorator[];
  def: SyntaxNode;
}

export const DEF = 'def';

export interface Def extends Locatable {
  type: typeof DEF;
  name: string;
  params: Parameter[];
  code: SyntaxNode[];
}

export const PARAMETER = 'parameter';

export interface Parameter extends Locatable {
  type: typeof PARAMETER;
  name: string;
  anno: SyntaxNode;
  default_value: SyntaxNode;
  star: boolean;
  starstar: boolean;
}

export const ASSIGN = 'assign';

export interface Assignment extends Locatable {
  type: typeof ASSIGN;
  op: string | undefined; // defined for augment e.g. +=
  targets: SyntaxNode[];
  sources: SyntaxNode[];
}

export const ASSERT = 'assert';

export interface Assert extends Locatable {
  type: typeof ASSERT;
  cond: SyntaxNode;
  err: SyntaxNode;
}

export const PASS = 'pass';

export interface Pass extends Locatable {
  type: typeof PASS;
}

export const RETURN = 'return';

export interface Return extends Locatable {
  type: typeof RETURN;
  values: SyntaxNode[];
}

export const YIELD = 'yield';

export interface Yield extends Locatable {
  type: typeof YIELD;
  value: SyntaxNode[];
  from?: SyntaxNode;
}

export const RAISE = 'raise';

export interface Raise extends Locatable {
  type: typeof RAISE;
  err: SyntaxNode;
}

export const BREAK = 'break';

export interface Break extends Locatable {
  type: typeof BREAK;
}

export const CONTINUE = 'continue';

export interface Continue extends Locatable {
  type: typeof CONTINUE;
}

export const GLOBAL = 'global';

export interface Global extends Locatable {
  type: typeof GLOBAL;
  names: string[];
}

export const NONLOCAL = 'nonlocal';

export interface Nonlocal extends Locatable {
  type: typeof NONLOCAL;
  names: string[];
}

export const IF = 'if';

export interface If extends Locatable {
  type: typeof IF;
  cond: SyntaxNode;
  code: SyntaxNode[];
  elif: { cond: SyntaxNode; code: SyntaxNode[] }[];
  else: Else;
}

export const WHILE = 'while';

export interface While extends Locatable {
  type: typeof WHILE;
  cond: SyntaxNode;
  code: SyntaxNode[];
  else: SyntaxNode[];
}

export const ELSE = 'else';

export interface Else extends Locatable {
  type: typeof ELSE;
  code: SyntaxNode[];
}

export const FOR = 'for';

export interface For extends Locatable {
  type: typeof FOR;
  target: SyntaxNode[];
  iter: SyntaxNode[];
  code: SyntaxNode[];
  else?: SyntaxNode[];
  decl_location: Location;
}

export const COMPFOR = 'comp_for';

export interface CompFor extends Locatable {
  type: typeof COMPFOR;
  for: SyntaxNode[];
  in: SyntaxNode;
}

export const COMPIF = 'comp_if';

export interface CompIf extends Locatable {
  type: typeof COMPIF;
  test: SyntaxNode;
}

export const TRY = 'try';

export interface Try extends Locatable {
  type: typeof TRY;
  code: SyntaxNode[];
  excepts: { cond: SyntaxNode; name: string; code: SyntaxNode[] }[];
  else: SyntaxNode[];
  finally: SyntaxNode[];
}

export const WITH = 'with';

export interface With extends Locatable {
  type: typeof WITH;
  items: { with: SyntaxNode; as: SyntaxNode }[];
  code: SyntaxNode[];
}

export const CALL = 'call';

export interface Call extends Locatable {
  type: typeof CALL;
  func: SyntaxNode;
  args: Argument[];
}

export const ARG = 'arg';

export interface Argument extends Locatable {
  type: typeof ARG;
  actual: SyntaxNode;
  keyword?: SyntaxNode;
  loop?: CompFor;
  varargs?: boolean;
  kwargs?: boolean;
}

export const INDEX = 'index';

export interface Index extends Locatable {
  type: typeof INDEX;
  value: SyntaxNode;
  args: SyntaxNode[];
}

export const SLICE = 'slice';

export interface Slice extends Locatable {
  type: typeof SLICE;
  start?: SyntaxNode;
  stop?: SyntaxNode;
  step?: SyntaxNode;
}

export const DOT = 'dot';

export interface Dot extends Locatable {
  type: typeof DOT;
  value: SyntaxNode;
  name: string;
}

export const IFEXPR = 'ifexpr';

export interface IfExpr extends Locatable {
  type: typeof IFEXPR;
  test: SyntaxNode;
  then: SyntaxNode;
  else: SyntaxNode;
}

export const LAMBDA = 'lambda';

export interface Lambda extends Locatable {
  type: typeof LAMBDA;
  args: Parameter[];
  code: SyntaxNode;
}

export const UNOP = 'unop';

export interface UnaryOperator extends Locatable {
  type: typeof UNOP;
  op: string;
  operand: SyntaxNode;
}

export const BINOP = 'binop';

export interface BinaryOperator extends Locatable {
  type: typeof BINOP;
  op: string;
  left: SyntaxNode;
  right: SyntaxNode;
}

export const STARRED = 'starred';

export interface Starred extends Locatable {
  type: typeof STARRED;
  value: SyntaxNode;
}

export const TUPLE = 'tuple';

export interface Tuple extends Locatable {
  type: typeof TUPLE;
  items: SyntaxNode[];
}

export const LIST = 'list';

export interface ListExpr extends Locatable {
  type: typeof LIST;
  items: SyntaxNode[];
}

export const SET = 'set';

export interface SetExpr extends Locatable {
  type: typeof SET;
  entries: SyntaxNode[];
  comp_for?: SyntaxNode[];
}

export const DICT = 'dict';

export interface DictExpr extends Locatable {
  type: typeof DICT;
  entries: { k: SyntaxNode; v: SyntaxNode }[];
  comp_for?: SyntaxNode[];
}

export const NAME = 'name';

export interface Name extends Locatable {
  type: typeof NAME;
  id: string;
}

export const LITERAL = 'literal';

export interface Literal extends Locatable {
  type: typeof LITERAL;
  value: any;
}

export const CLASS = 'class';

export interface Class extends Locatable {
  type: typeof CLASS;
  name: string;
  extends: SyntaxNode[];
  code: SyntaxNode[];
}

/*
	UTILITY FUNCTIONS
*/

/**
 * returns whether two syntax nodes are semantically equivalent
 */
export function isEquivalent(node1: SyntaxNode, node2: SyntaxNode): boolean {
  if (!node1 || !node2) {
    return node1 === node2;
  }
  return printNode(node1) === printNode(node2);
}

export function flatten<T>(arrayArrays: T[][]): T[] {
  return [].concat(...arrayArrays);
}

/**
 * Listener for pre-order traversal of the parse tree.
 */
export interface WalkListener {
  /**
   * Called whenever a node is entered.
   */
  onEnterNode?(node: SyntaxNode, ancestors: SyntaxNode[]): void;

  /**
   * Called whenever a node is exited.
   */
  onExitNode?(node: SyntaxNode, ancestors: SyntaxNode[]): void;
}

/**
 * Preorder tree traversal with optional listener.
 */
export function walk(
  node: SyntaxNode,
  walkListener?: WalkListener
): SyntaxNode[] {
  return walkRecursive(node, [], walkListener);
}

/**
 * Recursive implementation of pre-order tree walk.
 */
// tslint:disable-next-line: max-func-body-length
function walkRecursive(
  node: SyntaxNode,
  ancestors?: SyntaxNode[],
  walkListener?: WalkListener
): SyntaxNode[] {
  if (!node) {
    console.error('Node undefined. Ancestors:', ancestors);
    return [];
  }

  ancestors.push(node);

  if (walkListener && walkListener.onEnterNode) {
    walkListener.onEnterNode(node, ancestors);
  }

  let children: SyntaxNode[] = [];
  switch (node.type) {
    case MODULE:
    case DEF:
    case CLASS:
      children = node.code;
      break;
    case IF:
      children = [node.cond]
        .concat(node.code)
        .concat(
          node.elif ? flatten(node.elif.map(e => [e.cond].concat(e.code))) : []
        )
        .concat(node.else ? [node.else] : []);
      break;
    case ELSE:
      children = node.code;
      break;
    case WHILE:
      children = [node.cond].concat(node.code);
      break;
    case WITH:
      children = flatten(node.items.map(r => [r.with, r.as])).concat(node.code);
      break;
    case FOR:
      children = node.iter.concat(node.target).concat(node.code);
      break;
    case TRY:
      children = node.code
        .concat(
          flatten(
            (node.excepts || []).map(e =>
              (e.cond ? [e.cond] : []).concat(e.code)
            )
          )
        )
        .concat(node.else || [])
        .concat(node.finally || []);
      break;
    case DECORATE:
      children = [node.def];
      break;
    case LAMBDA:
      children = [node.code];
      break;
    case CALL:
      children = [node.func].concat(node.args.map(a => a.actual));
      break;
    case IFEXPR:
      children = [node.test, node.then, node.else];
      break;
    case COMPFOR:
      children = node.for.concat([node.in]);
      break;
    case UNOP:
      children = [node.operand];
      break;
    case BINOP:
      children = [node.left, node.right];
      break;
    case STARRED:
      children = [node.value];
      break;
    case SET:
      children = node.entries.concat(node.comp_for ? node.comp_for : []);
      break;
    case LIST:
      children = node.items;
      break;
    case TUPLE:
      children = node.items;
      break;
    case DICT:
      children = flatten(node.entries.map(p => [p.k, p.v])).concat(
        node.comp_for ? node.comp_for : []
      );
      break;
    case ASSIGN:
      if (!node.sources) console.log(node);
      children = node.sources.concat(node.targets);
      break;
    case ASSERT:
      children = [node.cond].concat(node.err ? [node.err] : []);
      break;
    case DOT:
      children = [node.value];
      break;
    case INDEX:
      children = [node.value].concat(node.args);
      break;
    case SLICE:
      children = (node.start ? [node.start] : [])
        .concat(node.stop ? [node.stop] : [])
        .concat(node.step ? [node.step] : []);
      break;
    case COMPFOR:
      children = node.for.concat([node.in]);
      break;
    case COMPIF:
      children = [node.test];
      break;
    case YIELD:
      children = node.value ? node.value : [];
      break;
    case RETURN:
      children = node.values ? node.values : [];
      break;
    case RAISE:
      children = node.err ? [node.err] : [];
      break;
    case IFEXPR:
      children = [node.test, node.then, node.else];
      break;
  }

  let nodes = [node];
  if (children.some(c => !c)) {
    console.log('BAD CHILDREN', node);
  }
  let subtreeNodes = flatten(
    children.map(node => walkRecursive(node, ancestors, walkListener))
  );
  nodes = nodes.concat(subtreeNodes);

  if (walkListener && walkListener.onExitNode) {
    walkListener.onExitNode(node, ancestors);
  }

  ancestors.pop();
  return nodes;
}
