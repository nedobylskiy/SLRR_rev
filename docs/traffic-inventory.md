# Valocity traffic inventory

Inspected against the installed original game on 2026-11-08. Source: `sl/Scripts/game/src/Valocity.java`, lines 93–192; police resource is defined in `sl/Scripts/game/src/City.java`, lines 27–28.

All named traffic packages below use resource `0x00000006` in `cars/traffic/<name>.rpk`. These are requested traffic populations, not counts verified as currently rendered by the remaster. `M` means the script's time/day-dependent `trafficMultiplier`.

| Package | Day request (hour > 4 and hour < 22) | Night request |
| --- | --- | --- |
| Taxi | 40 × M | 150 |
| Ambulance | 10 × M | — |
| FireEngine | 12 | — |
| Coach | 15 × M | — |
| Schoolbus | 30 × M | — |
| ArmoredVan | 20 | — |
| Wagon | 100 × (M / 2) | — |
| Erbilac | 50 × (M / 2) | 20 |
| Erbilac_2 | 50 × (M / 2) | — |
| Erbilac_3 | 50 × (M / 2) | — |
| CivilVan | 50 × (M / 2) | 10 |
| CivilVan_2 | 50 × (M / 2) | — |
| CivilVan_3 | 50 × (M / 2) | — |
| Peterbild | 25 × M | 20 |
| Peterbild_2 | 25 × M | — |
| Peterbild_3 | 25 × M | — |
| Pickup | 40 × M | 20 |
| Pickup_2 | 40 × M | — |
| Pickup_3 | 40 × M | — |

Police uses `cars/misc/Police.rpk:0x0006`: career requests 30 by day / 3 by night; demo requests 50 by day / 20 by night.

Daytime career also loops over `GameLogic.speedymen`. With `Math.random() > 0.2`, eligible Bot entries load a saved car through `getCar(map)` or generate a complete Vehicle, then call `addTrafficCar` and `notifyTrafficCar`. This is a second population, separate from the fixed traffic packages. The native traffic calls currently remain mocks; creating Java car instances does not prove that road traffic is being simulated.

## Verified asset loading

Loaded `cars/traffic/Coach.rpk:0x0006` through `PartFactory.stock`, then `Viewer.showWorld`, with original SCX geometry and textures. The body assembled without render warnings. Four wheel models were added in the scratch preview using the original CFG wheel positions and original wheel resources `0x0a` (front) and `0x0b` (rear). No generated replacement geometry or texture was used.

Screenshots and the isolated preview live under untracked `.codex-attachments/`:

- `traffic-preview.html` / `traffic-preview.ts`
- `traffic-coach-front.jpg`
- `traffic-coach-side.jpg`
- `traffic-coach-rear.jpg`

The isolated preview avoids Java menu overlays and does not change the game runtime.

## Integration findings

- Taxi's stock assembly currently fails on `Taxi_data/scripts/hood.cfg`, line 7: `colors 0 0x00000000`. The parser requires exactly count + 1 arguments; this original file includes an extra zero placeholder for a zero-length palette. Original files were not modified, and no parser workaround was applied.
- Coach defines wheels with inline `wheel` / `render` commands, rather than separate stockpart wheel objects. The current ordinary world preview omits these wheels. Traffic rendering needs to preserve the association between each wheel and its following render command; the scratch preview assembles them explicitly.
- Coach provides high-detail deformable geometry plus a separate low-detail render resource, physical collision meshes and original drivetrain settings. Traffic assets are not necessarily single static meshes.
