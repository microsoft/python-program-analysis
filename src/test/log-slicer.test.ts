import { ExecutionLogSlicer } from '../log-slicer';
import { Location, LogCell, DataflowAnalyzer } from '..';
import { expect } from 'chai';

function loc(line0: number, col0: number, line1 = line0 + 1, col1 = 0): Location {
	return { first_line: line0, first_column: col0, last_line: line1, last_column: col1 };
}

describe('log-slicer', () => {

	it("does jim's demo", () => {
		const lines = [
		  /*[1]*/  "import pandas as pd",
		  /*[2]*/  "Cars = {'Brand': ['Honda Civic','Toyota Corolla','Ford Focus','Audi A4'], 'Price': [22000,25000,27000,35000]}\n" +
					"df = pd.DataFrame(Cars,columns= ['Brand', 'Price'])",
		  /*[3]*/  "def check(df, size=11):\n" +
					"    print(df)",
		  /*[4]*/  "print(df)",
		  /*[5]*/  "x = df['Brand'].values"
		];
		const cells = lines.map((text, i) => new LogCell({ text: text, executionCount: i + 1 }));
		const logSlicer = new ExecutionLogSlicer(new DataflowAnalyzer());
		cells.forEach(cell => { logSlicer.logExecution(cell); });
		const lastCell = cells[cells.length - 1];
		const slice = logSlicer.sliceLatestExecution(lastCell);
		expect(slice).to.exist;
		expect(slice.cellSlices).to.exist;
		const cellCounts = slice.cellSlices.map(cell => cell.cell.executionCount);
		[1, 2, 5].forEach(c => expect(cellCounts).to.include(c));
		[3, 4].forEach(c => expect(cellCounts).to.not.include(c));
	});

});
