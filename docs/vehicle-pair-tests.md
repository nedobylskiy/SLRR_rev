# Two-car collision stand

Open **Car and obstacle**, then select one of the two-car buttons. The stand loads two independent complete stock Baiern assemblies with their original CFG/SCX geometry, engine and running gear.

## Scenarios

| Scenario | Car A | Car B | Alignment |
|---|---|---|---|
| 50% overlap | 50 km/h forward | 50 km/h in the opposite direction | Half a chassis width of lateral offset; 100 km/h initial closing speed |
| Side impact | 50 km/h forward | Stationary | B is perpendicular to A; A strikes the middle of B's side |
| Barrier + rear hit | Starts at 50 km/h toward a fixed barrier | Starts at 100 km/h in the same direction | Both start immediately, separated by 27.8 m bumper-to-bumper (one second of travel at B's initial speed) |

Speeds refer to the initial velocities, not a forced constant velocity during impact. Suspension, tyres and contacts can change them during the approach. The HUD displays both current speeds, body condition and measured closing speed at the first contact.

In the chain scenario both cars are visible and physically integrated from the first tick. A reaches the visible barrier first; B catches it from behind. The one-second value defines the initial following distance, not a timed event. No timer, staged approach or repositioning schedules the rear impact. Its time and speed emerge from vehicle motion and contacts. Slow motion and pause apply to both vehicles together. The HUD displays the measured rear impact time and B's impact speed. Restart restores both assemblies and the initial following distance.

**Restart same collision** restores both assemblies, attachments and deformation, then repeats the same setup. The controls also provide pause, quarter-speed playback, cage visibility, scenario switching and a return to the original obstacle stand. Camera controls remain orbit, pan and zoom.

## Physics boundary

Both vehicles run the existing Vehicle3D suspension and XPBD panel model at 120 Hz. A shared FixedClock advances both simulations once per tick. The contact impulse uses both finite masses and world-space inertias; equal and opposite impulses act at the same world-space contact point. Contact loads feed the existing local damage model on both cars. Position correction is mass-weighted and separate from restitution.

This first inter-vehicle contact implementation uses chassis OBBs, not the full deforming collision meshes. It does not yet resolve detached debris against the other vehicle or use the other vehicle as wheel support. It is a repeatable collision experiment, not a complete traffic collision system.

Implementation: [vehicle-pair-test.ts](../src/engine/vehicle-pair-test.ts), [Vehicle3D contact entry point](../src/engine/vehicle-3d.ts), and the [viewer](../src/render/viewer.ts).

## Validation

- Synthetic tests check impulse exchange, linear momentum conservation, non-increasing kinetic energy, side impact, separated hulls, damage/reset of both cars and identical trajectories at different render rates.
- Both the TypeScript and WASM soft-body paths are exercised.
- A local headless run using two original mechanical Baiern assemblies produced first-contact closing speeds of approximately 99.9 km/h (offset) and 49.9 km/h (side). Both cars received damage, with finite states throughout three simulated seconds per scenario. This does not replace visual in-browser validation.

Run the synthetic checks with:

```powershell
node --import tsx --test tests/vehicle-pair-test.test.ts
node --import tsx --import ./tools/enable-soft-body-wasm.ts --test tests/vehicle-pair-test.test.ts
```
