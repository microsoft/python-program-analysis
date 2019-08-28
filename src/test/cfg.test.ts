import { expect } from 'chai';
import { parse, Def } from '../python-parser';
import { ControlFlowGraph } from '../control-flow';

describe('ControlFlowGraph', () => {
  function makeCfg(...codeLines: string[]): ControlFlowGraph {
    let code = codeLines.concat('').join('\n'); // add newlines to end of every line.
    return new ControlFlowGraph(parse(code));
  }

  it('builds the right successor structure for try-except', () => {
    let cfg = makeCfg('try:', '    return 0', 'except:', '    return 1');
    let handlerHead = cfg.blocks.filter(b => b.hint == 'handlers').pop();
    expect(cfg.getPredecessors(handlerHead).pop().hint).to.equal('try body');
  });

  it('builds a cfg for a function body', () => {
    let ast = parse([
      'def foo(n):',
      '    if n < 4:',
      '        return 1',
      '    else:',
      '        return 2'
    ].join('\n'));
    expect(ast.code.length).to.be.equal(1);
    expect(ast.code[0].type).to.be.equal('def');
    const cfg = new ControlFlowGraph(ast.code[0] as Def);
    expect(cfg.blocks).to.exist;
    expect(cfg.blocks.length).to.be.equal(6);
  });
});
