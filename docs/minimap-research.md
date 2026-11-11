# Minimap and Navigator: upstream research

Audit date: November 10, 2026. Branch `minimap`, created from `main` at `77b0fb6` after fetching origin. This is a source and installed-resource audit; upstream applications and their C++ tests were not built or run.

## Implementations found

| Repository / inspected revision | Evidence | Assessment |
|---|---|---|
| nicolas-found42/sl-remastered `1721525` | [src/natives/navigator.cpp](https://github.com/nicolas-found42/sl-remastered/blob/1721525/src/natives/navigator.cpp), [tests/native_navigator_test.cpp](https://github.com/nicolas-found42/sl-remastered/blob/1721525/tests/native_navigator_test.cpp), scene camera helpers | Dedicated `Navigator.updateNavigator` implementation: follow camera, modes 0/1, map-bound clamp with offset writeback, static and dynamic symbol placement, direction-preserving viewport-edge clamp. Focused tests cover camera matrices and marker projection/clamping. Best isolated reference for native placement maths. |
| EliasFD3S/openslrr `be00046` | [src/natives/natives_renderref.cpp](https://github.com/EliasFD3S/openslrr/blob/be00046/src/natives/natives_renderref.cpp#L173) | Working code path registered for the Java native: follows car or `gmCamera`, preserves camera height, chooses yaw from mode, updates static and moving marker RenderRefs. Simpler than the detailed reverse; no equivalent marker-edge/map-bound clamp in this handler. Source presence does not establish full end-to-end visual parity. |
| EliasFD3S/slrr-reverse `5c42f3b` | [engine/Runtime/Cars/Cars.cpp](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b/engine/Runtime/Cars/Cars.cpp), [GameRef_part3.inc](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b/engine/Runtime/Resources/GameRef_part3.inc) | Detailed reverse of `00482D30` update and `00482C40` marker projection, with native addresses/constants. Also includes host tile/marker/route drawing. Its comments explicitly distinguish the absolute RenderRef tile path from invented OSD fallbacks, including dotted routes and fallback icons. Do not treat those fallbacks as recovered native behavior. |
| nicolas-found42/street-legal `33eca3c` | [crates/slr-game/src/session.rs](https://github.com/nicolas-found42/street-legal/blob/33eca3c/crates/slr-game/src/session.rs) `draw_minimap` | A different, lightweight race HUD: fits track points into a square and draws the track and racer dots. Useful example, but not the original city Navigator/tile renderer. |

The local research checkouts were clean before fast-forward updates. OpenSLRR and sl-remastered gained source updates; slrr-reverse and street-legal were already at their fetched branch heads. No upstream source was changed.

## Original installed Java/resources

The installed `sl/Scripts/game/src/Navigator.java` owns the layout, local Dummy root, map tile RenderRefs, duplicated render/mesh resources, markers, viewport, zoom and route lifecycle. `updateNavigator(GameRef,int)` is the native positioning step, not the whole minimap renderer.

Classic Navigator construction:

1. Resolve the base tile render, mesh and initial texture from RPK.
2. Duplicate render and mesh resources for each tile, replace its texture and instantiate under the Navigator's private root.
3. Place tiles at `(left + column * size, -0.001, top + row * size)` in the map's authored coordinate space.
4. Texture RID advances by one per column, with `modulo` additional IDs skipped after each row: `first + row * (columns + modulo) + column`.
5. `show()` creates a separate Camera and Viewport; Java initializes camera height from zoom. The native follows the player and updates symbols.

The installed constructor calls are:

| Map / caller | left | top | tile size | render / mesh / first texture (local RID) | columns × rows | modulo |
|---|---:|---:|---:|---|---|---:|
| City / `Valocity.java` | -23.482 | -24.45 | 5.828 | `maps.city.smallmap:1 / 2 / 5` | 8 × 8 | 8 |
| Test Track / `TestTrack.java` | -7.957 | -15.996 | 2.64 | `maps.test_track.smallmap:1 / 2 / 5` | 6 × 8 | 10 |

Installed-asset validation through our `Assets.resource` and `modelForResource` resolved every referenced tile without missing files:

- City: 64 slots, 64 distinct DDS paths. Sample `a1.dds` is 256 × 256. Base mesh `maps/city/smallmap/meshes/a1.SCX`.
- Test Track: 48 slots, 33 distinct DDS paths, including shared `defgreen.dds`; all slots resolve. Sample `a2.dds` is 256 × 256. Base mesh `maps/Test_Track/smallmap/meshes/a1.SCX`.

This is sufficient authored artwork for a textured minimap; a top-down render of the live streamed city is unnecessary. The resource namespace and RID stride should drive tile selection, rather than guessing texture filenames.

## Camera, modes, markers and routes

- Java `changeMode()` resets the map camera to `(0, zoom, 0)` with downward pitch approximately -1.57. Default zoom is 4.5. The ordinary viewport defaults are `(0.03, 0.78, 0.2, 0.18)` in the installed Java; V4 changes them. Read live Java values rather than hard-coding a host fallback's rectangle.
- Mode 0 preserves camera rotation, follows position plus `offsetX/Z` and in the detailed reverse clamps the camera against map bounds, updating offsets. Mode 1 follows vehicle yaw and sets the map-camera pitch. Additional OpenSLRR modes using `gmCamera` are port behavior and need separate validation against our installation.
- Static symbols take position from Java `Marker.pos`; moving symbols use `Dynamarker.mover` position and heading. The detailed reverse projects symbols into normalized viewport space and scales off-screen positions toward limits +/-0.9 horizontally and +/-0.85 vertically while preserving direction.
- Coordinate conversions are a porting trap: map models, centimetre SCX geometry, RenderRef bone matrices and gameplay metres use different scales. The inspected ports contain 0.01, 0.1 and 10 multipliers at different boundaries. Port the complete transformation chain and verify seams and marker alignment; do not copy a single multiplier in isolation. In particular, inspect `setBoneMatrix` and camera setters alongside the native caller.
- Installed build 940 also has V4 router/minimap/still-minimap modes. `setupV4`, `regenerateRoute`, `SkidMark` and line RenderRefs handle route-based views. Native `updateNavigator` does not itself calculate the road path. A route line and a textured classic map are separate features.

## Implemented host adapter

`NavigatorNative` now implements `updateNavigator(GameRef,int)` and reads the live Java tile grid, resource replacements, viewport, zoom, static markers and moving markers. Java continues to choose each map's RPK and tile layout. Camera coordinates and marker poses are adapted into a separate unlit Three.js pass in the OSD stage. The host also draws Java `routeData`; generic `RenderRef.lineCreate/lineAdd` remain mocked.

The Graphics / map debug panel provides Java/original, north-up and heading-up modes. The Minimap preview test opens the original Navigator constructors from City or Test Track Java sources, with sample static/moving markers, position, heading and zoom controls. Sample markers exist only in this preview.

Referenced tile textures and immutable geometry are cached for the NavigatorView lifetime. Resource jobs are limited to three concurrent tasks. All referenced tiles may be loaded; Three.js frustum culling skips off-screen tile draws. Textures retain repeat wrapping because authored Test Track UVs extend outside 0..1. Hidden game UI skips minimap rendering. The pass runs at approximately 30 Hz without world geometry, lighting, shadows or Hi-Z. Disposal releases its textures, geometry and WebGL context.

Validation: the installed original Java creates 64 City tiles with 64 distinct textures, and 48 Test Track slots with 33 distinct textures. The integration verifier checks both RPK sets, marker construction, heading mode and hide/finalize. Browser previews verify map switching, markers, heading rotation and zoom. Exact native transform parity and interactive full-map behavior remain separate work.
