import { expect } from 'chai';
import { SyntaxNode, parse } from '../python-parser';
import { ControlFlowGraph } from '../control-flow';
import { DataflowAnalyzer, Dataflow, Ref, ReferenceType, RefSet, SymbolType } from '../data-flow';
import { Set } from '../set';
import { JsonSpecs, DefaultSpecs } from '../specs';
import { printNode } from '../printNode';
import { SymbolTable } from '../symbol-table';

describe('detects dataflow dependencies', () => {
  function analyze(...codeLines: string[]): Set<Dataflow> {
    let code = codeLines.concat('').join('\n'); // add newlines to end of every line.
    let analyzer = new DataflowAnalyzer();
    printNode;
    return analyzer.analyze(new ControlFlowGraph(parse(code))).dataflows;
  }

  function analyzeLineDeps(...codeLines: string[]): [number, number][] {
    return analyze(...codeLines).items.map(dep => [dep.toNode.location.first_line, dep.fromNode.location.first_line]);
  }

  it('from variable uses to names', () => {
    let deps = analyzeLineDeps('a = 1', 'b = a');
    expect(deps).to.deep.include([2, 1]);
  });

  it('handles multiple statements per line', () => {
    let deps = analyzeLineDeps('a = 1', 'b = a; c = b', 'd = c');
    expect(deps).to.deep.include([2, 1]);
    expect(deps).to.deep.include([3, 2]);
  });

  it('only links from a use to its most recent def', () => {
    let deps = analyzeLineDeps('a = 2', 'a.prop = 3', 'a = 4', 'b = a');
    expect(deps).to.deep.include([4, 3]);
    expect(deps).to.not.deep.include([4, 1]);
  });

  it('handles augmenting assignment', () => {
    let deps = analyzeLineDeps('a = 2', 'a += 3');
    expect(deps).to.deep.include([2, 1]);
  });

  it('links between statements, not symbol locations', () => {
    let deps = analyze('a = 1', 'b = a');
    expect(deps.items[0].fromNode.location).to.deep.equal({
      first_line: 1,
      first_column: 0,
      last_line: 1,
      last_column: 5,
    });
    expect(deps.items[0].toNode.location).to.deep.equal({
      first_line: 2,
      first_column: 0,
      last_line: 2,
      last_column: 5,
    });
  });

  it('links to a multi-line dependency', () => {
    let deps = analyze('a = func(', '    1)', 'b = a');
    expect(deps.items[0].fromNode.location).to.deep.equal({
      first_line: 1,
      first_column: 0,
      last_line: 2,
      last_column: 6,
    });
  });

  it('to a full for-loop declaration', () => {
    let deps = analyze('for i in range(a, b):', '    print(i)');
    expect(deps.items[0].fromNode.location).to.deep.equal({
      first_line: 1,
      first_column: 0,
      last_line: 1,
      last_column: 21,
    });
  });

  it('links from a class use to its def', () => {
    let deps = analyzeLineDeps('class C(object):', '    pass', '', 'c = C()');
    expect(deps).to.deep.equal([[4, 1]]);
  });

  it('links from a function use to its def', () => {
    let deps = analyzeLineDeps('def func():', '    pass', '', 'func()');
    expect(deps).to.deep.equal([[4, 1]]);
  });
});

describe('detects control dependencies', () => {

  function analyze(...codeLines: string[]): [number, number][] {
    let code = codeLines.concat('').join('\n'); // add newlines to end of every line.
    const deps: [number, number][] = [];
    new ControlFlowGraph(parse(code)).visitControlDependencies((control, stmt) =>
      deps.push([stmt.location.first_line, control.location.first_line]));
    return deps;
  }

  it('to an if-statement', () => {
    let deps = analyze('if cond:', '    print(a)');
    expect(deps).to.deep.equal([[2, 1]]);
  });

  it('for multiple statements in a block', () => {
    let deps = analyze('if cond:', '    print(a)', '    print(b)');
    expect(deps).to.deep.equal([[2, 1], [3, 1]]);
  });

  it('from an else to an if', () => {
    let deps = analyze(
      'if cond:',
      '    print(a)',
      'elif cond2:',
      '    print(b)',
      'else:',
      '    print(b)'
    );
    expect(deps).to.deep.include([3, 1]);
    expect(deps).to.deep.include([5, 3]);
  });

  it('not from a join to an if-condition', () => {
    let deps = analyze('if cond:', '    print(a)', 'print(b)');
    expect(deps).to.deep.equal([[2, 1]]);
  });

  it('not from a join to a for-loop', () => {
    let deps = analyze('for i in range(10):', '    print(a)', 'print(b)');
    expect(deps).to.deep.equal([[2, 1]]);
  });

  it('to a for-loop', () => {
    let deps = analyze('for i in range(10):', '    print(a)');
    expect(deps).to.deep.include([2, 1]);
  });

  it('skipping non-dependencies', () => {
    let deps = analyze('a = 1', 'b = 2');
    expect(deps).to.deep.equal([]);
  });
});

describe('getDefs', () => {

  function getDefsFromStatements(specs?: JsonSpecs, ...codeLines: string[]): Ref[] {
    let code = codeLines.concat('').join('\n');
    let module = parse(code);
    let analyzer = new DataflowAnalyzer(specs || DefaultSpecs);
    return module.code.reduce((refSet, stmt) => {
      const refs = analyzer.getDefs(stmt, refSet);
      return refSet.union(refs);
    }, new RefSet()).items;
  }

  function getDefsFromStatement(
    code: string,
    mmap?: JsonSpecs
  ): Ref[] {
    mmap = mmap || DefaultSpecs;
    code = code + '\n'; // programs need to end with newline
    let mod = parse(code);
    let analyzer = new DataflowAnalyzer(mmap);
    return analyzer.getDefs(mod.code[0], new RefSet())
      .items;
  }

  function getDefNamesFromStatement(
    code: string,
    mmap?: JsonSpecs
  ) {
    return getDefsFromStatement(code, mmap).map(def => def.name);
  }

  describe('detects definitions', () => {
    it('for assignments', () => {
      let defs = getDefsFromStatement('a = 1');
      expect(defs[0]).to.include({
        type: SymbolType.VARIABLE,
        name: 'a',
        level: ReferenceType.DEFINITION,
      });
    });

    it('for augmenting assignments', () => {
      let defs = getDefsFromStatement('a += 1');
      expect(defs[0]).to.include({
        type: SymbolType.VARIABLE,
        name: 'a',
        level: ReferenceType.UPDATE,
      });
    });

    it('for imports', () => {
      let defs = getDefsFromStatement('import lib');
      expect(defs[0]).to.include({ type: SymbolType.IMPORT, name: 'lib' });
    });

    it('for from-imports', () => {
      let defs = getDefsFromStatement('from mod import func');
      expect(defs[0]).to.include({ type: SymbolType.IMPORT, name: 'func' });
    });

    it('for function declarations', () => {
      let defs = getDefsFromStatement(
        ['def func():', '    return 0'].join('\n')
      );
      expect(defs[0]).to.deep.include({
        type: SymbolType.FUNCTION,
        name: 'func',
        location: {
          first_line: 1,
          first_column: 0,
          last_line: 4,
          last_column: -1,
        },
      });
    });

    it('for class declarations', () => {
      let defs = getDefsFromStatement(
        ['class C(object):', '    def __init__(self):', '        pass'].join(
          '\n'
        )
      );
      expect(defs[0]).to.deep.include({
        type: SymbolType.CLASS,
        name: 'C',
        location: {
          first_line: 1,
          first_column: 0,
          last_line: 5,
          last_column: -1,
        },
      });
    });

    describe('that are weak (marked as updates)', () => {
      it('for dictionary assignments', () => {
        let defs = getDefsFromStatement(["d['a'] = 1"].join('\n'));
        expect(defs.length).to.equal(1);
        expect(defs[0].level).to.equal(ReferenceType.UPDATE);
        expect(defs[0].name).to.equal('d');
      });

      it('for property assignments', () => {
        let defs = getDefsFromStatement(['obj.a = 1'].join('\n'));
        expect(defs.length).to.equal(1);
        expect(defs[0].level).to.equal(ReferenceType.UPDATE);
        expect(defs[0].name).to.equal('obj');
      });
    });

    describe('from annotations', () => {
      it('from our def annotations', () => {
        let defs = getDefsFromStatement(
          '"""defs: [{ "name": "a", "pos": [[0, 0], [0, 11]] }]"""%some_magic'
        );
        expect(defs[0]).to.deep.include({
          type: SymbolType.MAGIC,
          name: 'a',
          location: {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 11,
          },
        });
      });

      it('computing the def location relative to the line it appears on', () => {
        let defs = getDefsFromStatements(undefined,
          '# this is an empty line',
          '"""defs: [{ "name": "a", "pos": [[0, 0], [0, 11]] }]"""%some_magic',
        );
        expect(defs[0]).to.deep.include({
          location: {
            first_line: 2,
            first_column: 0,
            last_line: 2,
            last_column: 11,
          },
        });
      });
    });

    describe('including', () => {
      it('function arguments', () => {
        let defs = getDefNamesFromStatement('func(a)');
        expect(defs.length).to.equal(1);
      });

      it('the object a function is called on', () => {
        let defs = getDefNamesFromStatement('obj.func()');
        expect(defs.length).to.equal(1);
      });
    });

    describe('; given a spec,', () => {
      it('can ignore all arguments', () => {
        let defs = getDefsFromStatement('func(a, b, c)',
          { __builtins__: { functions: ['func'] } });
        expect(defs).to.deep.equal([]);
      });

      it('assumes arguments have side-effects, without a spec', () => {
        let defs = getDefsFromStatement('func(a, b, c)',
          { __builtins__: { functions: [] } });
        expect(defs).to.exist;
        expect(defs.length).to.equal(3);
        const names = defs.map(d => d.name);
        expect(names).to.include('a');
        expect(names).to.include('b');
        expect(names).to.include('c');
      });

      it('can ignore the method receiver', () => {
        const specs = { __builtins__: { types: { C: { methods: ['m'] } } } };
        let defs = getDefsFromStatements(specs, 'x=C()', 'x.m()');
        expect(defs).to.exist;
        expect(defs.length).to.equal(1);
        expect(defs[0].name).to.equal('x');
        expect(defs[0].level).to.equal(ReferenceType.DEFINITION);
      });

      it('assumes method call affects the receiver, without a spec', () => {
        const specs = { __builtins__: {} };
        let defs = getDefsFromStatements(specs, 'x=C()', 'x.m()');
        expect(defs).to.exist;
        expect(defs.length).to.equal(2);
        expect(defs[1].name).to.equal('x');
        expect(defs[1].level).to.equal(ReferenceType.UPDATE);
      });

    });
  });

  describe("doesn't detect definitions", () => {
    it('for names used outside a function call', () => {
      let defs = getDefNamesFromStatement('a + func()');
      expect(defs).to.deep.equal([]);
    });

    it('for functions called early in a call chain', () => {
      let defs = getDefNamesFromStatement('func().func()');
      expect(defs).to.deep.equal([]);
    });
  });
});

describe('getUses', () => {
  function getUseNames(...codeLines: string[]) {
    let code = codeLines.concat('').join('\n');
    let mod = parse(code);
    let analyzer = new DataflowAnalyzer();
    return analyzer
      .getUses(mod.code[0])
      .items.map(use => use.name);
  }

  describe('detects uses', () => {
    it('of functions', () => {
      let uses = getUseNames('func()');
      expect(uses).to.include('func');
    });

    it('for undefined symbols in functions', () => {
      let uses = getUseNames('def func(arg):', '    print(a)');
      expect(uses).to.include('a');
    });

    it('handles augassign', () => {
      let uses = getUseNames('x -= 1');
      expect(uses).to.include('x');
    });

    it('of functions inside classes', () => {
      let uses = getUseNames('class Baz():', '  def quux(self):', '    func()');
      expect(uses).to.include('func');
    });

    it('of variables inside classes', () => {
      let uses = getUseNames(
        'class Baz():',
        '  def quux(self):',
        '    self.data = a'
      );
      expect(uses).to.include('a');
    });

    it('of functions and variables inside nested classes', () => {
      let uses = getUseNames(
        'class Bar():',
        '  class Baz():',
        '    class Qux():',
        '      def quux(self):',
        '         func()',
        '         self.data = a'
      );
      expect(uses).to.include('func');
      expect(uses).to.include('a');
    });
  });

  describe('ignores uses', () => {
    it('for symbols defined within functions', () => {
      let uses = getUseNames(
        'def func(arg):',
        '    print(arg)',
        '    var = 1',
        '    print(var)'
      );
      expect(uses).to.not.include('arg');
      expect(uses).to.not.include('var');
    });

    it('for params used in an instance function body', () => {
      let uses = getUseNames(
        'class Foo():',
        '    def func(arg1):',
        '        print(arg1)'
      );
      expect(uses).to.not.include('arg1');
    });
  });
});
