# Map ambience and pedestrian areas

Implemented from the findings in [the November 13 upstream audit](upstream-audit-2026-11-13.md).
References: OpenSLRR [ambience](https://github.com/EliasFD3S/openslrr/commit/a5dfc46490e6fa07ced3ec937798f7b2dc4eab9c)
and [original-style walkers](https://github.com/EliasFD3S/openslrr/commit/60b143ef4fe95bdc0b9b61aee9ef93a03f06047b).
The TypeScript/Web Audio integration is local; this is not a claim of complete
executable parity. Upstream attributes the relevant behavior to MWM 2.2.1;
structural checks here use the installed build 940 corpus.

## Ambient audio

`parseMapAmbience` reads the retained CFG `sfx_loop` and `sfx_random` commands.
Later loop lines replace earlier lines. Random entries share a timer per object,
retain their individual delay ranges/hour windows, and support midnight wrapping.
The sound RID resolves through the owning resource pack's dependency table.

`MapAmbience` indexes emitters in 64 m cells and schedules nearby sources at
4 Hz. The original start-distance rule is `distance² - radius² <= 250²`.
There are at most 32 active/pending voices and four concurrent start requests.
Repeated random cues are coalesced for 35 ms and limited to two playing copies.
Far emitters do not receive per-frame timer updates; an overdue timer is serviced
when its emitter becomes nearby again. This is a deliberate bounded-work policy.

`AmbientAudio` uses one context per map and lazily caches sound metadata and
decoded samples. Sound-resource volume/mindist/maxdist feed inverse-distance
Web Audio panners. The active render camera is the listener. Game effects volume,
the host game-volume slider, Java timeWarp(0), and map disposal are respected.
Map changes stop existing voices and invalidate pending loop requests. Browser
audio activation is retried on pointer/keyboard input; no audio files are exported.

Installed City + City2 verification: 13,753 emitters, two loop emitters,
15,719 random command instances, eight unique sound resources. All eight resolve
to installed source files. Browser listening remains a separate visual/audio check.

Follow-up audio-content check: the installed `sound/wav/ambient/Madarak.wav`
(the trees' bird cue, RID `objects.rpk:0x055e`) is one second of mono 11,025 Hz
32-bit integer PCM containing only zero samples. Resource existence therefore
does not establish audible content. The ambient backend now detects silent decoded
buffers, skips further requests for those resources, and reports silent filenames,
actual playing samples, mix level, context state and decode errors. No installed
game sound files were modified or replaced. Other stock cues keep their original
levels and hour windows; an audible bird recording requires a non-silent asset.

## Pedestrian zones

The `.walk` reader now consumes the row's sequential edge records and signed
gate IDs. Header fields are origin X/Z, floor slopes X/Z and height, followed by
the record count. It no longer splits on every -1 word or invents nested records.
Legacy optional fields remain solely for existing synthetic route fixtures.

Run boundaries are sampled from Hermite curves using tangent directions with
rescaled lengths, matching the upstream reconstruction. The debug graph displays
these curves and applies the authored junction floor plane.

Production crowds use `PedestrianAreas` / `AreaWalker`: persistent heading,
up to four strongest local steering influences, boundary/neighbor avoidance,
and car-path avoidance looking up to five seconds ahead. Ownership changes only
through an explicit gate. Row containment rejects exits around wall end caps.
Corridor height is interpolated from run samples; junction height uses its plane.
Animation rate includes travel and bounded turning. The existing streaming pool,
model selection, vehicle contact and ragdoll remain in use.

Local policy retained: the user's 30 cm hard boundary clearance, count/radius
controls and off-screen spawning. This is not the upstream fixed 1 m hard radius
or area-density population policy. Neighbor/car steering is a simplified host
adaptation rather than a bit-identical port of the EXE's influence solver.
`city.rest` remains diagnostic data and is not used to invent walking routes.

Corpus validation: all 1,799 rows decode with no unexplained bytes. A seeded
eight-agent, 60-second City run completed four row transitions with zero exits
outside its current authored area and a maximum per-tick displacement of 3.32 cm.

Tests: `tests/map-ambience.test.ts`, `tests/pedestrian-areas.test.ts`, and the
existing pedestrian parser, transition, streaming and contact suites.
