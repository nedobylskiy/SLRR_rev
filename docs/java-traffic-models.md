# Original Java traffic population

Source inspected: installed `sl/scripts/game/src/Valocity.java`, `enter()`, daytime and night-time `map.addTraffic(...)` calls; police identity from `City.java`. These declarations are now captured from executed Java by `TrafficNative`, rather than duplicated as a fixed runtime list.

The daytime branch (`hour > 4 && hour < 22`) declares the following resources, all root ID `0x0006`. `M` is the Java-selected traffic multiplier (normal, weekend, lunch or rush hour); the executed VM's numeric results are used directly, including zero weights.

| RPK below `cars/traffic/` | Java count expression |
|---|---|
| Taxi | 40 × M |
| Ambulance | 10 × M |
| FireEngine | 12 |
| Coach | 15 × M |
| Schoolbus | 30 × M |
| ArmoredVan | 20 |
| Wagon | 100 × (M / 2) |
| Erbilac, Erbilac_2, Erbilac_3 | 50 × (M / 2) each |
| CivilVan, CivilVan_2, CivilVan_3 | 50 × (M / 2) each |
| Peterbild, Peterbild_2, Peterbild_3 | 25 × M each |
| Pickup, Pickup_2, Pickup_3 | 40 × M each |

Career additionally declares `cars/misc/Police.rpk:0x0006`, weight 30; demo uses 50. Night declares Erbilac 20, Peterbild 20, Pickup 20, CivilVan 10 and Taxi 150, plus Police 3 in career or 20 in demo. Opponent Java Bots use the separate `addTrafficCar`/notification path; that individual entity integration remains mocked.

## Runtime policy

- Capture `addTrafficN(GameRef, int/float, float, float, float)` per ground, resolving packed/remounted IDs to the original RPK and local resource ID.
- Use the requested counts as relative model weights; **Traffic cars** independently caps the active host population at 0–50. Zero/nonpositive counts are not selected. The other three parameters are retained without assigning unverified behavior.
- `delTraffic` clears the owning ground's catalogue. Other maps are unaffected. The scene bridge updates the viewer when the catalogue changes. Explicit empty catalogues create no cars; direct preview with no Java catalogue uses Pickup.
- Cache each model per asset set/RPK/root ID. Reuse its geometry, materials and decoded flare images across instances; instance physics/damage remain independent. A failed model is reported/skipped while other valid Java models continue.
- Native return IDs are host catalogue registration IDs; original ID parity is not claimed. Full original traffic persistence and individual Bot registration are not implemented.

## Local asset validation

All 19 regular models and Police were assembled from original resources; root wheels and inline SCX wheel renders and lamp resources resolved. Peterbild variants have six wheels; the others have four. Taxi's hood uses `colors 0 0x00000000`; the CFG reader now accepts this specific empty-palette zero placeholder while still rejecting malformed nonzero trailing colors.

Tests cover Java-to-native resource registration, both count overloads, map isolation, immutable catalogue snapshots, density weighting, clearing, the 50-car cap constant and the Taxi CFG case. Browser testing uses original model templates and the production streamed traffic renderer; it does not claim full native/executable parity.
