# Java inventory previews

Inventory and catalog previews consume the original `InventoryPanel`,
`InventoryItem_Part`, `Camera` and `Viewport` calls. A `Dummy` with the
`WORLDTREEROOT` flag forms an isolated render world. Its meshes and lights must
not be attached to the garage scene.

`JavaPartPreviews` projects the installed Java part tree and its selected render
resources into a separate Three.js scene for each active camera. One transparent
WebGL canvas uses scissor rectangles for the Java viewport bounds. Materials are
unlit, retaining texture alpha, cutouts and glass. No preview lights or shadows
affect the main scene. Static views redraw only when their contents, camera or
viewport change; closing panels releases their scenes and geometry.

HTML hotspot hover is forwarded as a native cursor event with the panel's physics
handle. The original Mechanic/Painter thread then invokes `focusHook`. Standalone
catalog panels have no such caller, so the host schedules their original Java
`focusHook` while hovered. Rotation remains defined by that Java method.
