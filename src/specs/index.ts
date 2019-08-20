import * as builtins from "./__builtins__.json";
import * as matplotlib from "./matplotlib.json";
import * as pandas from "./pandas.json";
import * as sklearn from "./sklearn.json";

export interface FunctionSpec {
  name: string;
  updates?: (string | number)[];
  reads?: string[];
  returns?: string;
  higherorder?: number;
}

export type FunctionDescription = string | FunctionSpec;

export interface TypeSpec<FD> {
  methods?: FD[];
}

export interface ModuleSpec<FD> extends TypeSpec<FD> {
  functions?: FD[];
  modules?: ModuleMap<FD>;
  types?: { [typeName: string]: TypeSpec<FD> };
}

export interface ModuleMap<FD> {
  [moduleName: string]: ModuleSpec<FD>;
}

export type JsonSpecs = ModuleMap<FunctionDescription>;

export const GlobalModuleMap: JsonSpecs = {
  ...builtins,
  ...matplotlib,
  ...pandas,
  ...sklearn
};
