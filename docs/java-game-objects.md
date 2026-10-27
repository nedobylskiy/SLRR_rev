# Java game objects and resource handles

The original script hierarchy is `Native → ResourceRef → GameRef → GameType`. The host runtime follows the same division:

| Java layer | Host counterpart | Responsibility |
| --- | --- | --- |
| `ResourceRef` | `ResourceObject` | Resource binding, parent and child links, resource-tree traversal. |
| `GameRef` | `GameObject` | Flags, transform, linear and angular velocity, queued events, and collision activation request. |
| `GameType` | `GameTypeNative` binding | Connects an interpreted Java instance to its host object. |

`ResourceRef.id()` returns the bound resource ID; an unbound handle returns zero. The host also assigns each object a separate internal ID to track its identity. `set(int)` and `set(ResourceRef)` change the resource binding without changing that identity. This distinction follows the original `ResourceRef` native implementation, where `id()` reads the handle's resource ID field and `set()` rebinds the handle.

The final string argument of `GameRef.create(...)` or `GameType.createNativeInstance(...)` is stored as the object's alias in the tree. A new game object retains the native handle created by `ResourceRef.newNative()`. `GameRef.setFlags()` and `clearFlags()` update bits; `setActiveCollision()` queues activation for a later physics step. Transform and velocity methods update the same host object, and `queueEvent()` retains events in order.

This is the script-facing state layer. Rendering, physics integration, queued event dispatch, and resource-pack tree population still need host systems. Tree calls currently traverse objects created by the Java runtime; they do not yet read parent and child links from RPK resources. The implementation deliberately stops at the next missing native during `Init.java` startup so the console reports the exact method required next.
