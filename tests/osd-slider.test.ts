import test from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv,type JavaValue} from 'slrr-jvm';
import {GameTypeNative} from '../src/runtime/game-type-native';
import {PhysicsRefNative} from '../src/runtime/physics-ref-native';
import {OsdButtonNative} from '../src/runtime/osd-button-native';
import type {OsdElement} from '../src/osd/osd-layer';

const object=(className:string,fields:Record<string,JavaValue>={})=>jv(className.split('.').at(-1)!,{className,fields:new Map(Object.entries(fields))});
test('slider knob and rail send Java values across nested viewports, capture drags and suppress duplicate clicks',async()=>{
  const sources:Record<string,string>={
    'java.util.Vector':`package java.util; class Vector { Object[] elementData; int elementCount;
      int size(){return elementCount;} Object elementAt(int i){return elementData[i];} }`,
    'java.render.Osd':'package java.render; class Osd { float sliderValue; int messages; }',
    'java.render.osd.Slider':`package java.render.osd; import java.render.Osd;
      class Gadget {} class Slider extends Gadget {
        Osd osd; float a; float b; float value; float x0; float x1; int ticks; int disabled;
        void setValue(float f) { int n = (int)((f+50.0)/100.0); value = n*100.0; }
        void sendMessage() { osd.sliderValue=value; osd.messages++; }
      }`,
  };
  const jvm=new SlrrJvm({resolveImport:({className})=>sources[className]?{path:className+'.java',source:sources[className]}:null});
  await jvm.loadClass('java.render.Osd');await jvm.loadClass('java.render.osd.Slider');await jvm.loadClass('java.util.Vector');
  const resources=new GameTypeNative(jvm,()=>{}),physics=new PhysicsRefNative(jvm,resources);
  const nodes:any[]=[],listeners=new Map<any,Map<string,Function>>();
  let captured:number|undefined;
  const surface={createHitTarget(){
    const node:any={style:{},focus(){},remove(){},closest(){return {getBoundingClientRect(){return {left:100,width:800};}};},
      addEventListener(name:string,fn:Function){listeners.get(node)!.set(name,fn);},
      setPointerCapture(id:number){captured=id;},hasPointerCapture(id:number){return captured===id;},releasePointerCapture(){captured=undefined;}};
    nodes.push(node);listeners.set(node,new Map());
    return {node,setText(){},setResource(){},setBounds(){},show(){},hide(){}} as OsdElement;
  }};
  const bridge=new OsdButtonNative(jvm,surface,undefined,()=>({priority:2,left:.25,top:.1,width:.5,height:.5}));
  bridge.setWorldPhysics(physics);
  const osd=object('java.render.Osd',{cam:object('Camera'),vpAspect:jv('float',16/9),vpWidth:jv('float',.5),vpHeight:jv('float',.5),messages:jv('int',0)});
  const knob=object('java.util.resource.PhysicsRef'),rail=object('java.util.resource.PhysicsRef');
  const slider=object('java.render.osd.Slider',{osd,phy:knob,x0:jv('float',-.5),x1:jv('float',.5),a:jv('float',500),b:jv('float',1500),value:jv('float',500)});
  const button=object('java.render.osd.Gadget',{phy:rail,parent:slider});
  const vector=object('java.util.Vector',{elementData:jv('Object[]',[slider,button]),elementCount:jv('int',2)});
  const group=object('java.render.Group',{osd,gadget:vector,active:jv('int',1)});
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',group,[]);
  const invoke=(method:string,ref:JavaValue,args:JavaValue[])=>jvm.natives.invoke('java.util.resource.PhysicsRef',method,ref,args);
  for(const phy of [knob,rail]){
    invoke('createBox',phy,[jv('ResourceRef',group.value),jv('float',1),jv('float',.1),jv('float',.001),jv('String','knob')]);
    invoke('setMatrix',phy,[object('java.lang.Vector3',{x:jv('float',0),y:jv('float',0),z:jv('float',0)}),jv('Ypr',null)]);
  }
  try{
    assert.equal(await bridge.setSliderPosition(rail,0),true);
    assert.equal(jvm.get(osd,'sliderValue').value,1000);
    await bridge.setSliderPosition(knob,1);assert.equal(jvm.get(slider,'value').value,1500);
    await bridge.setSliderPosition(knob,-1);assert.equal(jvm.get(slider,'value').value,500);
    const messages=jvm.get(osd,'messages').value;
    await bridge.setSliderPosition(knob,-1);assert.equal(jvm.get(osd,'messages').value,messages);
    const event=(x:number)=>({button:0,pointerId:7,clientX:x,preventDefault(){},stopPropagation(){}});
    listeners.get(nodes[1])!.get('pointerdown')!(event(400));assert.equal(captured,7);
    listeners.get(nodes[1])!.get('pointermove')!(event(500));
    listeners.get(nodes[1])!.get('pointerup')!(event(600));assert.equal(captured,undefined);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(jvm.get(osd,'sliderValue').value,1500,'last drag position must survive coalescing');
    let stopped=false;listeners.get(nodes[1])!.get('click')!({preventDefault(){},stopImmediatePropagation(){stopped=true;}});assert.ok(stopped);
    jvm.set(slider,'disabled',jv('int',1));assert.equal(await bridge.setSliderPosition(knob,0),false);
    jvm.set(slider,'disabled',jv('int',0));jvm.set(slider,'a',jv('float',1500));jvm.set(slider,'b',jv('float',500));
    await bridge.setSliderPosition(rail,1);assert.equal(jvm.get(osd,'sliderValue').value,500,'descending ranges work');
    jvm.set(group,'active',jv('int',0));assert.equal(await bridge.setSliderPosition(knob,0),false);
  }finally{bridge.dispose();resources.dispose();}
});
