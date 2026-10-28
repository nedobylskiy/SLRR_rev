# Temporary Java native mocks

Native methods marked `MOCK:` in the runtime let original Java scripts continue while a host feature is still missing. These implementations are intentionally incomplete; do not treat a successful script call as proof that the feature is rendered or simulated.

| Method | Current behavior | Missing behavior |
| --- | --- | --- |
| `RenderRef.lineCreate(ResourceRef, ResourceRef)` | Keeps the `SkidMark` resource under its parent and returns success. | Create dynamic line geometry and attach its material. |
| `RenderRef.lineAdd(Vector3, Vector3, int, float)` | Accepts a point without drawing it. | Append visible line segments with the supplied normal, color, and width. |

These two mocks currently allow `Navigator.regenerateRoute()` to proceed. The route line will remain invisible until dynamic line rendering is implemented.
