# Testing the original hood

In the test scene, the **"Hood Test"** button on the left opens a separate stand. “Weak impact” gives an elastic deflection, “Dent” changes shape after vibrations die out, “Overload” destroys the supports. After separation, the same frame continues to move and falls onto the plane. "New Hood" resets speeds, plastic lengths and support damage. The blows can be repeated; The checkbox shows physical connections. Green markers indicate intact supports, red markers indicate destroyed ones.

The next stage is already available in a separate mode [“Car and obstacle”](car-crash-demo.md): the hood is installed on a standard assembly, it wrinkles from contact, a physical rupture causes EngineWorld.detach. The restrictions below apply to the original stand; Machine mode capabilities are described separately.

## Original data and new assumptions

The factory resolves `cars/racers/Baiern.rpk:0x10d` through the normal RPK/CFG path. The model is `Baiern_data/meshes/hood.scx`; the standard loader supplies its materials and textures. SCX coordinates are converted from centimeters to meters and the render pose is applied. `hood.cfg` provides a total mass of `18 + 18 + 2.5 = 38.5 kg` and logical slot 601 at `(0, 0.191, 0.696)`. The stand height of 1.25 m is specific to this test scene.

The physical structure is **generated**, not extracted from the original solver: two 7x9 meshes, 126 mass nodes in total. The height of the surface is estimated from the original vertices; the distance between layers of 8 cm is a numerical parameter of the frame, and not the thickness of the metal sheet. Longitudinal, transverse, diagonal and interlayer bonds maintain shape. The mass is distributed evenly. According to the slot position, two rear supports are selected; the third support on the opposite edge represents the closed hood lock. CFG does not contain three remanufactured bolts; This heuristic cannot be extended to all details.

The frame is rectangular and extends beyond some edges of the visible model. Each source vertex is connected to eight nodes of the nearest cell. Interpolation in XZ and linear extrapolation between layers in Y accurately reproduce the original geometry at rest and maintain overall rigid rotation/translation. Duplicate UVs/materials receive the same binding. After the step, the positions and normals of the meshes are updated.

## Calculation

`src/engine/deformable-panel.ts` is independent of Three.js/DOM and also runs in Node. The basis of distance/anchor constraints is [XPBD, Macklin et al., 2016](https://matthias-research.github.io/pages/publications/XPBD.pdf): lambda is accumulated at each substep, compliance is divided by dt². Here 240 steps per second, 12 iterations; FixedClock separates the physical clock from the render clock. The interface limits the time after a long pause, a hidden tab pauses the scene.

Current demo parameters: stiffness 400000 N/m, yield strain 0.008, damping 2/s on supports and 0.25/s after lift-off. When yield is exceeded, the rest length of the connection changes at a speed of 120/s, with a limit of 0.5–1.5 of the original length. This is its own simplified plasticity; Damage to the sheet and rupture of the metal itself are not yet modeled.

The buttons transmit pulses of 5, 65 and 650 N·s over a local area of the surface with a Gaussian sigma of 0.17 m. The direction has vertical and horizontal components; the total input pulse is checked by the test. The buttons do not set a dent and do not toggle the tear-off flag. The support reaction is estimated as the sum of the modules anchor lambda / dt²; If 5000 N is exceeded for two consecutive substeps, the support is switched off. The last destroyed support frees the part without zeroing the speeds of the nodes. The stand supports are motionless and absorb impulse, so the “one hood” system is not closed.

The contact is only a nodal one: plane y=0.015 with simple friction, without rebound. The visible SCX and contact nodes follow the same deformation, but there is no exact contact of all triangles with the floor. The pillars are visual reference points without conflict. There is no self-collision, arbitrary obstacles, body/suspension, two-way forces between parts, destruction communication with EngineWorld.detach/Java API and saving this frame to a network buffer. These are the following integration tasks, not properties of the current demo.

## Reproducible verification

`npm test` checks skinning translation/rotation, input pulse, break only after physical steps, crash, reset, render frequency independence and failure on incorrect data. `npm run verify:hood` reads the original local SCX/CFG, checks the binding of all vertices, the second of exposure and six seconds after impact. The result is stored in the ignored `local/hood-verification.json`; There are no game files in the repository.

|Pulse|Maximum node displacement after holding|Offset after 6 s|Supports destroyed|Plastically modified connections|
|---|---:|---:|---:|---:|
| 0 |0.035 mm|0.017 mm| 0/3 | 0 |
|5 N s|2.22 mm|0.022 mm| 0/3 | 0 |
|65 N s|36.88 mm|12.69 mm| 0/3 | 73 |
|650 N s|2.97 m|2.97 m| 3/3 | 912 |

For a torn part, the displacement includes its movement around the world and is not the depth of the indentation. The numbers characterize the selected frame and material, not corresponding to the blows in the old EXE. Without impact, plastic connections and fastenings remain intact.
