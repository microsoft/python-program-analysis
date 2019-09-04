import { expect } from 'chai';
import { Location, parse, locationString } from '../python-parser';
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
    const criterion = new LocationSet(loc(9, 0, 9, 12));
    const locations = slice(ast, criterion, new DataflowAnalyzer());
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 4, 5, 6, 7, 9].forEach(line =>
      expect(lineNums).to.include(line));
    expect(lineNums).to.not.include(8);
  });

  it('does the documentation example', () => {
    const ast = parse([
    /*1*/  'sum = 0',
    /*2*/  'diff_sum = 0',
    /*3*/  'for i in range(min(len(A), len(B))):',
    /*4*/  '    sum += A[i] + B[i]',
    /*5*/  '    diff_sum += A[i] - B[i]',
    /*6*/  'print(sum)'
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const criterion = new LocationSet(loc(6, 0, 6, 10));
    const locations = slice(ast, criterion, da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 3, 4, 6].forEach(line =>
      expect(lineNums).to.include(line));
    [2, 5].forEach(line =>
      expect(lineNums).to.not.include(line));
  });

  it('eliminates functions without side-effects', () => {
    const ast = parse([
      /*1*/  'def innocent(i):',
      /*2*/  '    [1,2,3][i] = 3',
      /*3*/  'a=0',
      /*4*/  'innocent(a)',
      /*5*/  'b=2*a',
      /*6*/  'print(b)'
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const criterion = new LocationSet(loc(6, 0, 6, 8));
    const locations = slice(ast, criterion, da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [3, 5, 6].forEach(line =>
      expect(lineNums).to.include(line));
    [1, 2, 4].forEach(line =>
      expect(lineNums).to.not.include(line));
  });

  it('keeps functions with item updates', () => {
    const ast = parse([
      /*1*/  'def zap(x):',
      /*2*/  '    x[1]="zap"',
      /*3*/  'a=[1,2,3]',
      /*4*/  'zap(a)',
      /*5*/  'b=a[2]',
      /*6*/  'print(b)'
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const criterion = new LocationSet(loc(6, 0, 6, 8));
    const locations = slice(ast, criterion, da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 3, 4, 5, 6].forEach(line =>
      expect(lineNums).to.include(line));
  });

  it('keeps functions with field updates', () => {
    const ast = parse([
      /*1*/  'class C:',
      /*2*/  '    f = 0',
      /*3*/  'def zap(x):',
      /*4*/  '    x.f += 1',
      /*5*/  'def innocent(x):',
      /*6*/  '    print(x.f)',
      /*7*/  'a=C()',
      /*8*/  'zap(a)',
      /*9*/  'innocent(a)',
      /*10*/  'b=a.f',
      /*11*/  'print(b)'
    ].join('\n'));
    const da = new DataflowAnalyzer();
    const criterion = new LocationSet(loc(11, 0, 11, 8));
    const locations = slice(ast, criterion, da);
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 3, 7, 8, 10, 11].forEach(line =>
      expect(lineNums).to.include(line));
    [5, 9].forEach(line =>
      expect(lineNums).to.not.include(line));
  });

  it('handles transitive updates', () => {
    const ast = parse([
      /*1*/  'import pandas as pd',
      /*2*/  'df=pd.read_from_csv("path")',
      /*3*/  'def zap(x):',
      /*4*/  '    x.pop("Column")',
      /*5*/  'zap(df)',
      /*6*/  'df.count()'
    ].join('\n'));
    const criterion = new LocationSet(loc(6, 0, 6, 10));
    const locations = slice(ast, criterion, new DataflowAnalyzer());
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 5, 6].forEach(line =>
      expect(lineNums).to.include(line));
  });

  it("does jim's demo", () => {
    const ast = parse([
      /*1*/  "import pandas as pd",
      /*2*/  "Cars = {'Brand': ['Honda Civic','Toyota Corolla','Ford Focus','Audi A4'], 'Price': [22000,25000,27000,35000]}",
      /*3*/  "df = pd.DataFrame(Cars,columns= ['Brand', 'Price'])",
      /*4*/  "def check(df, size=11):",
      /*5*/  "    print(df)",
      /*6*/  "print(df)",
      /*7*/  "x = df['Brand'].values"
    ].join('\n'));
    const criterion = new LocationSet(loc(7, 0, 7, 21));
    const locations = slice(ast, criterion, new DataflowAnalyzer());
    const lineNums = locations.items.map(loc => loc.first_line);
    [1, 2, 3, 7].forEach(line =>
      expect(lineNums).to.include(line));
    [4, 5, 6].forEach(line =>
      expect(lineNums).to.not.include(line));
  });

});
