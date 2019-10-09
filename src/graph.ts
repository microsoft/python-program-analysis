import { Set } from ".";


export class Graph<T> {
	private outgoing = new Map<T, Set<T>>();
	private incoming = new Map<T, Set<T>>();
	private _nodes: Set<T>;

	constructor(private getIdentifier: (item: T) => string) {
		this._nodes = new Set(getIdentifier);
	}

	public addEdge(fromNode: T, toNode: T) {
		this._nodes.add(fromNode);
		this._nodes.add(toNode);
		if (!this.outgoing.has(fromNode)) {
			this.outgoing.set(fromNode, new Set<T>(this.getIdentifier));
		}
		if (!this.incoming.has(toNode)) {
			this.incoming.set(toNode, new Set<T>(this.getIdentifier));
		}
		this.outgoing.get(fromNode).add(toNode);
		this.incoming.get(toNode).add(fromNode);
	}

	// tslint:disable-next-line: prefer-array-literal
	public get nodes() { return this._nodes.items; }

	public topoSort(): T[] {
		const sorted: T[] = [];
		const work = new Set(this.getIdentifier,
			...this.nodes.filter(n => !this.incoming.has(n)));
		while (!work.empty) {
			const n = work.pop();
			sorted.push(n);
			if (this.outgoing.has(n)) {
				this.outgoing.get(n).items.forEach(m => {
					this.outgoing.get(n).remove(m);
					this.incoming.get(m).remove(n);
					if (this.incoming.get(m).empty) {
						work.add(m);
					}
				});
			}
		}
		return sorted;
	}
}