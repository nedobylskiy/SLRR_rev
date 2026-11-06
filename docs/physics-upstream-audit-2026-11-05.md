# Physics and suspension upstream audit — 2026-11-05

Branch: `physics-behaivor-improve`, created from `main` at `642945c`.
This is an evidence review, not a physics implementation or a claim of driving parity.
GitHub comparisons were checked against fetched Git objects and relevant source,
tests and research notes. No upstream executable, test suite or binary oracle was run.

## Repository inventory

| Repository | Previously examined | Current examined revision | Result |
| --- | --- | --- | --- |
| [sl-remastered](https://github.com/nicolas-found42/sl-remastered) | `7aa574d26098e288367a3707f0b7ac7bb892ebbe` | `1721525eb0d7c6a32b039b844b79c50b7ab10efc` | 106 reachable new commits including merged histories; substantial contact lifecycle and research additions |
| [street-legal](https://github.com/nicolas-found42/street-legal) | `33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799` | same | No updates to main |
| [slrr-reverse](https://github.com/EliasFD3S/slrr-reverse) | `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7` | same | No updates; archived |
| [openslrr](https://github.com/EliasFD3S/openslrr) | `82f9cd7045ea72f2008834898f9183c54d1a2241` | `ee36b85a9d1b8100c68c4fb03437199f1f892b1a` | 10 new commits; vehicle dynamics and native arm/hub pose geometry |
| [SLRR-Proofix](https://github.com/CookiePLMonster/SLRR-Proofix) | No pinned physics baseline | `ff6c0538b778cd3b61f98d3394aac96187d9393d` | Archived; latest commit 2018-06-15; no physics/suspension implementation found in the inspected C++/header/Markdown sources |

The GitHub compare response reported 61 commits for sl-remastered. A complete fetch
and `git rev-list --count 7aa574d..1721525` yields 106, including side histories.
Commit count alone does not measure new equations: several changes publish older
research or merge already existing work.

## New independent suspension pose work in openslrr

Primary references, pinned to the examined revision:

- [Native suspension geometry evidence](https://github.com/EliasFD3S/openslrr/blob/ee36b85a9d1b8100c68c4fb03437199f1f892b1a/NATIVE_SUSPENSION_GEOMETRY.md).
- [Pose implementation](https://github.com/EliasFD3S/openslrr/blob/ee36b85a9d1b8100c68c4fb03437199f1f892b1a/src/physics/suspension_geometry.cpp).
- [Dynamics scope and validation](https://github.com/EliasFD3S/openslrr/blob/ee36b85a9d1b8100c68c4fb03437199f1f892b1a/VEHICLE_DYNAMICS.md).

The new pose solver uses the configured arm radius and normalized hinge axis,
preserves displacement along that axis, and projects onto the arm circle.
Hub mode `0` solves the strut/lower-attachment geometry; mode `-1` follows the
arm-derived frame with alignment. It produces separate arm and hub origins and
orientations rather than moving every suspension component by one translation.

The distinction between CFG wheel reference coordinates, spring hardpoints,
hardware attachment offsets and final rendered tyre centres is explicit.
WheelRef.getPos X/Z is a template contract, not a measurement of the rendered tyre.
Their headless Duhen observations distinguish those two measurements and test
travel-dependent lateral movement and attachment closure.

Our current `parked-suspension.ts` and `suspension-3d.ts` do not solve this arm/hub
geometry. Our WheelRef bindings retain arm/hub/instant-centre inputs, and our
ordered linked-render system already distinguishes steering inheritance, but
that does not provide the missing native pose solution.

Important boundaries:

- Positive-length hub modes, opposite-wheel/live-axle coupling and exact native
  steering/spin coupling remain incomplete upstream.
- This is a pose solve, not the complete native multi-body force/joint solver.
- Much of openslrr's new rigid-body/suspension dynamics explicitly derives from
  **our** SLRR_rev revision `a2ee10de`; it is not independent confirmation of our
  force caps, inertia approximation or integration choices.
- Its geometry note identifies executable SHA-256
  `b284a7a53909d0b9ce59d59ddc11e14df40a7eb74d86fa76efb06305aadc2b03`.
  The installed Steam executable was read-only hashed here and is
  `f44fb88a4335c657e20701cdb84afb8d1d85f7c3aceb93d30113e6e6e44fefc2`.
  The addresses and behavior must not be assumed identical across these binaries.
- No standalone LICENSE/COPYING file or README license declaration was found at
  the examined openslrr root. This audit copies no upstream implementation.

## Contact lifecycle work in sl-remastered

[Contact admission research](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/docs/research/contact-admission-causality.md)
and the changes to `car_world_step`, `physics_contact_geometry`, `physics_cached`
and `physics_multi_root_step` distinguish:

1. Broad-phase candidates and their feature caches.
2. Newly admitted contacts versus retained contact rows.
3. Refresh/correction of retained contacts before new admission.
4. New-ground eligibility around `0.02`, distinct from the retained-contact band.
5. Sampled time-fraction priority and sequential replacement, rather than sorting
   every candidate by penetration/separation alone.

The current implementation explicitly retains unqualified body/body time-priority
and cross-kind replacement behavior. The research still reports an unresolved
box sleep failure: applying the new-contact band alone does not settle it.
Do not import one threshold into our different contact solver and claim a fix.

The production scalar files already used by our numerical port (`wheel.cpp`,
`physics_suspension.cpp`, `car_engine.cpp`, `wheel_tire_force.cpp`, `dyno_model.cpp`
and `car_variable_refresh.cpp`) have no diff between our pinned baseline and
the examined main revision. New research documentation is useful, but does not
mean those scalar kernels need replacing.

[Wheel refresh research](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/docs/research/wheel-refresh-state-20261102.md)
qualifies the same newer executable SHA-256 as our installed Steam copy. It
documents resetting the canonical 17 coefficients before the script callback,
the shared aliases and the distinction between indexed coefficient writes and
derived friction state. Much of this was already available in our baseline;
our follow-up should compare forceUpdate ordering and live consumers, rather
than merely confirming that the setters are registered.

## Relevant unfinished side branches

These heads were fetched and inspected as research, not treated as replacements
for main. They are older divergent checkpoints and omit later main fixes.

| Branch/head | Useful evidence | Explicit unresolved scope |
| --- | --- | --- |
| `codex/issue-18-wheels-wip` / `7f73c4034522f9877be24830badf91ac71d1c95a` | Separate wheel/hub/arm helpers; live settings; collider half-length anchor; rendered-circumference versus callback-time contact measurements | Custom arm/hub geometry not applied; helper rotation and refresh semantics incomplete |
| `codex/issue-16-road-contact-lifecycle` / `fd1b48098bb4dd1a92f372385a569777aa11fae1` | Suspension-before-driving callback ordering; half-probe anchor; contact/force diagnostics | Sleep failure, solver caps and post-braking creep; poor acceleration in the corrected-anchor run |
| `codex/issue-19-transmission-clutch` / `9c382bac5ac8496dbb0c57f4e4566dae888baa01` | Automatic clutch independent of automatic gear selection; semiautomatic controller order and four transmission modes | Installed-engine RPM_maxTorque not refreshed into clutchRpm; no complete driving parity |
| `codex/issue-17-wall-body-collisions` / `aae81278204f836dab6f1281582f281ff0744579` | Body contact lifecycle investigation | Explicitly unfinished contact errors; do not replace our collision path wholesale |

The side-branch documents `tools/parity/wheel-driving-evidence.md`,
`road-contact-evidence.md` and `transmission-evidence.md` preserve the limitations.
Their existence on a separate branch does not make their findings newer than
the subsequently published main research.

## Suggested implementation sequence for this branch

1. Establish headless witnesses for the installed Duhen variants: CFG wheel
   anchors, spring hardpoints, arm/hub frames, rendered tyre centres and travel.
   Keep parked and driven measurements separate.
2. Qualify the supported arm/hub pose equations against the installed binary's
   contract and those fixtures. Apply mount offsets exactly once. Retain an
   explicit fallback for unsupported geometry; do not remove measured calibration
   offsets merely because a different host omits them.
3. Test hardpoint independence from tuned spring rest length. Our driving code
   currently builds its hardpoint from the mounted centre plus rest length,
   while the new evidence distinguishes CFG base/travel from the loaded pose.
4. Audit forceUpdate reset/callback/application order and live WheelRef consumers.
5. Add automatic clutch as a separate control option from gear selection, using
   qualified controller witnesses and the actual installed engine RPM reference.
6. Investigate contact admission/sleep with a minimal falling-body fixture before
   attempting a native multi-body solver port.

## Detached engine observation

The reported engine lying outside the car cannot restart through the current
vehicle MechanicalSystem: `attached()` returns zero when a component no longer
has a parent chain to the chassis, `power` is the minimum required-component
health, and the starter requires `power > 0`. Missing/zero-condition required
components also block restart. `stalled` is currently a generic stopped status;
it does not distinguish detachment from an ordinary stall. This conclusion is
from reading the current code, not reproducing that particular crash.
