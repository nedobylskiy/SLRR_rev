# CFG suspension slot/linker experiment

Branch: `codex/suspension-slot-linker`, based on `codex/physics-reverse-port`.
This tests the supplied community hypothesis against installed CFGs and the
reverse implementation, without using visual calibration offsets.

## Evidence

Reference checkout: `nicolas-found42/street-legal`, commit
`33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799`.

- `native_car.rs::finish_layout` binds slot types 101–200, 201–300, and
  301–400 to different references inside the indexed wheel record (+0xc,
  +0x1c, +0x2c). The CFG slot ID itself is not the wheel index.
- `native_install.rs::render_flags` inherits the root mount's type through
  installed-on records. `mount_group` computes `(type - 101) % 10` for
  types 101–400.
- `linked_record` searches the current part before its installed-on parent.
- `add_linked` adds the inherited group to both anchor IDs, preserves their
  order, and selects the first matching declaration. Its optional third value
  matches the target slot on the parent (`install_inner` writes that ID to
  the installed-on record +0x10).
- One anchor retargets `bone00`; two anchors register a wheel-owned linked
  render. The previous renderer ignored the single-anchor placement entirely.

## Implemented experiment

The shared linker now resolves self/ancestor anchors with inherited group and
full frame orientation. Ordered, per-render `linked` alternatives survive CFG
loading. Rendered single-anchor control arms now receive the anchor transform;
CV shafts keep ordered two-anchor placement. Springs and dampers use the same
resolver. Existing debug controls remain additional visual adjustments.

## Reproduction and results

Run `npx tsx tools/audit-suspension-links.ts` with the installed game available
(or set `SLRR_GAME_ROOT`). The probe builds mechanical stock assemblies for
Einvagen resource 6 and Baiern resource 6, with zero debug offsets. It checks:

| Component | Resolved | Missing |
| --- | ---: | ---: |
| Single-anchor control arms | 8 | 0 |
| Two-anchor CV shafts | 4 | 0 |
| Spring/damper pairs | 16 | 0 |

Einvagen rear control-arm anchors resolve to approximately
`(+0.263, +0.131, -0.290)` / `(-0.263, +0.131, -0.290)` meters relative to
the corresponding hub. Baiern resolves to
`(+0.337, +0.157, -0.316)` / `(-0.337, +0.157, -0.316)`.
These values come from CFG, not a fixed vehicle-specific correction.

Regression tests cover nested ownership, self-before-parent lookup, anchor
orientation, parent-slot filtering, declaration order, live hub travel, and
spring/damper endpoints.

## Limits

The asset probe verifies binding and transforms, not pixel matching to the
original renderer. General named-bone/skinned-mesh retargeting remains absent;
single-anchor placement currently moves the rigid additional mesh as a whole.
Two-anchor fitting still uses authored +Y bounds, rather than original bone
matrices. The three native WheelRef transform nodes have not been fully ported;
the simulation still provides its existing carrier travel/steering approximation.
This experiment does not establish that the separate +0.165 m ride-height
calibration is correct or fix its physical cause.

For visual evaluation, reset all suspension alignment controls first, hide the
body shell, and compare the rear control arms in the garage. Keep height
calibration separate from linker placement.
