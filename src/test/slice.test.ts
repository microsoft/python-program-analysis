import { expect } from 'chai';
import { Location, parse } from '../python-parser';
import { LocationSet, slice } from '../slice';
import { DataflowAnalyzer } from '../data-flow';
import * as rulesJson from '../rules.json';

function loc(line0: number, col0: number, line1 = line0 + 1, col1 = 0): Location {
  return { first_line: line0, first_column: col0, last_line: line1, last_column: col1 };
}

describe('slices', () => {
  it('statements including the def and use', () => {
    let ast = parse(['a = 1', 'b = a', ''].join('\n'));
    let locations = slice(
      ast,
      new LocationSet(loc(2, 0, 2, 5))
    );
    expect(locations.items).to.deep.include(loc(1, 0, 1, 5));
  });

  it('at least yields the statement for a seed', () => {
    let ast = parse(['c = 1', ''].join('\n'));
    let locations = slice(
      ast,
      new LocationSet(loc(1, 0, 1, 2))
    );
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
    const da = new DataflowAnalyzer(rulesJson);
    const locations = slice(ast, new LocationSet(loc(8, 0, 8, 46)), da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 4, 5, 7, 8].forEach(line =>
      expect(lineNums).to.deep.include(line));
    expect(lineNums).to.not.include(6);
  });

});
