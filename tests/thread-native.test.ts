import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { ThreadNative } from '../src/runtime/thread-native';

test('a started Java thread waits until its caller configures THOR methods', async () => {
  const source = `package demo;
    interface Runnable { void run(); }
    class Integer { int number; Integer(int value) { number = value; } int intValue() { return number; } }
    class Thread {
      Runnable target; Object[] executed = new Object[1];
      Thread(Runnable value) { target = value; init("worker"); }
      native void init(String name); native void start();
      void addMethod(int index) { executed[index] = new Integer(7); }
      int methodStatus(int index) { return executed[index].intValue(); }
    }
    class Worker implements Runnable {
      Thread thread; int status;
      void run() { status = thread.methodStatus(0); }
      void launch() { thread = new Thread(this); thread.start(); thread.addMethod(0); }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'demo/Thread.java', source } : null });
  const errors: string[] = [];
  const bridge = new ThreadNative(jvm, message => errors.push(message), 'demo.Thread');
  await jvm.loadClass('demo.Worker');
  const worker = await jvm.constructAsync('demo.Worker', []);
  await jvm.invokeAsync(worker, 'launch');
  for (let attempt = 0; attempt < 20 && jvm.get(worker, 'status').value !== 7; attempt++)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(jvm.get(worker, 'status').value, 7);
  assert.deepEqual(errors, []);
  bridge.dispose();
});

test('RaceSetup-style edge scroller stays stopped after exit resets the minimap offsets',async()=>{
  const source=`package demo;
    interface Runnable { void run(); }
    class Thread {
      Runnable target; Thread(Runnable value) { target=value; init("map scroller"); }
      native void init(String name); native void start(); native void stop(); native int isAlive();
      static native void sleep(float duration);
    }
    class Map { float offsetX; }
    class RaceSetup implements Runnable {
      Thread scrollerThread; Map map=new Map(); int updates;
      void run() { while(true) { map.offsetX+=10; updates++; scrollerThread.sleep(20); } }
      void enter() { scrollerThread=new Thread(this); scrollerThread.start(); }
      void exit() { scrollerThread.stop(); map.offsetX=0; }
    }`;
  const jvm=new SlrrJvm({resolveImport:()=>({path:'RaceSetup.java',source})}),errors:string[]=[];
  const bridge=new ThreadNative(jvm,message=>errors.push(message),'demo.Thread');
  try{
    await jvm.loadClass('demo.RaceSetup');const setup=await jvm.constructAsync('demo.RaceSetup',[]);
    await jvm.invokeAsync(setup,'enter');
    const deadline=Date.now()+1000;
    while(Number(jvm.get(setup,'updates').value)===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
    assert.ok(Number(jvm.get(setup,'updates').value)>0,'selection mode scrolls while active');
    await jvm.invokeAsync(setup,'exit');const updates=jvm.get(setup,'updates').value;
    assert.equal((await jvm.invokeAsync(jvm.get(setup,'scrollerThread'),'isAlive')).value,0);
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(jvm.get(setup,'updates').value,updates,'sleep must not resume the exited scroller');
    assert.equal(jvm.get(jvm.get(setup,'map'),'offsetX').value,0,'driving minimap retains the reset offset');
    assert.deepEqual(errors,[],'intentional thread stop is not reported as a script error');
  }finally{bridge.dispose();}
});

test('a Java thread yields at wait while the caller continues, then notify resumes it', async () => {
  const source = `package demo;
    interface Runnable { void run(); }
    class Worker implements Runnable {
      Thread thread; int count; int entered;
      void run() { entered = 1; thread.wait(); count++; }
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
  const deadline = Date.now() + 1000;
  while (jvm.get(worker, 'entered').value !== 1 && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(jvm.get(worker, 'entered').value, 1);
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


test('thread launch waits for async initialization but starts when its caller explicitly sleeps', async () => {
  const source = `package demo;
    interface Runnable { void run(); }
    class Thread {
      Runnable target;
      Thread(Runnable value) { target = value; init("worker"); }
      native void init(String name); native void start(); native void stop();
      static native void sleep(float duration);
    }
    class Timer { int stopped = 7; }
    class Worker implements Runnable {
      Thread thread; Timer timer; int status; int observed;
      native void loadAsset();
      void run() { status = timer.stopped; }
      void launch() { thread = new Thread(this); thread.start(); loadAsset(); timer = new Timer(); }
      void yieldToThread() { Thread.sleep(40.0); }
      void launchAndYield() { timer = new Timer(); thread = new Thread(this); thread.start(); yieldToThread(); observed = status; }
    }`;
  const errors: string[] = [];
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'demo/Worker.java', source } : null });
  const bridge = new ThreadNative(jvm, message => errors.push(message), 'demo.Thread');
  jvm.natives.registerAsync('demo.Worker', 'loadAsset', [], async () => {
    await new Promise(resolve => setTimeout(resolve, 60)); return jv('void', undefined);
  });
  try {
    await jvm.loadClass('demo.Worker');
    const worker = await jvm.constructAsync('demo.Worker', []);
    await jvm.invokeAsync(worker, 'launch');
    for (let attempt = 0; attempt < 30 && jvm.get(worker, 'status').value !== 7; attempt++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(jvm.get(worker, 'status').value, 7, 'background run must see the initialized timer after slow asset I/O');
    const yielding = await jvm.constructAsync('demo.Worker', []);
    await jvm.invokeAsync(yielding, 'launchAndYield');
    assert.equal(jvm.get(yielding, 'observed').value, 7, 'a nested sleep must release work while its parent is still pending');
    assert.deepEqual(errors, []);
  } finally { bridge.dispose(); }
});
