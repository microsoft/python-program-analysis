import { ExecutionLogSlicer } from '../log-slicer';
import { Location, LogCell, DataflowAnalyzer } from '..';
import { expect } from 'chai';

function loc(line0: number, col0: number, line1 = line0 + 1, col1 = 0): Location {
	return { first_line: line0, first_column: col0, last_line: line1, last_column: col1 };
}

function makeLog(lines: string[]) {
	const cells = lines.map((text, i) => new LogCell({ text: text, executionCount: i + 1 }));
	const logSlicer = new ExecutionLogSlicer(new DataflowAnalyzer());
	cells.forEach(cell => logSlicer.logExecution(cell));
	return logSlicer;
}

describe('log-slicer', () => {

	it("does jim's demo", () => {
		const logSlicer = makeLog([
			/*[1]*/  "import pandas as pd",
			/*[2]*/  "Cars = {'Brand': ['Honda Civic','Toyota Corolla','Ford Focus','Audi A4'], 'Price': [22000,25000,27000,35000]}\n" +
					  "df = pd.DataFrame(Cars,columns= ['Brand', 'Price'])",
			/*[3]*/  "def check(df, size=11):\n" +
					  "    print(df)",
			/*[4]*/  "print(df)",
			/*[5]*/  "x = df['Brand'].values"
		  ]);
		const lastCell = logSlicer.cellExecutions[logSlicer.cellExecutions.length - 1].cell;
		const slice = logSlicer.sliceLatestExecution(lastCell.persistentId);
		expect(slice).to.exist;
		expect(slice.cellSlices).to.exist;
		const cellCounts = slice.cellSlices.map(cell => cell.cell.executionCount);
		[1, 2, 5].forEach(c => expect(cellCounts).to.include(c));
		[3, 4].forEach(c => expect(cellCounts).to.not.include(c));
	});

	describe("getDependentCells", () => {

		it("handles simple in-order", () => {
			const lines = [
				"x = 3",
				"y = x+1"
			];
			const logSlicer = makeLog(lines);
			const deps = logSlicer.getDependentCells(logSlicer.cellExecutions[0].cell.executionEventId);
			expect(deps).to.exist;
			expect(deps).to.have.length(1);
			expect(deps[0].text).to.equal(lines[1]);
		});

		it("handles out of order execution", () => {
			const lines = [
				"x = 3",
				"y = x+1",
				"x = 4"
			];
			const logSlicer = makeLog(lines);
			const deps = logSlicer.getDependentCells(logSlicer.cellExecutions[2].cell.executionEventId);
			expect(deps).to.exist;
			expect(deps).to.have.length(1);
			expect(deps[0].text).to.equal(lines[1]);
		});

		it("handles multiple defs", () => {
			const lines = [
				"x = 3",
				"y = x+1",
				"x = 4",
				"y = x*2",
				"x = 5"
			];
			const logSlicer = makeLog(lines);
			const deps = logSlicer.getDependentCells(logSlicer.cellExecutions[4].cell.executionEventId);
			expect(deps).to.exist;
			expect(deps).to.have.length(2);
			const deplines = deps.map(d => d.text);
			expect(deplines).includes(lines[1]);
			expect(deplines).includes(lines[3]);
		});

		it("works transitively", () => {
			const lines = [
				"x = 3",
				"y = x+1",
				"z = y-1"
			];
			const logSlicer = makeLog(lines);
			const deps = logSlicer.getDependentCells(logSlicer.cellExecutions[0].cell.executionEventId);
			expect(deps).to.exist;
			expect(deps).to.have.length(2);
			const deplines = deps.map(d => d.text);
			expect(deplines).includes(lines[1]);
			expect(deplines).includes(lines[2]);
		});

		it("includes all defs within cells", () => {
			const lines = [
				"x = 3\nq = 2",
				"y = x+1",
				"z = q-1"
			];
			const logSlicer = makeLog(lines);
			const deps = logSlicer.getDependentCells(logSlicer.cellExecutions[0].cell.executionEventId);
			expect(deps).to.exist;
			expect(deps).to.have.length(2);
			const deplines = deps.map(d => d.text);
			expect(deplines).includes(lines[1]);
			expect(deplines).includes(lines[2]);
		});
	});

});
