// Node test preload: exercise existing whole-vehicle regressions with real WASM.
import { readFile } from 'node:fs/promises';
import { softBodyRuntime } from '../src/engine/soft-body-wasm';
if (!await softBodyRuntime.load(() => readFile(new URL('../src/engine/wasm/soft-body.wasm', import.meta.url))))
  throw new Error(`WASM test preload failed: ${softBodyRuntime.error}`);
