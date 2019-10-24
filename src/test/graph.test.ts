import { Graph } from "../graph";
import { expect } from "chai";

describe('graph', () => {

	it('handles empty', () => {
		const g = new Graph<string>(s => s);
		expect(g.nodes).to.exist;
		expect(g.nodes.length).eq(0);
	});

	it('tracks nodes', () => {
		const g = new Graph<string>(s => s);
		g.addEdge('a', 'b');
		g.addEdge('b', 'c');
		const ns = g.nodes;
		expect(ns).to.exist;
		expect(ns.length).equals(3);
		expect(ns).to.include('a');
		expect(ns).to.include('b');
		expect(ns).to.include('c');
	});

	it('sorts forests', () => {
		const g = new Graph<string>(s => s);
		g.addEdge('a', 'b');
		g.addEdge('c', 'd');
		const s = g.topoSort();
		expect(s).to.exist;
		expect(s.length).eq(4);
		expect(s).to.include('a');
		expect(s).to.include('b');
		expect(s).to.include('c');
		expect(s).to.include('d');
		// can't say exact order
		expect(s.indexOf('a') < s.indexOf('b'), "a before b");
		expect(s.indexOf('c') < s.indexOf('d'), "c before d");
	});

	it('sorts dags', () => {
		const g = new Graph<string>(s => s);
		g.addEdge('a', 'b');
		g.addEdge('b', 'c');
		g.addEdge('a', 'c');
		const s = g.topoSort();
		expect(s).to.exist;
		expect(s.length).eq(3);
		// must be in this order 
		expect(s[0]).eq('a');
		expect(s[1]).eq('b');
		expect(s[2]).eq('c');
	});
});