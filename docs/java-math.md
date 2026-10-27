# Java Math bridge

`npm run audit:java-math` parses the installed `sl/Scripts/**/*.java` sources and lists calls to `Math`, excluding comments. The tested Build 940 installation uses 16 methods and two static fields:

| Method | Call sites |
| --- | ---: |
| `random()` | 176 |
| `sqrt(float)` | 13 |
| `abs(int/float)` | 10 |
| `siRandom()` | 8 |
| `chaos()` | 6 |
| `section(float, float, float)` | 5 |
| `avg(float[])`, `deg2rad(int)`, `rad2deg(float)` | 4 each |
| `pow(float, float)`, `round(float)` | 3 each |
| `sin(int/float)`, `sqr(int/float)` | 2 each |
| `cos(int/float)`, `randomize()`, `remDiv(int, int)` | 1 each |

`Math.PI` appears twice and `Math.TAU` once. The host bridge registers these under `java.lang.Math`; no `.class` bytecode is executed. It also accepts `int` arguments at numeric call sites where the source runtime does not yet insert Java's implicit `int` to `float` conversion.

The installed `Math.class` defines some of these as native functions and others as Java methods. The bridge follows its observed signatures and behavior, including degrees for integer `sin`/`cos`, radians for float `sin`/`cos`, the class's unusual `round` threshold, inclusive `section`, and a session-local MSVC-style random sequence. `chaos` reproduces the observed random-sample-and-shuffle shape; its exact `Vector.shuffle` ordering is not yet verified against the original engine.
