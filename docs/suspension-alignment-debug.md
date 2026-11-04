# Suspension alignment debug

Open **Graphics / map debug → Suspension alignment (visual debug)** in the garage
or a driving scene. Controls update existing meshes immediately, without
rebuilding the vehicle.

- Four independent attachment offsets (FL/FR/RL/RR): chassis X/Y/Z axes,
  meters, ±0.5 m. They move the selected corner's wheel/hub/strut branches.
- Four independent wheel-only offsets: chassis X/Y/Z axes, meters, ±0.5 m.
  They move the rim/tire branch and its descendants without moving the hub.
- **Garage steering**: normalized vehicle steering input from -1 to +1.
  It uses the existing CFG/Ackermann display steering path, so wheels and hubs
  turn together. Zero centers them. **Restore script steering** releases the
  alignment override and restores Java `setsteer` control. This control does
  not relocate the cockpit steering wheel and does not override driving input.
- Rear control arm rotation (`rearRotation`): single-anchor additional renders,
  around their mesh bounds center, local X/Y/Z axes, degrees, XYZ Euler order.
  This does not rotate the wheel/hub or the two-anchor CV shaft.
- Rear CV shaft rotation: separate adjustment of two-anchor linked renders,
  around the authored mesh bounds center, before their attachment transform.

The left and right rear arms have independent offset and rotation controls.
Positive arm X offset moves outward (left X is negated); Y/Z offsets have the
same sign. Matching rotation values mirror across X (left Y/Z angles are
negated). These adjustments use mesh-local axes, around the mesh bounds center.
The earlier `rearRotation` remains a shared, unmirrored rotation adjustment.

Legacy JSON fields `frontOffset` / `rearOffset` remain shared additive values,
defaulting to zero; the UI exposes independent per-corner fields instead.
Attachment offset changes include the
independent wheel, suspension, and strut branches selected by CFG slot types
101–104, 201–204, and 301–304. Descendants inherit the adjustment once.

The numeric inputs allow exact values. The read-only JSON field can be copied
to report a calibration; **Reset suspension alignment** restores zero values.
Vehicle assembly now includes the user's measured +0.165 m Y correction in
the chassis wheel/hub/strut slot frames. Installation, parked settling, linked
anchors and physical suspension hardpoints all use those same frames. Original
CFG data is unchanged; rebuilding from a save reapplies the correction once.
`PartFactory.stock` accepts `suspensionMountOffsetY: 0` for an uncalibrated audit.
This is an explicit measured calibration, not a recovered original-game formula.

**Use base height (+0.165 m)** clears the extra visual Y offsets. Zero sliders
therefore keep the corrected assembly height; setting +0.165 again would add it
a second time visually.
Settings last for the page session and apply to displayed vehicle instances,
not inventory thumbnails. These are render-only diagnostics: Java slot data,
physics, ground contact, and saved cars remain unchanged. Use them to identify
the underlying attachment correction, not as a permanent suspension tune.
