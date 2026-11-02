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

## Surrounding physics optimizations

Two costs outside the numerical kernel were optimized after the initial port:

- `MapTerrain` builds a 2D BVH inside each 16 m cell, replacing a linear scan of every support triangle per height query. The driving loader prepares the index before simulation starts. New geometry invalidates affected cell trees. Queries retain the original barycentric test, deck selection and first-face tie order.
- A detached panel that has become rigid now sleeps after 0.5 seconds of continuous support with linear speed below 0.05 m/s and angular speed below 0.1 rad/s. Sleeping debris skips repeated gravity, per-node contact checks and rigid carry. An external impulse or the owner's moving swept chassis bounds reactivates contact processing; it can return to XPBD on a hard hit. There is no change to the fixed simulation step or active constraint iterations.

Additional debug timings distinguish the complete panel step and contacts, body collision-mesh updates and sleep checks. The panel also reports the count of sleeping loose panels.

Reproduce the measurements with:

```powershell
npm run benchmark:terrain
npm run benchmark:vehicle-physics
```

The terrain benchmark uses 3200 support triangles in a dense cell and reports five warmed runs of 20,000 height queries. Development measurements dropped from **290 ms to 6.3 ms**, with the same result checksum. This measures height lookup, not overall simulation or rendering.

The vehicle benchmark requires a local game installation. It assembles the original Baiern assets, crashes at 50 km/h, then applies the brake after three simulated seconds and reports consecutive three-second windows. With WASM selected, the stationary aftermath (6–12 seconds) decreased from approximately **10.8–13.7 ms to 0.90–0.94 ms per eight physics ticks** after adding debris sleep. These are headless physics measurements on the development machine, not browser FPS guarantees. The impact phase remains active and is not accelerated by sleeping stationary debris.

For fragments which cannot yet sleep, the rigid contact path now skips its separate XPBD wake probe when a conservative linear/angular relative-speed bound proves that the wake threshold cannot be reached. Slow contacts are still resolved once; potentially hard contacts retain the probe. Per-fragment node buffers and points are reused so the triangle BVH query cache survives between calls. Terrain contacts also reuse a single sample's height and normal. A regression compares the optimized response against unconditional probing while counting terrain queries.

Run `npm run benchmark:vehicle-physics -- --keep-awake` to stress this path without allowing debris sleep. On the same development setup, the 6–12 second windows improved from approximately **10.1–10.2 ms to 2.3–2.4 ms per eight ticks**, with the same final vehicle velocity. This deliberately awake fixture isolates contact overhead; it is not a new production setting or an FPS claim.

### Attached panels above dense terrain

Zero XPBD solves does not mean zero panel cost: sleeping attached cages still probe terrain before deciding whether to wake. City bridge profiling found these per-node height queries dominating an otherwise rigid vehicle's panel time.

The terrain cell BVH now retains conservative height bounds. A swept cage first checks those bounds and nearby CFG support boxes; cages entirely clear of reachable surfaces skip exact height queries. Near surfaces, the original node tests still run, and obstacle overlaps still wake the panel. Height queries also prune unreachable overhead branches and branches below an already found support. Bounds include the barycentric edge tolerance, and equal-height candidates retain the original tie order. No physics ticks or active solver iterations were removed.

A local controlled bridge run loaded City and City2 (313,893 support triangles and 19,723 CFG boxes), placed a stock Baiern at `(745.5, 6.9, -269.2)`, and held 19 km/h for three 160-frame windows of eight ticks each. Waking was disabled only in this diagnostic fixture to isolate rigid-carry overhead. Panel averages changed from **5.43 / 3.94 / 2.05 ms** to **3.83 / 0.92 / 0.73 ms**. These are headless diagnostic timings, not production FPS or an impact benchmark.

The viewer also skips hidden vehicle-bounds helpers. Streaming load completion no longer invalidates the entire city's proximity query, and type priority sorting runs when the focus cell/range/index changes. A `Sun flare CPU` measurement isolates the lens-flare framebuffer copies within `Render CPU`; these times overlap and must not be added together.
