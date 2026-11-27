import test from 'node:test';
import assert from 'node:assert/strict';
import { JavaMouse } from '../src/render/java-mouse';
import type { BootResult } from '../src/runtime/game-boot';
import type { Assets } from '../src/assets';

test('captured painting retains its pick and always emits left release on window up or cancellation',()=>{
  class Surface extends EventTarget {
    dataset:Record<string,string>={};style={cursor:'',removeProperty(){}};
    setPointerCapture(_:number){}hasPointerCapture(_:number){return false;}releasePointerCapture(_:number){}
  }
  class Canvas extends Surface {}
  const originals=['HTMLCanvasElement','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  const win=new EventTarget();Object.defineProperty(globalThis,'HTMLCanvasElement',{value:Canvas,configurable:true});Object.defineProperty(globalThis,'window',{value:win,configurable:true});
  const surface=new Surface(),canvas=new Canvas(),events:number[]=[];
  const hit={id:42,local:[1,2,3],world:[4,5,6],normal:[0,0,1]};let picked:unknown;
  const result={input:{mouseCursor:()=>({value:{}}),cursorEvent:(code:number)=>events.push(code),setPhysicalAxis(){},physicalAxis:()=>0,setPickedTarget:(value:unknown)=>{picked=value;}},
    jvm:{get:(_:unknown,key:string)=>({value:key==='visible'?0:{}})},gameTypes:{lastCommand:()=>undefined}} as unknown as BootResult;
  const mouse=new JavaMouse(surface as unknown as HTMLElement,result,{} as Assets,()=>{},()=>hit);
  const send=(type:string,x:number,target:EventTarget=surface,on:EventTarget=surface)=>{
    const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:1,clientX:x,clientY:10});Object.defineProperty(event,'target',{value:target});on.dispatchEvent(event);
  };
  try{
    send('pointerdown',0,canvas);send('pointermove',30);assert.equal(picked,hit,'capture retargeting does not clear the paint hit');
    send('pointerup',30,win,win);assert.deepEqual(events,[1,9,10,2]);
    events.length=0;send('pointerdown',0,canvas);win.dispatchEvent(new Event('blur'));assert.deepEqual(events,[1,2]);
    events.length=0;send('pointerdown',0,canvas);send('pointermove',30);send('pointercancel',30);assert.deepEqual(events,[1,9,10,2]);
  }finally{
    mouse.dispose();for(const [key,original]of originals)if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);
  }
});

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
    assert.deepEqual(events,[1,9,10,2]); assert.deepEqual(drops,[{onto:target,source:{object:part}}]);
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

test('two fingers on a Java-controlled camera act as a right-button drag, and a pinch as the wheel', () => {
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
  const canvas = new Canvas(), events: number[] = [], axes = new Map<number, number>(), wheel: number[] = [];
  const hit = { id: 42, local: [0, 0, 0], world: [0, 0, 0] };
  const result = {
    input: { mouseCursor: () => ({ value: {} }), cursorEvent: (code: number) => events.push(code), setPickedTarget() {},
      setPhysicalAxis: (_: number, axis: number, value: number) => { axes.set(axis, value); if (axis === 2 && value) wheel.push(value); },
      physicalAxis: (_: number, axis: number) => axes.get(axis) ?? 0 },
    jvm: { get: (_: unknown, key: string) => ({ value: key === 'visible' ? 0 : {} }) },
    gameTypes: { lastCommand: () => undefined },
  } as unknown as BootResult;
  const mouse = new JavaMouse(canvas as unknown as HTMLElement, result, {} as Assets, message => assert.fail(message), () => hit);
  const touch = (type: string, id: number, x: number, y = 100) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
    Object.defineProperty(event, 'target', { value: canvas });
    canvas.dispatchEvent(event);
  };
  try {
    touch('pointerdown', 1, 100);
    assert.deepEqual(events, [1], 'one finger is a left press on the part');
    touch('pointerdown', 2, 200);
    assert.deepEqual(events, [1, 2, 3], 'the second finger drops the press and holds the right button');
    assert.equal(axes.get(4), 1);
    touch('pointermove', 1, 120); // midpoint +10 px, span 100 -> 80 (pinch: zoom out)
    assert.deepEqual(events, [1, 2, 3, 12]);
    assert.ok(Math.abs(axes.get(0)! - .1) < 1e-9, 'midpoint travel feeds mouse X like a right-button drag');
    assert.deepEqual(wheel, [-1], 'a 20% pinch is a wheel notch down');
    touch('pointermove', 2, 340); // span 80 -> 220: spread, zoom in
    assert.equal(wheel.at(-1), 1);
    touch('pointerup', 2, 340);
    assert.deepEqual(events.slice(-2), [13, 4], 'lifting a finger ends the drag');
    assert.equal(axes.get(4), 0);
    touch('pointerup', 1, 120);
    assert.equal(events.filter(code => code === 5).length, 0, 'the gesture never clicks the part');
  } finally {
    mouse.dispose();
    for (const [name, descriptor] of [['HTMLCanvasElement', savedCanvas], ['window', savedWindow]] as const)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});

test('a touch long press on an inventory gadget opens its drop menu instead of clicking', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  class Surface extends EventTarget {
    dataset: Record<string,string> = {};
    style = {cursor:'',removeProperty() {}};
    setPointerCapture(_: number) {} hasPointerCapture(_: number) { return false; } releasePointerCapture(_: number) {}
  }
  const originals = ['HTMLCanvasElement','window'].map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
  Object.defineProperty(globalThis,'HTMLCanvasElement',{value:Surface,configurable:true});
  Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
  const surface = new Surface(), drops: unknown[] = [];
  const gadget = {type:'PhysicsRef',value:{}}, button = {type:'PhysicsRef',value:{}}, repair = {type:'PhysicsRef',value:{}}, sell = {type:'PhysicsRef',value:{}};
  const result = {input:{mouseCursor:()=>({value:{}}),cursorEvent() {},setPhysicalAxis() {},physicalAxis:()=>0},
    jvm:{get:(_:unknown,key:string)=>({value:key==='visible'?0:{}})},
    gameTypes:{lastCommand:()=>undefined},
    osdButtons:{physicsAt:(x:number)=>x>=200?button:gadget,
      dropTargets:async (source:unknown)=>source===gadget?[{physics:repair,label:'Repair Part'},{physics:sell,label:'Sell Part'}]:[],
      dropOn:async (onto:unknown,source:unknown)=>{drops.push({onto,source});return true;}},
  } as unknown as BootResult;
  const mouse = new JavaMouse(surface as unknown as HTMLElement,result,{} as Assets,()=>{});
  const menus: { labels: string[]; choose: (index: number) => void }[] = [];
  mouse.showMenu = (_host, _x, _y, labels, choose) => { menus.push({labels,choose}); return () => {}; };
  const pointer = (type:string,x:number) => {const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:1,pointerType:'touch',clientX:x,clientY:10});surface.dispatchEvent(event);return event;};
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const click = () => {const event=new Event('click',{cancelable:true});surface.dispatchEvent(event);return event.defaultPrevented;};
  try {
    pointer('pointerdown',50); t.mock.timers.tick(499); await flush();
    assert.equal(menus.length,0);
    t.mock.timers.tick(1); await flush();
    assert.deepEqual(menus.map(menu=>menu.labels),[['Repair Part','Sell Part']]);
    pointer('pointerup',50);
    assert.equal(click(),true,'the click after the long press is swallowed');
    menus[0].choose(1); await flush();
    assert.deepEqual(drops,[{onto:sell,source:{physics:gadget}}]);
    // A short tap and a drag never open the menu.
    pointer('pointerdown',50); t.mock.timers.tick(200); pointer('pointerup',50); t.mock.timers.tick(600); await flush();
    assert.equal(click(),false); assert.equal(menus.length,1);
    pointer('pointerdown',50); pointer('pointermove',80); t.mock.timers.tick(600); await flush();
    assert.equal(menus.length,1); pointer('pointercancel',80);
    // Without drop targets a long press stays an ordinary press.
    pointer('pointerdown',250); t.mock.timers.tick(600); await flush(); pointer('pointerup',250);
    assert.equal(menus.length,1); assert.equal(click(),false);
  } finally {
    mouse.dispose();
    for(const [name,descriptor] of originals) if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);
  }
});
