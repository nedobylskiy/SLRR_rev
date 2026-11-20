# Streamed rival rendering and damage

Original 2.2.1 creates rivals as native-only `dummycar` handles and sends
`texture <resource ID> 1` before registering them as traffic. The traffic
bridge resolves that command's texture resource and applies it to paintable
stock parts. Scripted assemblies retain their explicit per-part textures.

Installed wheels rotate in their actual calibrated chassis slot frames.
Meshes are converted into those frames before reparenting under spin pivots.
This preserves their stationary placement and avoids rotation around the
separate ray-suspension query location. Mirrored hub frames reverse spin.

Registered rival assemblies use separate XPBD `DeformablePanel` cages for
the chassis, hood, trunk, doors, bumpers and side panels, rather than the
ordinary traffic car's single crush field. Cages and private mesh buffers
are created on the first significant impact, only for affected parts.
They use the existing solver and body-panel stiffness/yield settings.

The panel solver runs in carrier-local coordinates. Its motion is driven
by impact loads; ordinary suspension movement cannot wake it. This remains
a bounded rival damage model: it does not run the player's complete
detached-part/world-contact or mechanical attachment simulation.

Each new significant impact opens a maximum **2,000 ms wall-clock** window.
After expiry node velocities are cleared and the deformed geometry stays
frozen until another impact. No ongoing solves or vertex uploads occur
while frozen. The rigid traffic body and its suspension continue normally.
`Rival panels CPU` measures the aggregate panel solve and skin update time.
Repositioning an existing rival instance preserves dents; destroying its
stream instance currently discards this host-only panel state.

Tests cover the idle state, expiry, repeated impacts, private geometry,
collision-load forwarding, Java paint commands and calibrated hub pivots.
