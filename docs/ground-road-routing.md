# Ground road routing and race traffic exclusions

`GroundRoadNative` implements `getRouteLength(Vector3,Vector3)`,
`getStartDirection(Vector3,Vector3)` and `haltTrafficPath(Vector3,Vector3)`
against the receiver ground's own cached TRC graph.

In the original 2.2.1 City data, `RoadPath.refs[1]` and `refs[2]` identify
the two endpoint crossings of a shared street centreline, not its travel
direction. Lane records refer to their parent path in `RoadOther.refs[0]`.
Crossing links establish direction per lane: flag zero departs, nonzero
arrives. A street receives both directed edges only when lanes support
both directions. Samples are oriented to each edge's departure and arrival.
Treating path endpoint order as one-way incorrectly removes legal routes
and produces large detours. Endpoints projected inside a two-way street
consider both legal directions before selecting the shortest route.

Queries project endpoints onto sampled road geometry or nearby crossing
centres. A directed shortest-path search minimizes distance in metres,
including partial endpoint roads and access distance. The result direction
is a normalized forward tangent at the start, returned as an independent
Java vector. Missing/unreachable routes return `-1` for length and `null`
for direction; coincident endpoints have zero length and no direction.

This is a host approximation: Hermite curves are sampled, crossings connect
through their centres, and lane-specific intersection restrictions are not
part of this route search. It does not claim parity with the original native
solver or exact reproduction of the original race route selection.

Path halts exclude every lane in both directions of the selected streets.
The host stream removes existing traffic on those lanes and prevents new
spawns there. Crossing halts hold approaching cars even under green until
their requested duration in seconds expires. Cars already crossing may exit.
`clearHalts()` clears the receiver's exclusions; path halts otherwise last
for the ground's lifetime. Masks are cached by revision and shared with
background AI; replies using a superseded mask are discarded.

Validation: `tests/road-route.test.ts`, `tests/agent-worker.test.ts`, and
`npx tsx tools/verify-ground-roads.ts` (set `SLRR_GAME_ROOT` to the installation).
`RenderRef.plotRoute(ResourceRef,ResourceRef,int,float,Vector3)` consumes
the last ground route query, matching the implicit endpoint-free Java call
sequence in RaceSetup. It snapshots scaled points into a navigator-owned
render resource, with ARGB color and world-space ribbon width. Navigator
replacement/destruction controls its lifetime; it is excluded from the
main world render. Missing routes return zero rather than reusing stale
query points. Generic SkidMark `lineCreate`/`lineAdd` remain separate mocks.

The route tests validate queries, native creation/destruction and minimap
data delivery, not the complete RaceSetup UI flow.

RaceSetup's map is interactive only while Java's `navigator click-object`
exists under the Navigator local root. Pointer clicks are unprojected through
the displayed minimap camera onto its XZ plane, then forwarded as `EC_LCLICK`
notifications on that exact native object. `MouseCursor.getPickedPos()`
returns the smallmap-space point; original Java multiplies it by 100 and
selects a road crossing. Normal driving minimaps remain transparent to input.
