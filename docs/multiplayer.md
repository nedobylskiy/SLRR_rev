# Multiplayer and machine status

This is a network architecture design; working network transport and server race have not yet been implemented. The priority is to fully capture and restore the machine in memory, since the old save-to-disk path led to a leak, according to the owner’s observation.

## Data streams

1. Handshake: protocol version, manifest resources/scripts, VM capabilities, snapshot scheme version.
2. Baseline: complete assembly of parts, ID, slots, tuning, damage, painting, mod states. Uses SRVS or its subsequent version.
3. Inputs: sequence number, simulation tick, steering/throttle/brake/clutch/gear. The client does not send “my position is correct” as a final decision.
4. Dynamics: server tick, baseline revision, position/rotation, linear/angular velocity, rpm/gear, coordinated set of wheel and motor parameters.
5. Events: install/remove, collision damage, paint update, disconnect. Change the revision baseline.

The complete car doesn't need to be serialized 60 times per second if only the position has changed. But before optimizing delta, lossless baseline and resync must work. Old garage saves do not automatically contain all the dynamic values needed for movement.

## Authority and time

The server owns the installation of parts and simulation. The client can predict its own movement, the rest of the machines are interpolated between the server states. Floating point equality between browsers is not assumed; therefore lockstep without correction is not selected by default.

`FixedClock` already gives integer ticks and constant dt, regardless of the rendering frequency. When overloaded, retains and communicates duty, does not stretch dt and does not silently skip physical steps. The server catch-up/pause/resync policy remains an integration task.

Native runMethod should not become an arbitrary remote command. The network receives typed actions and entity identifiers. Host DLL invocation is not a network RPC at all.

## Memory and recovery

One baseline owns its byte buffers. Passing an ArrayBuffer to a Worker can transfer ownership; after transfer the sender does not use detached buffer. Transient textures are stored by content hash, have dimensions and their own life cycle. Reconnect, car replacement and rollback should free up old render/physics/VM instances.

CRC32 inside SRVS - damage check only. The network protocol is required to check the sender, quotas, message size/frequency, tick/revision relevance and allowed resources. Successful JSON decoding does not allow any machine to be created on the server.

## Acceptance scripts

The same baseline restores the same parts tree and parameters on two clients with different RPK load orders. The missing mod bug leaves the original car unchanged. 1000 cycles of spawn→baseline→restore→despawn do not increase the counts of active bodies/textures/VM roots. Losing baseline triggers resync. Late/duplicate message does not return old configuration. Disabling a client destroys the temporary objects it owns.

These criteria for the game world have not yet been met. Current unit tests only check codecs, graph structure and clock.
