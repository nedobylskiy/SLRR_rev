import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';

interface ThreadState {
  alive: boolean;
  stopped: boolean;
  priority: number;
  daemon: boolean;
  startTimer?: ReturnType<typeof setTimeout>;
  pending?: { resolve: (value: JavaValue) => void; reject: (error: Error) => void };
}

/** Cooperative Java threads share one JVM heap and yield at wait/sleep native calls. */
export class ThreadNative {
  private readonly states = new WeakMap<object, ThreadState>();
  private readonly live = new Set<ThreadState>();
  private readonly objectWaiters = new Map<object, Set<{ resolve: (value: JavaValue) => void; reject: (error: Error) => void }>>();
  private readonly sleeps = new Set<{ timer: ReturnType<typeof setTimeout>; reject: (error: Error) => void }>();

  constructor(private readonly jvm: SlrrJvm, private readonly report: (message: string) => void,
    owner = 'java.lang.Thread') {
    const nil = () => jv('void', undefined);
    jvm.natives.register(owner, 'init', ['String'], ({ receiver }) => { this.state(receiver); return nil(); });
    jvm.natives.register(owner, 'start', [], ({ receiver }) => {
      const state = this.state(receiver);
      if (state.alive || state.stopped) return nil();
      state.alive = true;
      // Let the Java caller finish configuring the thread before its first run.
      state.startTimer = setTimeout(() => {
        state.startTimer = undefined;
        if (state.stopped) { state.alive = false; return; }
        const target = this.jvm.get(receiver, 'target');
        void this.jvm.invokeAsync(target, 'run').catch(error => {
          if (!state.stopped) this.report(`Thread.run: ${error instanceof Error ? error.message : String(error)}`);
        }).finally(() => { state.alive = false; state.pending = undefined; this.live.delete(state); });
      // A zero-delay timer can run as soon as an async Java/native call yields,
      // before the Java caller has finished constructing fields consumed by
      // run(). Give that caller one short scheduling window to finish setup.
      }, 10);
      return nil();
    });
    jvm.natives.register(owner, 'stop', [], ({ receiver }) => {
      const state = this.state(receiver);
      state.stopped = true;
      if (state.startTimer) clearTimeout(state.startTimer);
      state.startTimer = undefined;
      state.pending?.reject(new Error('Java thread stopped'));
      state.pending = undefined;
      this.live.delete(state);
      return nil();
    });
    jvm.natives.register(owner, 'isAlive', [], ({ receiver }) => jv('int', Number(this.state(receiver).alive)));
    jvm.natives.register(owner, 'getPriority', [], ({ receiver }) => jv('int', this.state(receiver).priority));
    jvm.natives.register(owner, 'setPriority', ['int'], ({ receiver, args }) => {
      this.state(receiver).priority = Number(args[0].value);
      return nil();
    });
    jvm.natives.register(owner, 'setDaemon', ['int'], ({ receiver, args }) => {
      this.state(receiver).daemon = Boolean(args[0].value);
      return nil();
    });
    jvm.natives.registerAsync(owner, 'wait', [], ({ receiver }) => new Promise<JavaValue>((resolve, reject) => {
      const state = this.state(receiver);
      if (state.stopped) { reject(new Error('Java thread stopped')); return; }
      state.pending = { resolve, reject };
    }));
    jvm.natives.register(owner, 'notify', [], ({ receiver }) => {
      const state = this.state(receiver);
      state.pending?.resolve(nil());
      state.pending = undefined;
      return nil();
    });
    jvm.natives.registerAsync(owner, 'sleep', ['float'], ({ args }) => new Promise<JavaValue>((resolve, reject) => {
      const pending = { timer: setTimeout(() => { this.sleeps.delete(pending); resolve(nil()); },
        Math.max(0, Number(args[0].value))), reject };
      this.sleeps.add(pending);
    }));
    const objectOwner = 'java.lang.Object';
    jvm.natives.registerAsync(objectOwner, 'wait', [], ({ receiver }) => new Promise<JavaValue>((resolve, reject) => {
      const key = this.monitor(receiver);
      const waiters = this.objectWaiters.get(key) ?? new Set();
      waiters.add({ resolve, reject }); this.objectWaiters.set(key, waiters);
    }));
    for (const [name, all] of [['notify', false], ['notifyAll', true]] as const)
      jvm.natives.register(objectOwner, name, [], ({ receiver }) => {
        const key = this.monitor(receiver), waiters = this.objectWaiters.get(key);
        if (!waiters) return nil();
        for (const waiter of [...waiters]) {
          waiters.delete(waiter); waiter.resolve(nil());
          if (!all) break;
        }
        if (!waiters.size) this.objectWaiters.delete(key);
        return nil();
      });
  }

  dispose(): void {
    for (const state of this.live) {
      state.stopped = true;
      if (state.startTimer) clearTimeout(state.startTimer);
      state.startTimer = undefined;
      state.pending?.reject(new Error('Java thread stopped'));
      state.pending = undefined;
    }
    this.live.clear();
    for (const waiters of this.objectWaiters.values())
      for (const waiter of waiters) waiter.reject(new Error('Java monitor disposed'));
    this.objectWaiters.clear();
    for (const pending of this.sleeps) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Java thread sleep disposed'));
    }
    this.sleeps.clear();
  }

  private monitor(receiver: JavaValue): object {
    const object = receiver.value;
    if (!object || typeof object !== 'object') throw new Error('Java Object monitor unavailable');
    return object;
  }

  private state(receiver: JavaValue): ThreadState {
    const object = receiver.value;
    if (!object || typeof object !== 'object') throw new Error('Java Thread receiver unavailable');
    let state = this.states.get(object);
    if (!state) {
      state = { alive: false, stopped: false, priority: 0, daemon: false };
      this.states.set(object, state);
      this.live.add(state);
    }
    return state;
  }
}
