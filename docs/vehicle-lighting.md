# Vehicle lighting

Driving activates CFG channel 4 between 18:00 and 06:00 while the engine is running.
The Java scene supplies GameLogic.time in seconds; brake (1) and reverse (2) remain independent.
Leaving driving clears these channels. Existing channel-4 lens meshes and lamp sprites are reused.

Headlights are plain Three.js SpotLight instances: intensity 80, distance 60m,
30-degree half-angle, penumbra 0.2 and standard inverse-square decay (2).
They have no map, custom beam shader, gobo render target or attenuation texture loads.
Lamp CFG poses cancel SCX centimetre scaling; the spot and target follow the part.
The baseline slightly downward aim is retained. Projectors do not cast shadows.

Activated CFG lens overlays use their color texture as emissiveMap, with white
emissive color and intensity 1.4. Unswitched base lens materials remain unchanged.
The existing additive, depth-tested lamp sprite provides the local halo; a second sprite (up to 90px main glow, capped at 0.9m physical diameter) adds the camera optical flare with
ordinary depth testing and forward-facing fade. Headlights do not use Lensflare's
framebuffer-copy occlusion; these effects are a suspected source of GPU synchronization pressure
alongside the measured Hi-Z readback stalls. A repeat recording must confirm the impact. The independent sun Lensflare is unchanged.
The flare atlas quadrant is baked into a standalone texture for both SpriteMaterial
and Lensflare, whose shader does not apply texture repeat/offset.
Headlight optical sprites use an 8× glow-color gain: the stock CITY glow color is
only 0.2, which made the sRGB texture halo almost disappear in linear rendering.
Beam/lens emission is independent of this optical gain.
Part disposal releases the gobo, optical effects and temporary input textures.

Automated checks cover channel transitions, original resource resolution, projector transforms
road-plane gobo projection, switched lens emission and resource disposal. Brightness, beam alignment and flare appearance still need in-game visual
verification; desktop automation could not establish Chrome's current URL during implementation.


## Readback scheduling

The follow-up recording still showed Hi-Z getBufferSubData stalls (p95 14.1ms,
max 32.4ms), so replacing the headlight Lensflare did not resolve the main stall.
Visibility readback now runs at the beginning of RAF, before new rendering and
buffer uploads. An additional fence after the submission frame main/debug rendering must also
be signaled; the older visibility-pass fence alone is insufficient for this gate.
When the GPU is busy, readback is deferred and the last completed visibility mask
remains authoritative. The frame fence is retained while waiting and released on completion/cancellation.
Replacing it every rendered frame caused readback starvation under sustained GPU load. This is a scheduling experiment, not a
confirmed driver-stall fix; compare another in-game capture before drawing conclusions.


## Night shadow quality

Driving switches shadow quality at 18:00/06:00 using the same game clock as the lamps.
Night uses BasicShadowMap (hard, one comparison) at 3072² over 80×80m centred on the
vehicle focus, with depth clipped to ±40m along the sun direction (near/far 210/290
for the light offset of 250m). Day retains PCFSoftShadowMap at 2048² over 200×200m.
The directional source stays on the sun/moon side and targets the vehicle focus;
its offset from the car is intentional and does not make it point away from the car.
Headlight projectors remain non-shadow-casting.
Cached static environment shadows use one tap at night, with 3072² over 160×160m,
versus daytime 2048² over 320×320m: three times the linear detail per metre.
No shadow-map allocations occur until a quality transition or first use.
The standard-lighting shader also skips the redundant debug getShadowMask evaluation.
Performance remains to be measured in-game after these changes.


An empty candidate list is a separate idle state (`pipeline_stage: empty`).
It cancels superseded depth/readback/fence work, clears stale work counters and
performs no GPU passes or readback. CPU scene audits retain the normal interval.
Dormant placement verdicts remain cached so a temporary streamer gap does not
reveal previously hidden objects on re-entry. This does not bypass testing when
candidates exist but the hidden-result list happens to be empty.


The optical billboard uses perspective attenuation and compensates parent scale.
It cannot retain a constant screen footprint at arbitrarily large inspection-camera
distances: doing so inflated its world-space footprint. At a distance it shrinks.
