import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { ThreadNative } from '../src/runtime/thread-native';

test('a Java thread yields at wait while the caller continues, then notify resumes it', async () => {
  const source = `package demo;
    interface Runnable { void run(); }
    class Worker implements Runnable {
      Thread thread; int count;
      void run() { thread.wait(); count++; }
    }
    class Thread {
      Runnable target;
      Thread(Runnable value) { target = value; init("worker"); }
      native void init(String name);
      native void start(); native void stop(); native void wait(); native void notify(); native int isAlive();
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'demo/Thread.java', source } : null });
  const errors: string[] = [];
  new ThreadNative(jvm, message => errors.push(message), 'demo.Thread');
  await jvm.loadClass('demo.Worker');
  await jvm.loadClass('demo.Thread');
  const worker = await jvm.constructAsync('demo.Worker', []);
  const thread = await jvm.constructAsync('demo.Thread', [worker]);
  jvm.set(worker, 'thread', thread);
  await jvm.invokeAsync(thread, 'start');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(jvm.get(worker, 'count').value, 0);
  assert.equal((await jvm.invokeAsync(thread, 'isAlive')).value, 1);
  await jvm.invokeAsync(thread, 'notify');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(jvm.get(worker, 'count').value, 1);
  assert.equal((await jvm.invokeAsync(thread, 'isAlive')).value, 0);
  assert.deepEqual(errors, []);
});

test('Object.notifyAll resumes every Java monitor waiter and disposal cancels sleeps', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const bridge = new ThreadNative(jvm, () => {});
  const monitor = jv('Object', { className: 'java.lang.Object', fields: new Map() });
  const first = jvm.invokeAsync(monitor, 'wait');
  const second = jvm.invokeAsync(monitor, 'wait');
  await Promise.resolve();
  await jvm.invokeAsync(monitor, 'notifyAll');
  await Promise.all([first, second]);
  const sleeper = jvm.natives.invokeAsync('java.lang.Thread', 'sleep', jv('class', 'java.lang.Thread'),
    [jv('float', 10_000)]);
  bridge.dispose();
  await assert.rejects(sleeper, /disposed/);
});
