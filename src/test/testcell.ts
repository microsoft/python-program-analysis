import { Cell } from "..";

export class TestCell implements Cell {
	public executionEventId: string;
	public persistentId: string;

	constructor(
		public text: string,
		public executionCount: number,
		executionEventId?: string,
		persistentId?: string,
		public hasError = false,
	) {
		this.executionEventId = executionEventId || genid();
		this.persistentId = persistentId || genid();
	}

	public deepCopy() { return this; } // not used for testing
}


let ID = 0;
function genid() {
	return 'id' + (ID++);
}