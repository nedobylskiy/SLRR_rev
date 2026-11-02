# Optional C++ / WebAssembly soft-body solver

The engine keeps its TypeScript solver and also includes a freestanding C++17 numerical kernel, compiled to WebAssembly. This is our existing approximation of SLRR soft-body behavior, **not recovered original engine code**.

At startup the browser loads and validates the bundled module before running `Init.java`. Auto mode uses C++/WASM when available. Network errors, missing files, unsupported WebAssembly, ABI errors and unsupported panel capacities fall back to TS. The Java console reports load failures and the vehicle debug panel shows the backend actually in use.

In **Map collision frames → Soft-body solver**, choose Auto, TypeScript or C++/WASM. A panel with an initialized kernel can switch between TS and WASM during a drive without resetting dents, velocity or broken mounts. A panel created while WASM was unavailable keeps using TS until rebuilt. Explicitly requesting WASM still permits the TS fallback.

## What runs where

The C++ kernel handles node prediction, 12 XPBD constraint iterations, ground-height constraints, swept AABB contacts, mount loads and collective release, plastic beam rest lengths and reconstructed velocities. The fixed step remains 240 Hz and all numerical state uses 64-bit floats. Compiler contraction and fast-math optimizations are disabled to preserve numerical parity.

TS owns cage generation, impulses from the surrounding engine, sleeping/rigid carry, skinning, ground sampling, triangle-surface queries, release guards, contact reaction callbacks and the rest of vehicle simulation. Existing Java scripts continue using the same native adapters. This backend runs synchronously on the browser's simulation thread; it is an alternative solver, not a Web Worker or second simultaneous simulation.

Each panel owns a WASM instance with a fixed 640 KiB memory (including a 64 KiB stack), supporting up to 512 nodes, 8192 beams, four mounts and 64 AABBs. Public node arrays are persistent views into that memory, so JS surface queries can modify positions directly between constraint iterations. Beam and mount object properties are synchronized at step boundaries. More than 64 AABBs uses the existing TS AABB contact path; unsupported cage capacity selects TS for the whole panel. Instances are released through normal garbage collection when their panels are no longer referenced.

Loader and instance initialization failures select TS. A runtime simulation error is surfaced as an error rather than silently replaying a partly completed step. No native compiler is required to run the checked-in module or produce the normal Vite build.

## Rebuilding

Source: `native/soft-body/solver.cpp`. Artifact: `src/engine/wasm/soft-body.wasm`. Vite fingerprints and copies it to `dist/assets/`.

Use LLVM clang++ with the WebAssembly target and wasm-ld installed:

```powershell
$env:WASM_CXX = 'C:\Program Files\LLVM\bin\clang++.exe'
npm run build:wasm
```

Or use Zig 0.13.0 (tested on Windows):

```powershell
$env:ZIG = 'C:\tools\zig\zig.exe'
npm run build:wasm
```

The build is freestanding: no libc, C++ standard library, Emscripten runtime or external runtime downloads. Only `Math.exp` and a contact notification callback are imported from JS. Commit source and the rebuilt binary together. Changing the memory layout requires updating the TS adapter and ABI version together.

## Validation and performance

```powershell
npm run test:wasm
npm run benchmark:soft-body
npm test
npm run build
```

`test:wasm` preloads the real module and runs existing panel, triangle-contact and whole-vehicle tests with WASM selected. Additional tests compare TS/WASM state, contacts, plasticity and collective release at three cage resolutions, including the maximum capacity; cover negative terrain and state-preserving backend switching; and check malformed/missing modules. The default test command also runs the existing regressions without the WASM preload, covering the TS fallback.

The benchmark includes JS collision handling and state synchronization, warms V8 up, then reports the median of five runs of 1000 active steps on a 126-node, 1075-beam panel. Initial measurements on the development machine were approximately **0.24 ms/tick for TS and 0.25 ms/tick for WASM**. This first implementation establishes a compatible backend, not a demonstrated speedup. Overall FPS also depends on renderer/GPU cost, and sleeping panels do not run either XPBD kernel. Use the live selector and physics timings to compare the same driving scenario; future optimizations should be checked against these parity tests.
