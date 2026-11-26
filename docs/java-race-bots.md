# Java race opponents

`JavaSceneVehicles` discovers the active section's `Bot.car` and `Bot.brain`.
The brain's `renderinstance` command identifies the original Java-created driver
render. It is bound to the assembled car through the same seated driver IK used
for the player, including steering-wheel grips. Both models are awaited by scene
readiness; no replacement driver is invented.

`AI_BeginRace` and `AI_suspend` hold the car. `AI_race x,y,z opponentId` starts a
route to the requested destination. Reissued commands retain issue order, so a
later suspension overrides an earlier race. The route uses the road routing
service; disconnected destinations hold the brakes instead of choosing random
traffic branches.

The opponent uses `Vehicle3D`, its normal fixed simulation step, mechanical
drivetrain, suspension, map collisions and deformable panels. The controller
starts the engine, selects first gear from neutral, follows the route with
lookahead steering and slows for turns and the finish. Its pose is published
back to the existing Java car and tested against Java triggers, allowing the
original finish handler to determine the winner by car ID. Trigger occupancy is
tracked per car, so the player and rival do not overwrite each other's state.
Late Java placements (including the start line) are applied to physics once;
physics publications do not feed back as new teleports. Lamp render channels use
the engine, brake, reverse and game time state. Race opponents have a separate
`Race opponents CPU` timing.

This is a host implementation of race control, not a reconstruction of the
original native AI. Overtaking, obstacle recovery and difficulty tuning still
need work. Player/opponent, opponent/opponent and opponent/traffic contacts use
the pair contact solver. Hitting traffic invokes its normal impact callback,
waking puppet vehicles into physical response.

Regression coverage checks the original driver handle, readiness ordering,
command arbitration, pose publication, cleanup, route steering, and movement of
a complete physics fixture after `AI_race`.
