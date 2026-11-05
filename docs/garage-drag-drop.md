# Garage drag and drop

The browser transports left-button drags to the original Java OSD handlers.
Dragging starts after five pixels of movement; pointer capture keeps the gesture
active outside its source. Releasing over an enabled `enableDrop()` button calls
`Button.drop(GameRef)` for a vehicle part or `Button.drop(Gadget)` for an inventory
button. The synthetic click following a drag is suppressed.

This supports the mechanic repair/sell targets, vehicle-to-inventory drops, and
inventory panel swaps through their Java implementations. Disabled or hidden
targets, self-drops, and cancelled gestures do not dispatch a drop. Ordinary
clicks and right-button camera controls remain separate gestures.

Acceptance and economics are script-owned. In the installed version,
`Mechanic.java` accepts inventory gadgets for repair and sale; direct world
objects are accepted for repair only when they are a disassembled chassis.
Ordinary mounted parts must first be removed to the inventory. The host does
not bypass these restrictions. Drops onto the 3D world are not implemented by
this OSD transport.

Regression coverage: `tests/java-mouse.test.ts` and
`tests/osd-button-native.test.ts` exercise gesture transport, both Java overloads,
drop context cleanup, click suppression, cancellation, and target eligibility.
