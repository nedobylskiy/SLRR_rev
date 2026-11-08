# Original traffic signal binding — 2026-11-08

Read-only examination of the installed build's resources and x86 code. No original game files were changed or original executable launched. This extends the earlier [upstream audit](traffic-upstream-audit-2026-11-08.md); it does not implement signal obedience yet.

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
- Do not equate all pink/B or gold/A nodes with signal control solely from color or gameplay speed observations. The relationship of runtime kind 3 to parsed pool identity should be checked against the actual reader/constructors.
- A diagnostic proximity comparison of the 460 lamp placements against our parsed City crossing positions yields 426 nearest to pool B and 34 to pool A, covering 66 distinct crossings. This is **not** a native-parity binding result: it deliberately omits the runtime-kind and flagged-link-anchor checks and does not prove all lamps bind successfully.
- Next: map runtime kind 3 and the linked-record anchor to parsed TRC fields; reproduce `0x4169f0` as a diagnostic; inspect the producer of `+0x64/+0x68/+0x70` and the driver's crossing-state checks. Then connect both visual lamps and bots to the same crossing state.

## Traffic-car flare change

Pickup's original lamp resources are type 13 renders in CFG with `lod 1 2`. Ordinary inventory secondary-render selection excludes those LOD entries, which explains why the previous traffic template had no lamps. The traffic-specific loader now resolves these lamp resources explicitly without changing body LOD selection.

The test Pickup resolves 12 lamp sprites: two headlights, two rear running lamps, two brake lamps, two reverse lamps, and four roof lamps. Running lamps follow night time; braking/reversing use the bot controls. No SpotLight, gobo, projector, or extra shadow pass is created. Per-instance sprite callbacks/materials are not cloned from a shared template; immutable lamp definitions and decoded source images are cached.
