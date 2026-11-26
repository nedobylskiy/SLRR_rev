import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { SystemNative } from '../src/runtime/system-native';
import type { BootEvent } from '../src/runtime/game-boot';

test('System.exit(String) displays the message and returns without terminating Java',async()=>{
  const jvm=new SlrrJvm({resolveImport:({className})=>className==='java.lang.System'?{path:'System.java',source:'package java.lang; class System { static native void exit(String message); static native int buildNumber(); }'}:null});
  const messages:string[]=[];
  new SystemNative(jvm,()=>{},()=>0,()=>0,message=>messages.push(message));
  await jvm.loadClass('java.lang.System');const receiver=jv('class','java.lang.System');
  assert.equal(jvm.invoke(receiver,'exit',[jv('String','Police debug\nmessage')]).type,'void');
  assert.deepEqual(messages,['Police debug\nmessage']);
  assert.equal(jvm.invoke(receiver,'buildNumber').value,940);
});

test('System clocks use seconds and simulation time follows time warp', async () => {
  const source = `package java.lang; class System {
    static native float currentTime(); static native float simTime();
    static native void syncGameTime(float time);
    static native void setMeasure(float value);
    static native void getConfigOptions();
    static native float timeWarp(float speed);
    static native int gc(); static native int compileAll(String path);
    static native int buildNumber();
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) =>
    className === 'java.lang.System' ? { path: 'System.java', source } : null });
  let milliseconds = 1000;
  const native = new SystemNative(jvm, () => {}, () => milliseconds);
  await jvm.loadClass('java.lang.System');
  const system = jv('class', 'java.lang.System');
  milliseconds = 2500;
  assert.equal(jvm.invoke(system, 'currentTime').value, 1.5);
  assert.equal(jvm.invoke(system, 'simTime').value, 1.5);
  assert.equal(jvm.invoke(system, 'timeWarp', [jv('float', 0)]).value, 1);
  milliseconds = 3500;
  assert.equal(jvm.invoke(system, 'currentTime').value, 2.5);
  assert.equal(jvm.invoke(system, 'simTime').value, 1.5);
  assert.equal(jvm.invoke(system, 'timeWarp', [jv('float', 2)]).value, 0);
  milliseconds = 4000;
  assert.equal(jvm.invoke(system, 'simTime').value, 2.5);
  jvm.invoke(system, 'syncGameTime', [jv('float', 3600)]);
  assert.equal(native.gameTime(), 3600);
  jvm.invoke(system, 'setMeasure', [jv('int', 1600)]);
  assert.equal(native.measure(), 1600);
  jvm.invoke(system, 'setMeasure', [jv('int', 1000)]);
  assert.equal(native.measure(), 1000);
  assert.equal(jvm.invoke(system, 'getConfigOptions').type, 'void');
  assert.equal(jvm.invoke(system, 'gc').value, 0);
  assert.equal(jvm.invoke(system, 'compileAll', [jv('String', 'scripts')]).value, 0);
  assert.equal(jvm.invoke(system, 'buildNumber').value, 940);
});

test('scene loading freezes simulation time without changing the Java time warp',()=>{
  let now=0;const jvm=new SlrrJvm({resolveImport:()=>null}),native=new SystemNative(jvm,()=>{},()=>now);
  const call=(name:string,args:ReturnType<typeof jv>[]=[])=>(jvm.natives.invoke('java.lang.System',name,jv('class','java.lang.System'),args))!;
  now=1000;native.setSceneLoading(true);assert.equal(call('simTime').value,1);assert.equal(native.timeScale,0);
  call('timeWarp',[jv('float',2)]);now=11000;assert.equal(call('simTime').value,1);
  native.setSceneLoading(false);assert.equal(native.timeScale,2);now=12000;assert.equal(call('simTime').value,3);
});

test('native System and Debug messages reach the game console', async () => {
  const sources = new Map([
    ['java.lang.System', `package java.lang; class System { static native void log(String message); }`],
    ['java.lang.Debug', `package java.lang; class Debug { native void writeFile(String message, String path); static native void giveWarning(String message); }`],
  ]);
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => {
    const source = sources.get(className);
    return source ? { path: `${className}.java`, source } : null;
  } });
  const events: BootEvent[] = [];
  new SystemNative(jvm, event => events.push(event), () => 0);
  await jvm.loadClass('java.lang.System');
  await jvm.loadClass('java.lang.Debug');
  jvm.invoke(jv('class', 'java.lang.System'), 'log', [jv('String', 'ready')]);
  const debug = jvm.construct('java.lang.Debug', []);
  jvm.invoke(debug, 'writeFile', [jv('String', 'loaded'), jv('String', 'system.log')]);
  jvm.invoke(jv('class', 'java.lang.Debug'), 'giveWarning', [jv('String', 'slow')]);
  assert.deepEqual(events.map(event => event.message), ['ready', '[system.log] loaded', 'Warning: slow']);
});

test('loading status stays active until Java resets the loading screen wait', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const system = new SystemNative(jvm, () => {});
  const receiver = jv('class', 'java.lang.System');
  assert.equal(jvm.natives.invoke('java.lang.System', 'isLoading', receiver, [])?.value, 0);
  system.beginLoading();
  assert.equal(jvm.natives.invoke('java.lang.System', 'isLoading', receiver, [])?.value, 1);
  jvm.natives.invoke('java.lang.System', 'isLoadingReset', receiver, []);
  assert.equal(jvm.natives.invoke('java.lang.System', 'isLoading', receiver, [])?.value, 0);
});

test('System.memUsage reports host memory in the kilobytes expected by Java scripts', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  let bytes = 900 * 1024 * 1024;
  new SystemNative(jvm, () => {}, () => 0, () => bytes);
  const receiver = jv('class', 'java.lang.System');
  const read = () => Number(jvm.natives.invoke('java.lang.System', 'memUsage', receiver, [])?.value);
  assert.equal(read(), 900 * 1024);
  bytes = 0;
  assert.equal(read(), 0);
});

test('Java loading reset cannot dismiss pending host assets, and dialog pause cannot hold the loader open',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),native=new SystemNative(jvm,()=>{});
  const receiver=jv('class','java.lang.System');let assetsPending=true;
  native.setLoadingReader(()=>assetsPending);native.beginLoading();
  jvm.natives.invoke('java.lang.System','isLoadingReset',receiver,[]);
  assert.equal(jvm.natives.invoke('java.lang.System','isLoading',receiver,[])!.value,1);
  native.setSceneLoading(true);assetsPending=false;
  assert.equal(jvm.natives.invoke('java.lang.System','isLoading',receiver,[])!.value,0,'Java must be able to hide its dialog while gameplay is still paused');
  assert.equal(native.timeScale,0);native.setSceneLoading(false);assert.equal(native.timeScale,1);
});

test('System.exit() asks the host to quit once, although MainMenu keeps calling it', async () => {
  // Gates.run: fade to black, userWait(1.5), System.exit(); its thread loop then repeats the call.
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.lang.System'
    ? { path: 'System.java', source: 'package java.lang; class System { static native void exit(); static native void exit(String message); }' } : null });
  const events: BootEvent[] = [], alerts: string[] = [];
  const native = new SystemNative(jvm, event => events.push(event), () => 0, () => 0, message => alerts.push(message));
  let exits = 0;
  native.setExitHandler(() => exits++);
  await jvm.loadClass('java.lang.System');
  const receiver = jv('class', 'java.lang.System');
  for (let frame = 0; frame < 3; frame++) assert.equal(jvm.invoke(receiver, 'exit', []).type, 'void');
  assert.equal(exits, 1);
  assert.deepEqual(alerts, [], 'a plain exit shows no message box');
  assert.equal(events.filter(event => /System\.exit/.test(event.message)).length, 1);
});
