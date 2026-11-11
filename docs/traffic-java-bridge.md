# Java traffic lifecycle bridge

The original `Valocity.java` registers police through `GroundRef.addTraffic` and rivals through `addTrafficCar` followed by `notifyTrafficCar(id, 1)`. Police use `cars.misc.Police:0x0006r`. In career mode the authored police density is 30 by day and 3 by night, before the Java `Config.trafficDensity` multiplier; these are host selection weights, not exact vehicle counts.

## Streamed presence and coordinates

- A visible streamed vehicle has a native GameRef, a stable traffic registration ID, a resource type and current world position, heading and velocity.
- The bridge sends `car_add <native car id> <traffic registration id>` to the bound Java Track after placement. Recycling/deactivation sends one matching `car_rem <native car id>`. Visibility here means active in the streamed population, not merely inside the camera frustum or passing Hi-Z.
- Java `getPos`, `getVel`, `getInfo(GII_TYPE)` and `getInfo(GII_CAR_TRAFFICPTR)` refer to that same car. Type queries preserve the registration's original Java numeric type so `City.GRI_POLICECAR` comparisons work.
- `City.handleEvent(GameRef,int,String)` owns `TrafficTracker` creation and Navigator markers. Host code does not add a second police/rival marker.
- The bridge target is the Track owning the map. Pending removals retain their original target when sections change.

## Script-created rivals

`addTrafficCar` registers the already-created native car and returns a nonzero ID. Registration is scoped to its ground; repeated registration of the same live car keeps its ID. `notifyTrafficCar` controls appearance notifications. `remTrafficCar` removes the registration and streamed presence while leaving destruction/release of the Java-owned car to Java.

Rival candidates have unique registration IDs and cannot spawn twice simultaneously. Under the user's traffic cap, up to half the slots are reserved for nearby registered rivals; ordinary traffic fills unused capacity. When rivals approach, ordinary off-screen instances can release their slots without making visible cars disappear. Unspawned registrations are allowed when there is insufficient capacity or safe spawn space. The optional position passed to `addTrafficCar` seeds its native location and is attached to a nearby graph lane. Streamed rivals are selected only when their estimated location is in range and materialize there after the ordinary spawn-clearance checks, rather than being recycled to a random road near the player.

The renderer projects the actual Java installed assembly, paint and saved panel state, rather than assembling a fresh factory replacement. Distant and nearby movement still use the existing simplified traffic body/LOD. Full-car wheels use the installed wheel geometry with the traffic suspension/spin transforms. This is not yet a switch to full racer soft-body simulation during a pursuit.

## Distant rival position estimates

Registered rivals without an active streamed instance update on a five-second wall-clock cadence, independently of the visible traffic cap. Each tick chooses a lane sample within `speed * 5 seconds` of the previous graph position. Speed uses the existing local ranges: 15–35 km/h for urban roads and 60–100 km/h when either adjacent crossing is yellow. Candidates cannot jump to a different height level or into the protected near-player zone (physics radius plus 20 m).

The initial Java position may be off-graph; it is attached to the nearest usable lane before subsequent bounded moves. These are coarse position estimates, not continuous lane following: no models, collisions, suspension or signal simulation run for them. Their native GameRefs keep the estimated position, heading and velocity. Visible streamed cars keep per-frame movement authority. When a rival approaches, its model loads from its current graph location; no forced relocation near the player is used to fill the cap.

## Remaining police AI work

This bridge implements observation, identity and ordinary traffic movement. `City.wakePoliceScout`, route-distance queries, `AI_follow`, `AI_GoToTraffic`, pursuit horns/drivers and `addTrafficP` reinsertion are not completed by this change. Original Java can now discover nearby police, but the full chase path still requires these native/AI capabilities.

## Verification

`npm run verify:traffic-java` uses the installed original Java sources. It constructs Valocity without entering or modifying a saved career, streams a police car, verifies the original `policeCars`/marker lifecycle, then registers a real Baiern rival and checks the original `opponentCars` lifecycle. It also projects the rival's 75 installed parts through the bridge selection callback.

Unit tests cover live coordinates, Java type/traffic IDs, balanced notifications, duplicate prevention, wrong-ground removal, stream recycling and preservation of Java-owned cars. Host IDs are opaque registration identifiers, not recovered original native pointer values.
