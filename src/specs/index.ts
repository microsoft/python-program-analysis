import * as builtins from './__builtin__.json';
import * as matplotlib from './matplotlib.json';
import * as pandas from './pandas.json';
import * as sklearn from './sklearn.json';

export interface FunctionDescription {
	[paramName: string]: string; // "read" | "update" | "higher-order";
}

export interface TypeDescription {
	noSideEffects?: string[];
	sideEffects?: { [name: string]: FunctionDescription };
}

export interface ModuleDescription extends TypeDescription {
	modules?: ModuleMap;
	types?: { [typeName: string]: TypeDescription };
}

export interface ModuleMap {
	[moduleName: string]: ModuleDescription;
}

export const GlobalModuleMap: ModuleMap = {
	...builtins,
	...matplotlib,
	...pandas,
	...sklearn
};
