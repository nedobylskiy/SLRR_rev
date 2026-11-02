# Java game objects and resource handles

The original script hierarchy is `Native → ResourceRef → GameRef → GameType`. The host runtime follows the same division:

| Java layer | Host counterpart | Responsibility |
| --- | --- | --- |
| `ResourceRef` | `ResourceObject` | Resource binding, parent and child links, resource-tree traversal. |
| `GameRef` | `GameObject` | Flags, transform, linear and angular velocity, queued events, and collision activation request. |
| `GameType` | `GameTypeNative` binding | Connects an interpreted Java instance to its host object. |

`ResourceRef.id()` returns the bound resource ID; an unbound handle returns zero. The host also assigns each object a separate internal ID to track its identity. `set(int)` and `set(ResourceRef)` change the resource binding without changing that identity. This distinction follows the original `ResourceRef` native implementation, where `id()` reads the handle's resource ID field and `set()` rebinds the handle.

The final string argument of `GameRef.create(...)` or `GameType.createNativeInstance(...)` is stored as the object's alias in the tree. A new game object retains the native handle created by `ResourceRef.newNative()`. `GameRef.setFlags()` and `clearFlags()` update bits; `setActiveCollision()` queues activation for a later physics step. Transform and velocity methods update the same host object, and `queueEvent()` retains events in order.

This is the script-facing state layer. Rendering, physics integration, and resource-pack tree population still need host systems. Tree calls currently traverse objects created by the Java runtime; they do not yet read parent and child links from RPK resources. The implementation deliberately stops at the next missing native during `Init.java` startup so the console reports the exact method required next.

`Viewport` now references the existing WebGL canvas. Its Java width, height, left, and top remain normalized fractions, as the original OSD code expects; `getAspect()` derives the ratio from the canvas's current pixel dimensions and the viewport region. `Camera.create()` records the Java camera resource and its link to that viewport. The renderer does not yet consume the Java camera state.

`GameType.setEventMask()` and `clearEventMask()` maintain a separate event subscription bitmask. A host FIFO now dispatches subscribed events to the interpreted Java overloads `handleEvent(GameRef, int, String)`, `handleEvent(GameRef, int, int)`, and `handleEvent(Hotkey)`. A handler may enqueue more events while the queue is draining. The Java `Input.createHotkey`, `deleteHotkey`, `flushHotkeys`, and `checkHotkeys` natives register physical or virtual axes and queue `EVENT_HOTKEY` on eligible press/release edges. Global keys target `GameLogic`; OSD keys target the focused `Osd`, whose Java handler forwards commands to its configured recipient. The active menu's Java `Frontend.inputQueue` selects focus. Until Java `Thread` and `HotkeyWatcher` run, the browser host polls input every 50 ms. Other engine event producers, timers, and native handling of command strings still need integration.

`ResourceRef.duplicate()` now creates a separate host resource binding with a link to its source. The reverse engineered native clones mesh, texture, light, and render object resources, while other known types share their binding. Resource types not yet resolved from RPK are treated as copies so subsequent `scaleMesh()` and `RenderRef.changeResource()` changes stay local to the duplicate. These operations currently record a resource recipe; applying them to render geometry is pending.

`RenderRef.create(parent, type, alias)` now makes a `RenderObject` under a game or render parent. It keeps the type resource distinct from the visual instance and stores the `setMatrix` transform. Cameras use the same render-instance state. The viewer creates a Three.js group for each live Java render instance and updates its transform. Resolving the type to actual mesh/light geometry, drawing OSD objects, and bone attachment are separate renderer integrations still pending.
