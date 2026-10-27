# Java script threads

The installed game's `java.lang.Thread` source runs in SLRR-JVM. Its native `start()` schedules the target's Java `run()` method against the same JVM heap. A call to `wait()` suspends that execution until `notify()`; `sleep()` resumes it after the requested delay. The caller continues while the thread is suspended. `stop()` interrupts a pending `wait()`.

This is cooperative concurrency in the browser, not CPU parallelism. Java code that runs continuously without yielding can still block the browser. Native `suspend()` and `resume()` are intentionally left unimplemented until their behavior can be reproduced. Running script code on separate workers would require a shared JVM heap or message-based access to every game object.

The boot verification checks that `GameLogic` starts its time-refresher thread. A separate test checks that a Java caller proceeds while another Java execution waits, and that `notify()` resumes it.
