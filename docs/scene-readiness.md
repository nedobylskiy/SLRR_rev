# Java scene readiness

Java section entry and host scene construction are separate asynchronous operations.
Changing `GameLogic.actualState` does not mean map geometry, collision or cars are ready.

The host holds gameplay while the current map/state/vehicle selection differs from
the completed scene, including the period before the scene poll starts construction.
Java timers retain their remaining delay during this hold; animation callbacks and
simulation time pause as well. Section entry, resource I/O and loading-screen threads
continue so they can complete the transition. Browser keyboard input is blocked and
old physical input is cleared. The existing Java LoadingScreen remains visible:
`System.isLoading()` includes pending host assets even after Java calls
`isLoadingReset()`. No separate browser loading overlay is created. Gameplay stays
paused until Java closes its loading dialog (including any requested user wait).
The asset readiness signal is independent of dialog visibility, so the loader can
observe completion and close without waiting on itself.

Readiness requires the player assembly, map and collision, drive binding, nearby
streamed model geometry/placements and initial traffic preparation. The scene is
published for a render frame before gameplay resumes. Further travel uses normal
incremental streaming. A failed player/map load keeps the hold and displays an error
in the console instead of starting the race in an incomplete world. Switching sections invalidates
the old scene immediately; cancelled builds cannot mark the new section ready.

Regression coverage includes paused and cancelled timers, zero-delay callbacks,
simulation clocks, and initial nearby streaming with deferred model loads. These
tests do not replace checking the complete career race transition in the browser.
