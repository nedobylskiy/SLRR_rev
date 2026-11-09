# Original traffic signal binding — 2026-11-08

Read-only examination of the installed build's resources and x86 code. No original game files were changed or original executable launched. This extends the earlier [upstream audit](traffic-upstream-audit-2026-11-08.md). A traffic-test implementation now combines the binding evidence with the gameplay policy described below.

## Resource evidence

- `objects.rpk:0x1d7`, alias `trafficlamp`, is an ICFG native **`trlight`**, not a generic decorative `object`. The source declaration is in `objects.rdb` and `objects/scripts/trafficlight.cfg`.
- That CFG supplies the housing render `0x1d4`, light `0x00030006` (particles dependency), and four raw state colors: `ffffff00`, `ffd10000`, `ffdca80a`, `ff2dc51d`. Entries 1–3 correspond to red, amber and green. The meaning of entry 0 is not established.
- City RDB contains **460 placements** with gametype `0x000201d7`. Inspected placements supply six pose numbers, with no explicit crossing ID or group ID. The inspected compiled City pack did not contain a plain-text `trlight` declaration: the type lives in the shared objects pack.

## Native binding in the installed executable

These addresses are specific to the locally installed `StreetLegal_Redline.exe`, SHA-256:

`f44fb88a4335c657e20701cdb84afb8d1d85f7c3aceb93d30113e6e6e44fefc2`

They differ from other builds' addresses in upstream documentation. The class-name string/table was traced in this binary rather than blindly using the older factory address.

| Address | Directly observed behavior |
| --- | --- |
| `0x599e40`, registry pair at `0x5da448` | `trlight` string and factory pointer `0x4d5460`. |
| `0x4d5460` | Allocates a `0xc0c`-byte class object, installs vtable `0x5a0204`, initializes four colors and three glow-position triplets. |
| `0x4d4ef0` | Creates an instance, obtains the ground/road owner, scans the first three placement numbers with `%f,%f,%f`, calls `0x4169f0`, stores its result at instance `+0x1a0` and the selected link index at `+0x1a4`. |
| `0x4169f0` | Calls `0x419050` with requested distance zero and height-filter flag zero. Requires the selected record's virtual kind to equal **3**. Iterates its links, ignores zero-flag links, and selects the closest flagged link by squared 3D distance to an anchor in the linked record (`+0x44/+0x48/+0x4c`). Returns that crossing and writes the link index. |
| `0x419050` | Searches both crossing tables, minimizing absolute difference between 3D distance and requested distance. This is the actual nearest-crossing operation when requested distance is zero. |
| `0x4d52a0` | On update, calls `0x415600(crossing, linkIndex)`, adds one to the result, and on a changed state selects the class's corresponding glow position and color. It retains the last displayed state at instance `+0x1a8`. |
| `0x415600` | Reads the link's group from crossing `+0x70` and compares it with active group `+0x68`. A different group returns 0; the active group returns 1 or 2 according to crossing float `+0x64` and a constant threshold. The visual updater maps these to color entries 1, 2 and 3. |

The update path also uses a `glow` render and `bone00` attachment strings. Thus the visible signal **reads a shared crossing/link-group state**. The inspected path does not show a traffic lamp acting as a temporary physical obstacle or broadcasting its color independently to other lamps.

The original itself uses proximity when binding the instance, but only at initialization, with the native record-kind and flagged-link constraints. This is materially different from independently guessing the nearest lamp every frame. It is also important to preserve the actual order: nearest crossing across both pools, then kind check; not “find nearest crossing already known to be signalized.”

## Limits and next work

- The constructor's binding and the visual state consumer are identified. Full phase progression, durations, stop-line rules and traffic-driver response still need to be traced before implementing them as original behavior.
- Follow-up examination identified constructor `0x4154b0`, its kind-3 interface vtable `0x5937f4`, and the second crossing table initialized alongside the first by `0x41a0xx` (`+0x2c` count, versus first `+0x14`). This supports binding `trlight` to parsed pool B. Pool membership alone still does not mean every crossing has visible signals.
- A diagnostic proximity comparison of the 460 lamp placements against our parsed City crossing positions yields 426 nearest to pool B and 34 to pool A, covering 66 distinct crossings. This is **not** a native-parity binding result: it deliberately omits the runtime-kind and flagged-link-anchor checks and does not prove all lamps bind successfully.
- Next native-parity work: verify exact reader/anchor arithmetic and inspect the original producer of `+0x64/+0x68/+0x70` and driver's crossing-state checks. The current lamps and bots share a reconstructed controller using the gameplay timings below, rather than claiming a complete native port.

## Gameplay observation and current traffic-test policy

The user observed **one original-game intersection** and supplied these rules on 2026-11-08. They are implementation inputs, not an executable-parity proof or a claim that every original intersection behaves identically:

- There are no separate turn-arrow sections. A signal controls all incoming lanes of its approach; no right turn is allowed on red.
- Original observed green lasts **20 seconds**, then yellow **5 seconds**. Our current gameplay setting, shortened at the user’s request on 2026-11-09, is **10 seconds green / 3 seconds yellow**. All other approaches remain red. Yellow blocks new entry just like red.
- A vehicle already past the entry line continues independently of later signal changes.
- Initial approach order might be random or clockwise; this was not established. The test rotates through approaches in TRC link order with a random starting approach, then keeps that order fixed. It does not claim confirmed clockwise or original-random behavior.
- An incoming approach with no bound lamp at an otherwise signalized junction uses a five-second STOP fallback, as requested. Unsignalized junctions are not globally converted to STOP.
- STOP/YIELD use a **five-second stationary wait**, then permission to proceed, without checking crossing traffic. Following another vehicle and physical collision handling still apply.
- A signal takes precedence over STOP/YIELD on the same approach, regardless of fixture loading order: green does not require an additional five-second stop, and red/yellow cannot be bypassed by waiting five seconds.

`TrafficControl` is shared by both bots, the signal glow renderer and the crossing debug-line colors. Binding chooses the nearest crossing across both pools, then the nearest flagged incoming road endpoint. A bound incoming branch governs every lane with that owning path reference. Bit-exact x87 and all malformed-data behavior are not claimed.

The runtime no longer rejects pool A when real `trlight` fixtures are present. The user's screenshot at **Cross #24 / A** showed why that early restriction was wrong for our runtime: all heads there stayed dark. A local resource check now binds 10 heads and all 10 incoming lanes at this crossing. Supporting visible fixtures in both pools is a deliberate implementation policy; the originally observed native kind gate remains documented above and needs further interpretation rather than being silently reclassified as proof that pool A lacks signals.

The stopping target is the incoming road's green endpoint, with the vehicle's front overhang and a one-metre margin. An explicit original stop-line field has not been decoded. Only **permitted** passage latches clearance: crossing the line on green (including the preceding physics tick), or completing the STOP wait. Creeping or being pushed across a red line does not grant clearance, and navigation is not allowed to advance into a crossing to bypass the rule. STOP timers begin only near the line at less than 0.2 m/s, not while approaching or waiting farther back in a queue. The release is per visit, so a new circuit requires another stop.

Road-graph crossing curves use green for a signal's permitted incoming branch and red for red/yellow. Ambiguous or per-vehicle STOP/YIELD cases remain neutral grey. Phase transitions update vertex colors only; geometry and spline positions are retained. Driver status includes the controlling Cross and branch IDs to diagnose mismatched lamp/road binding.

Signal glows use one depth-tested Points batch and the original `objects.rpk` → `particles.rpk:6` billboard resource. This is a **type-14 render** (`mesh 5`, `texture 4`), not a type-13 light; texture 4 resolves within `particles.rpk` to `particles/textures/Flare.ptx`. The full PTX color/alpha image is decoded without vehicle-flare atlas cropping. No light source, shadow map, or per-lamp draw is added. Geometry/color buffers update on phase transitions.

The first implementation incorrectly passed this resource to the type-13 light loader. Its asynchronous glow construction failed, while the binding counter and bot controller still worked. The user's dark-lamp screenshot at Cross #158 exposed this mistake. That crossing has six bound heads, including the pictured pair; it was not a simulated failure. The loader is corrected and diagnostics now show glow loading/error state separately from bound-instance count. A resource-resolution regression test covers the dependency-pack/type-14 path.

Visual verification on the actual `trafficlamp_body.SCX` checked red, yellow and green. For this installed model the glow centres use local Y `0.32`, `-0.005`, `-0.335` and Z `0.16` (plus the CFG head offset X `1`), instead of the native default Y triplets that put the glows between the lenses on this mesh. Shared class timing is unchanged.

### STOP/YIELD resource identification is pending

The user confirmed the remembered example is **painted STOP road marking**, with a screenshot, and noted that such markings also occur beside signals. A painted STOP near a signal is not automatically treated as a separate STOP rule; the signal governs the approach. The wait behavior and explicitly named STOP/YIELD resource recognition are implemented, but unnamed stock City markings are deliberately not guessed. The inspected `tabla_*` resources include advertising, directional and speed signs; the inspected `Trafficsigns.dds` atlas contains other signs and does not establish STOP/YIELD identities. Do not report automatic recognition of all City STOP/YIELD markings as complete.

Validation covers exclusive signal phases and boundary timing, all-lane branch control, missing-lamp fallback, nearest-crossing/type gating, physical braking on red/yellow, clearing after passing the line, and five-second stationary STOP/YIELD release.

## Traffic-car flare change

Pickup's original lamp resources are type 13 renders in CFG with `lod 1 2`. Ordinary inventory secondary-render selection excludes those LOD entries, which explains why the previous traffic template had no lamps. The traffic-specific loader now resolves these lamp resources explicitly without changing body LOD selection.

The test Pickup resolves 12 lamp sprites: two headlights, two rear running lamps, two brake lamps, two reverse lamps, and four roof lamps. Running lamps follow night time; braking/reversing use the bot controls. No SpotLight, gobo, projector, or extra shadow pass is created. Per-instance sprite callbacks/materials are not cloned from a shared template; immutable lamp definitions and decoded source images are cached.

Gameplay update (2026-11-09): yellow is now a per-driver decision: approaching moving cars sample once per phase, 50% braking / 50% modest acceleration, while queues and unentered red signals still block. Debug graph colors remain global entry permissions (yellow red), so individual yellow decisions appear in bot status instead of changing the shared graph.
