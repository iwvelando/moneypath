/** Minimal typing for the Go wasm runtime glue (`wasm_exec.js`). */
declare class Go {
  argv: string[];
  env: Record<string, string>;
  exit: (code: number) => void;
  importObject: WebAssembly.Imports;
  exited: boolean;
  run(instance: WebAssembly.Instance): Promise<void>;
}

declare module '*/wasm_exec.js';
