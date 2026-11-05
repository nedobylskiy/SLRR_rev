import test from 'node:test';
import assert from 'node:assert/strict';
import { JavaMouse } from '../src/render/java-mouse';
import type { BootResult } from '../src/runtime/game-boot';
import type { Assets } from '../src/assets';

test('right click sends the picked part to Java, while drag and cancellation never click', () => {
  class Canvas extends EventTarget {
    dataset: Record<string, string> = {};
    style = { cursor: '', removeProperty: (_: string) => {} };
    setPointerCapture(_: number) {}
    hasPointerCapture(_: number) { return false; }
    releasePointerCapture(_: number) {}
  }
  const savedCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: Canvas, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  const canvas = new Canvas(), events: { code: number; hit: unknown }[] = [];
  const hit = { id: 42, local: [0.1, 0.2, 0.3], world: [10, 2, 3] };
  const result = {
    input: { mouseCursor: () => ({ value: {} }), cursorEvent: (code: number, hit?: unknown) => events.push({ code, hit }),
      setPhysicalAxis: () => {}, physicalAxis: () => 0 },
    jvm: { get: (_: unknown, key: string) => ({ value: key === 'visible' ? 0 : {} }) },
    gameTypes: { lastCommand: () => undefined },
  } as unknown as BootResult;
  const mouse = new JavaMouse(canvas as unknown as HTMLElement, result, {} as Assets, message => assert.fail(message), () => hit);
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 2, pointerId: 1, clientX: x, clientY: y });
    canvas.dispatchEvent(event);
  };
  try {
    pointer('pointerdown', 10, 20);
    pointer('pointermove', 11, 21); // Small hand movement is still a click.
    pointer('pointerup', 11, 21);
    assert.deepEqual(events.map(event => event.code), [3, 4, 6]);
    assert.deepEqual(events[2].hit, hit);
    events.length = 0;
    pointer('pointerdown', 10, 20);
    pointer('pointermove', 30, 20);
    pointer('pointerup', 30, 20);
    assert.deepEqual(events.map(event => event.code), [3, 12, 13, 4]);
    events.length = 0;
    pointer('pointerdown', 10, 20);
    canvas.dispatchEvent(new Event('pointercancel'));
    pointer('pointerup', 10, 20);
    assert.deepEqual(events.map(event => event.code), [3, 4]);
  } finally {
    mouse.dispose();
    for (const [name, descriptor] of [['HTMLCanvasElement', savedCanvas], ['window', savedWindow]] as const)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});


test('left drag carries car parts or dock gadgets to OSD without clicking or dropping on cancellation', async () => {
  class Surface extends EventTarget {
    dataset: Record<string,string> = {};
    style = {cursor:'',removeProperty() {}};
    setPointerCapture(_: number) {} hasPointerCapture(_: number) { return false; } releasePointerCapture(_: number) {}
  }
  const originals = ['HTMLCanvasElement','window'].map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
  Object.defineProperty(globalThis,'HTMLCanvasElement',{value:Surface,configurable:true});
  Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
  const surface = new Surface(), events: number[] = [], drops: unknown[] = [];
  const gadget = {type:'PhysicsRef',value:{}}, target = {type:'PhysicsRef',value:{}}, part = {type:'GameRef',value:{}};
  const hit = {id:42,local:[0,0,0],world:[0,0,0]};
  const result = {input:{mouseCursor:()=>({value:{}}),cursorEvent:(code:number)=>events.push(code),setPhysicalAxis() {},physicalAxis:()=>0},
    jvm:{get:(_:unknown,key:string)=>({value:key==='visible'?0:{}})},
    gameTypes:{lastCommand:()=>undefined,getByResourceId:()=>({}),reference:()=>part},
    osdButtons:{physicsAt:(x:number)=>x>=100?target:x>=50?gadget:undefined,
      dropOn:async (onto:unknown,source:unknown)=>{drops.push({onto,source});return true;}},
  } as unknown as BootResult;
  const mouse = new JavaMouse(surface as unknown as HTMLElement,result,{} as Assets,()=>{},()=>hit);
  const pointer = (type:string,x:number) => {const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:1,clientX:x,clientY:10});surface.dispatchEvent(event);};
  try {
    pointer('pointerdown',10); pointer('pointermove',30); pointer('pointerup',110);
    await Promise.resolve();
    assert.deepEqual(events,[1,9,10]); assert.deepEqual(drops,[{onto:target,source:{object:part}}]);
    const click=new Event('click',{cancelable:true});surface.dispatchEvent(click);assert.equal(click.defaultPrevented,true);
    events.length=0; drops.length=0;
    pointer('pointerdown',55);pointer('pointermove',70);pointer('pointerup',110);await Promise.resolve();
    assert.deepEqual(drops,[{onto:target,source:{physics:gadget}}]);assert.deepEqual(events,[]);
    drops.length=0;pointer('pointerdown',10);pointer('pointermove',30);pointer('pointercancel',30);pointer('pointerup',110);
    assert.deepEqual(drops,[]);
  } finally {
    mouse.dispose();
    for(const [name,descriptor] of originals) if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);
  }
});
