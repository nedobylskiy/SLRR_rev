# Knockable map props

Map object ICFG bodies with positive mass are movable. Zero-mass map bodies
remain static. This includes the City bins (`kuka_*`), the small No Parking
sign (`tabla_a`, 100 kg), and the advertising column (`tabla_c`, 400 kg).

The loader reads box bodies and physical SCX extents in the body pose. SCX
centimetres are converted to metres. Declared CFG bounds provide a fallback
when a legacy physical mesh does not fit its declared object extent.

Before contact, a prop has only an indexed collision trigger and streamed
instances. Its rigid body is allocated on first chassis contact. The impact
exchanges linear and angular impulse using the vehicle and prop masses and
inertias. Active props integrate at 120 Hz against map terrain and side walls.
After 0.8 seconds of low linear/angular velocity they sleep, keeping the moved
pose and collider. Another impact wakes them at that location.

All render components share the object's motion delta. Movement updates their
streaming bounds and Hi-Z sources. Movable placements stay out of immutable
cached cells and static shadow baking; they cast ordinary dynamic shadows.
Only affected model batches are updated, rather than scanning the city's
placements every frame.

Current approximation: each object is one rigid box derived from its physical
extent, rather than a deformable or exact convex mesh. Prop-to-prop collisions
and persistence across map reloads are not implemented. Vehicle interaction
currently changes rigid motion without feeding a panel damage impulse.

Regression coverage: `tests/map-props.test.ts` and the moved-prop case in
`tests/map-object-stream.test.ts`.
