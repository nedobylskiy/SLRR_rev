import test from 'node:test';import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';import {InputNative} from '../src/runtime/input-native';import {GameTypeNative} from '../src/runtime/game-type-native';import {ControllerNative} from '../src/runtime/controller-native';
import {navigatorMapPick} from '../src/render/navigator-view';
test('map picking unprojects the displayed perspective, viewport aspect, pan, zoom and north rotation',()=>{
 const frame={x:10,z:-20,height:5,fov:90,yaw:0};
 const center=navigatorMapPick(frame,.5,.5,2)!;assert.ok(Math.hypot(center[0]-10,center[1],center[2]+20)<1e-8);
 const corner=navigatorMapPick(frame,1,0,2)!;assert.ok(Math.abs(corner[0]-20)<1e-8);assert.ok(Math.abs(corner[2]+25)<1e-8);
 const rotated=navigatorMapPick({...frame,yaw:Math.PI/2},.5,0,2)!;assert.ok(Math.abs(rotated[0]-5)<1e-8&&Math.abs(rotated[2]+20)<1e-8);
 assert.equal(navigatorMapPick(frame,-.1,.5,2),undefined);assert.equal(navigatorMapPick(frame,.5,1.1,2),undefined);
});
test('map click reaches a named Java notification on the click object and exposes independent picked vectors',async()=>{
 const source='package demo; class Listener { int calls; String payload; void event_handlerClick(Object source,int event,String param){calls++;payload=param;} }';
 const jvm=new SlrrJvm({resolveImport:()=>({path:'Listener.java',source})}),events=new GameTypeNative(jvm,()=>{}),controllers=new ControllerNative(jvm,()=>0),input=new InputNative(jvm,controllers,events);
 await jvm.loadClass('demo.Listener');const listener=jvm.construct('demo.Listener',[]),ref=()=>jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()}),raw=ref(),target=ref();
 for(const object of [listener,raw,target])jvm.natives.invoke('java.lang.GameType','createNativeInstance',object,[]);
 const cursor=jv('MouseCursor',{className:'java.io.MouseCursor',fields:new Map([['cursor',raw]])});input.mouseCursor=()=>cursor;
 jvm.natives.invoke('java.lang.GameType','setEventMask',listener,[jv('int',65536)]);
 jvm.natives.invoke('java.lang.GameType','addNotification',listener,[target,jv('int',65536),jv('int',0),jv('String',null),jv('String','event_handlerClick')]);
 const id=events.getResource(target)!.resourceId;input.cursorEvent(5,{id,local:[1.2,0,-3.4],world:[1.2,0,-3.4]},true);
 for(let i=0;i<10&&!jvm.get(listener,'calls').value;i++)await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(jvm.get(listener,'calls').value,1);assert.match(String(jvm.get(listener,'payload').value),/^5 /);
 const pick=()=>jvm.natives.invoke('java.io.MouseCursor','getPickedPos',cursor,[])!,first=pick(),second=pick();assert.ok(Math.abs(Number(jvm.get(first,'x').value)-1.2)<1e-6);
 jvm.set(first,'x',jv('float',99));assert.ok(Math.abs(Number(jvm.get(second,'x').value)-1.2)<1e-6);
 assert.equal(jvm.natives.invoke('java.io.MouseCursor','getPickedPos',cursor,[first])?.value,first.value);assert.ok(Math.abs(Number(jvm.get(first,'x').value)-1.2)<1e-6);events.dispose();
});
