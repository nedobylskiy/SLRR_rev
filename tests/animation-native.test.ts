import {test} from 'node:test';import assert from 'node:assert/strict';
import {SlrrJvm,jv,type JavaValue} from 'slrr-jvm';import {GameTypeNative} from '../src/runtime/game-type-native';import {RenderRefNative} from '../src/runtime/render-ref-native';import {AnimationNative} from '../src/runtime/animation-native';
const ref=(name:string):JavaValue=>jv(name.split('.').at(-1)!,{className:name,fields:new Map()});
test('Java Animation controls the original render instance, exposes position and releases only its own binding',()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),changes:number[]=[];const resources=new GameTypeNative(jvm,()=>{},node=>changes.push(node.id));new RenderRefNative(jvm,resources);const animations=new AnimationNative(jvm,resources);
 const parent=ref('java.util.resource.GameRef'),type=ref('java.util.resource.RenderRef'),render=ref('java.util.resource.RenderRef'),clip=ref('java.util.resource.ResourceRef');
 jvm.natives.invoke('java.lang.GameType','createNativeInstance',parent,[]);
 for(const r of [type,render,clip])jvm.natives.invoke('java.util.resource.ResourceRef','newNative',r,[]);
 const source=resources.getResource(clip)!;source.resourcePack='humans.rpk';source.typeId=20;
 jvm.natives.invoke('java.util.resource.RenderRef','create',render,[jv('ResourceRef',parent.value),type,jv('String','spectator')]);const node=resources.getRender(render)!;
 const animation=ref('java.util.resource.Animation');jvm.natives.invoke('java.util.resource.Animation','<init>',animation,[render,clip]);
 const call=(method:string,args:JavaValue[]=[])=>jvm.natives.invoke('java.util.resource.Animation',method,animation,args);
 call('setSpeed',[jv('float',1.25)]);call('loopPlay');assert.equal(node.animation?.speed,1.25);assert.equal(node.animation?.loop,true);assert.equal(node.animation?.playing,true);
 call('seek',[jv('float',.4)]);assert.equal(call('getPos')?.value,.4);call('pause');assert.equal(node.animation?.playing,false);
 call('play');assert.equal(node.animation?.loop,false);call('setFade',[jv('float',.2)]);assert.equal(node.animation?.fade,.2);assert.throws(()=>call('seek',[jv('float',NaN)]),/Invalid/);
 const other=ref('java.util.resource.Animation');jvm.natives.invoke('java.util.resource.Animation','<init>',other,[render,clip]);const current=node.animation;call('finalize');assert.equal(node.animation,current,'old finalizer does not remove newer animation');
 animations.dispose();assert.equal(node.animation,null);assert.ok(changes.length>6);
});
