# Suspension alignment debug

Open **Graphics / map debug → Suspension alignment (visual debug)** in the garage
or a driving scene. Controls update existing meshes immediately, without
rebuilding the vehicle.

- Front and rear attachment offsets: chassis X/Y/Z axes, meters, ±0.5 m.
- Rear control arm rotation (`rearRotation`): single-anchor additional renders,
  around their mesh bounds center, local X/Y/Z axes, degrees, XYZ Euler order.
  This does not rotate the wheel/hub or the two-anchor CV shaft.
- Rear CV shaft rotation: separate adjustment of two-anchor linked renders,
  around the authored mesh bounds center, before their attachment transform.

Both left and right corners use the same values. Offset changes include the
independent wheel, suspension, and strut branches selected by CFG slot types
101–104, 201–204, and 301–304. Descendants inherit the adjustment once.

The numeric inputs allow exact values. The read-only JSON field can be copied
to report a calibration; **Reset suspension alignment** restores zero values.
**Load height calibration (+0.165 m)** restores the user's measured front/rear Y
offset without changing rotation values.
Settings last for the page session and apply to displayed vehicle instances,
not inventory thumbnails. These are render-only diagnostics: Java slot data,
physics, ground contact, and saved cars remain unchanged. Use them to identify
the underlying attachment correction, not as a permanent suspension tune.
