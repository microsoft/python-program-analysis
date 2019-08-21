import { FunctionDescription, FunctionSpec, TypeSpec, ModuleSpec, ModuleMap, JsonSpecs } from ".";

function mapDict<U, V>(obj: { [item: string]: U }, f: (item: U) => V): { [item: string]: V } {
	const result: { [item: string]: V } = {};
	Object.keys(obj).forEach(k => result[k] = f(obj[k]));
	return result;
}


function cleanFunc(fdesc: FunctionDescription): FunctionSpec {
	if (typeof fdesc === 'string') {
		return { name: fdesc, reads: [], updates: [] };
	} else {
		if (!fdesc.reads) { fdesc.reads = []; }
		if (!fdesc.updates) { fdesc.updates = []; }
		return fdesc;
	}
}

function cleanType(tdesc: TypeSpec<FunctionDescription>): TypeSpec<FunctionSpec> {
	return {
		methods: tdesc.methods ? tdesc.methods.map(m => cleanFunc(m)) : []
	};
}

function cleanModule(mdesc: ModuleSpec<FunctionDescription>): ModuleSpec<FunctionSpec> {
	return {
		functions: mdesc.functions ? mdesc.functions.map(f => cleanFunc(f)) : [],
		types: mdesc.types ? mapDict(mdesc.types, cleanType) : {},
		modules: mdesc.modules ? mapDict(mdesc.modules, cleanModule) : {}
	};
}

export class SymbolTable {
	public modules: ModuleMap<FunctionSpec> = {};
	public types: { [name: string]: TypeSpec<FunctionSpec> } = {};
	public functions: { [name: string]: FunctionSpec } = {};

	constructor(private moduleMap: JsonSpecs) {
		// preload all the built-in functions.
		this.importModuleDefinitions('__builtins__', [{ path: '*', name: '' }]);
	}

	public getFunction(name: string) {
		const spec = this.functions[name];
		if (spec) { return spec; }
		const clss = this.types[name];
		if (clss) {
			return clss.methods.find(fn => fn.name === '__init__') || { name: '__init__', returns: name };
		}
		return undefined;
	}

	public importModule(modulePath: string, alias: string): ModuleSpec<FunctionSpec> {
		const spec = this.lookupSpec(this.moduleMap, modulePath.split('.'));
		if (!spec) {
			console.log(`*** WARNING no spec for module ${modulePath}`);
			return;
		}
		if (modulePath) {
			this.modules[modulePath] = spec;
			if (alias && alias.length) {
				this.modules[alias] = spec;
			}
		}
	}

	public importModuleDefinitions(namePath: string, imports: { path: string; name: string }[]): ModuleSpec<FunctionSpec> {
		const spec = this.lookupSpec(this.moduleMap, namePath.split('.'));
		if (!spec) {
			console.log(`*** WARNING no spec for module ${namePath}`);
			return;
		}
		if (spec) {
			imports.forEach(imp => {
				const funs = spec.functions ? spec.functions.map(f => cleanFunc(f)) : [];
				if (imp.path === '*') {
					funs.forEach(f => this.functions[f.name] = f);
					if (spec.types) { Object.keys(spec.types).forEach(fname => this.types[fname] = spec.types[fname]); }
				} else if (spec.types && spec.types[imp.name]) {
					this.types[imp.name] = spec.types[imp.name];
				} else {
					const fspec = funs.find(f => f.name === imp.name);
					if (fspec) { this.functions[fspec.name] = fspec; }
				}
			});
		} else {
			console.log(`*** WARNING no spec for module ${namePath}`);
		}
	}

	private lookupSpec(map: JsonSpecs, parts: string[]): ModuleSpec<FunctionSpec> {
		if (!map || parts.length == 0) { return undefined; }
		const spec = map[parts[0]];
		if (!spec) { return undefined; }
		if (parts.length > 1) {
			return this.lookupSpec(spec.modules, parts.slice(1));
		} else {
			return cleanModule(spec);
		}
	}
}
