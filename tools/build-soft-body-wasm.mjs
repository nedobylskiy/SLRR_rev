import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = 'src/engine/wasm/soft-body.wasm';
mkdirSync(new URL('../src/engine/wasm/', import.meta.url), { recursive: true });
const zig = process.env.ZIG;
const compiler = zig || process.env.WASM_CXX || 'clang++';
const exports = ['abi_version', 'configure', 'buffer', 'predict', 'solve', 'solve_constraints', 'solve_contacts', 'release_mounts', 'finish', 'set_colliders'];
const args = [...(zig ? ['c++', '-target', 'wasm32-freestanding'] : ['--target=wasm32']),
  '-std=c++17', '-O3', '-nostdlib', '-fno-exceptions', '-fno-rtti', '-ffp-contract=off',
  '-Wl,--no-entry', '-Wl,--export-memory',
  // Zig 0.13 parses these numeric linker options as hexadecimal; LLVM uses decimal.
  `-Wl,--initial-memory=${zig ? '0xA0000' : '655360'}`, `-Wl,--max-memory=${zig ? '0xA0000' : '655360'}`,
  `-Wl,-z,stack-size=${zig ? '0x10000' : '65536'}`,
  ...exports.map(name => `-Wl,--export=${name}`), 'native/soft-body/solver.cpp', '-o', output];
const result = spawnSync(compiler, args, { cwd: root, stdio: 'inherit' });
if (result.error) console.error(`WASM compiler unavailable: ${compiler}. Set WASM_CXX to clang++ or ZIG to the Zig executable. The checked-in module remains usable.`, result.error.message);
process.exitCode = result.status ?? 1;
