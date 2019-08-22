import { expect } from 'chai';
import { Location, parse } from '../python-parser';
import { LocationSet, slice } from '../slice';
import { DataflowAnalyzer } from '../data-flow';

function loc(line0: number, col0: number, line1 = line0 + 1, col1 = 0): Location {
  return { first_line: line0, first_column: col0, last_line: line1, last_column: col1 };
}

describe('slice', () => {
  it('statements including the def and use', () => {
    let ast = parse(['a = 1', 'b = a', ''].join('\n'));
    let locations = slice(ast, new LocationSet(loc(2, 0, 2, 5)));
    expect(locations.items).to.deep.include(loc(1, 0, 1, 5));
  });

  it('at least yields the statement for a seed', () => {
    let ast = parse(['c = 1', ''].join('\n'));
    let locations = slice(ast, new LocationSet(loc(1, 0, 1, 2)));
    expect(locations.items).to.deep.include(loc(1, 0, 1, 5));
  });

  it('does our current demo', () => {
    const ast = parse([
    /*1*/  'from matplotlib.pyplot import scatter',
    /*2*/  'from sklearn.cluster import KMeans',
    /*3*/  'from sklearn import datasets',
    /*4*/  'data = datasets.load_iris().data[:,2:4]',
    /*5*/  'petal_length, petal_width = data[:,0], data[:,1]',
    /*6*/  'print("Average petal length: %.3f" % (sum(petal_length) / len(petal_length),))',
    /*7*/  'clusters = KMeans(n_clusters=5).fit(data).labels_',
    /*8*/  'scatter(petal_length, petal_width, c=clusters)',
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const locations = slice(ast, new LocationSet(loc(8, 0, 8, 46)), da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 4, 5, 7, 8].forEach(line =>
      expect(lineNums).to.deep.include(line));
    expect(lineNums).to.not.include(6);
  });

  it('uses api specs to decide mutating methods', () => {
    const ast = parse([
      /*1*/  'import pandas as pd',
      /*2*/  'd = pd.read_csv("some_path")',
      /*3*/  'd.pop("Column")',
      /*4*/  'd.memory_usage()',
      /*5*/  'd.count()'
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const criterion = new LocationSet(loc(5, 0, 5, 12));
    const locations = slice(ast, criterion, da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 5].forEach(line =>
      expect(lineNums).to.include(line));
    expect(lineNums).to.not.include(4);
  });

  it('joins inferred types', () => {
    const ast = parse([
    /*1*/  'import pandas as pd',
    /*2*/  'import random',
    /*3*/  'if random.choice([1,2]) == 1:',
    /*4*/  '    data = pd.read_csv("some_path")',
    /*5*/  'else:',
    /*6*/  '    data = pd.read_csv("other_path")',
    /*7*/  'data.pop("Column")',
    /*8*/  'data.memory_usage()',
    /*9*/  'data.count()'
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const criterion = new LocationSet(loc(9, 0, 9, 12));
    const locations = slice(ast, criterion, da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 4, 5, 6, 7, 9].forEach(line =>
      expect(lineNums).to.include(line));
    expect(lineNums).to.not.include(8);
  });

});
