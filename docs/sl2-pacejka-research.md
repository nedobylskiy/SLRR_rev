# SL2 Pacejka research

This note records a candidate native tyre-force formula for later comparison with
our build 940 installation. It does **not** change the active driving model.

## Provenance and scope

The `street-legal` project recovered `FUN_0043bb30` and its non-negative variant
`FUN_0043ba80` from the SL2 **build 606** executable. Its [physics analysis](https://github.com/nicolas-found42/street-legal/blob/33eca3c/docs/physics.md#9-tyre-model-oracle-pacejka-static)
includes a 40-vector single-function comparison against the original executable.
Its [Rust implementation](https://github.com/nicolas-found42/street-legal/blob/33eca3c/crates/slr-physics/src/tyre.rs#L112)
also models x87 operations. Our readable reference is
[`sl2PacejkaForce`](../src/engine/sl2-pacejka.ts); it uses JavaScript numbers and
is not bit-exact.

The native formula reads **indices 0–10** of a 17-value WheelRef coefficient
array. With `p[i]` as the input array, `Fz` as normal load and `s` as the slip
value supplied by the native caller:

```text
D = Fz*p[1] + p[2]
B = (Fz*p[3] + p[4]) * exp(-Fz*p[5]) / (D*p[0])
x = (Fz*p[9] + p[10] + s) * B
E = Fz*Fz*p[6] + Fz*p[7] + p[8]
F = D*Fz * sin(p[0] * atan(E*(atan(x)-x) + x))
```

The function returns zero when `D*p[0]` is zero. The `FUN_0043ba80` variant
clamps a negative result to zero. These are **force-leaf functions**, not a
complete wheel model: the caller computes and relaxes slip, handles direction,
braking, suspension, load, combined forces and the remaining WheelRef fields.

## Evidence from our build 940 Java sources

The installed `parts/scripts/rgearpart/reciprocatingrgearpart/SRC/Tyre.java`
sets these coefficients through WheelRef in `updatevariables()`:

| Index | Build 940 input |
| --- | --- |
| 0 | `sliction` through `setSliction` |
| 1 | `0.0` |
| 2 | `insider_friction` through `setFriction` |
| 3 | `0.0` |
| 4 | `stiffness` through `setStiffness` |
| 5–7 | `0.0` |
| 8 | `-1.0` |
| 9–10 | `0.0` |

The same Java method sets index 11 from `loadcap`, index 12 to `1.0`, then
calls `setFrictn_x(1.0)` and `setLoadSmooth(0.4)`. Those values are outside
the recovered leaf function but may matter elsewhere in the native wheel code.
Our [`WheelRefState`](../src/runtime/wheel-ref-native.ts) already captures the
17 values. Each tyre's actual index 0, 2 and 4 values depend on its script
and tuning, so the table is a write pattern, not a universal stock preset.

## Before using this for driving

1. Check that build 940 has the same native formula and coefficient mapping.
2. Recover the build 940 caller's slip convention, relaxation, load units and
   the uses of indices 11–16.
3. Compare force curves and vehicle telemetry with the current four-parameter
   tuning model before switching the driving prototype.
