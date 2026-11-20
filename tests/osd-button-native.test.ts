import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { OsdButtonNative, osdHitDepth } from '../src/runtime/osd-button-native';
import type { OsdElement } from '../src/osd/osd-layer';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PhysicsRefNative } from '../src/runtime/physics-ref-native';

const object = (className: string, fields: Record<string, JavaValue> = {}) =>
  jv(className.split('.').at(-1)!, { className, fields: new Map(Object.entries(fields)) });

test('Save commits an active file-name editor before confirming, without auto-submitting twice', async () => {
  const sources: Record<string,string> = {
    'java.render.osd.Gadget': `package java.render.osd;
      class Gadget { java.render.Osd osd; int cmd; void click() { osd.globalHandler.osdCommand(cmd); } }
      class Button extends Gadget {}
      class StringInput extends Gadget { String inputString; void sendMessage() {
        osd.stringValue = inputString; osd.globalHandler.osdCommand(cmd);
      } }`,
    'java.render.Osd': `package java.render;
      class Osd { java.render.osd.Gadget actGadget; String stringValue;
        java.render.osd.dialog.FileRequesterDialog globalHandler; }
      class Group {}
      class Vector { Object[] data; int size() { return data.length; } Object elementAt(int i) { return data[i]; } }`,
    'java.render.osd.dialog.FileRequesterDialog': `package java.render.osd.dialog;
      class FileRequesterDialog { java.render.Osd osd; String fileName; int submissions; int cancels; int edits;
        void osdCommand(int cmd) {
          if (cmd == 200) { edits++; fileName = osd.stringValue; if (!osd.actGadget) osdCommand(0); }
          if (cmd == 0 && fileName && fileName.length() > 0) submissions++;
          if (cmd == 1) cancels++;
        }
      }`,
  };
  const jvm = new SlrrJvm({resolveImport:({className}) => {
    const key=className.startsWith('java.render.osd.dialog.') ? 'java.render.osd.dialog.FileRequesterDialog'
      : className.startsWith('java.render.osd.') ? 'java.render.osd.Gadget' : 'java.render.Osd';
    return {path:key+'.java',source:sources[key]};
  }});
  await jvm.loadClass('java.render.osd.Gadget');
  await jvm.loadClass('java.render.osd.StringInput');
  await jvm.loadClass('java.render.osd.Button');
  await jvm.loadClass('java.render.Osd');
  await jvm.loadClass('java.render.Vector');
  await jvm.loadClass('java.render.osd.dialog.FileRequesterDialog');
  jvm.natives.register('java.lang.String','length',[],({receiver})=>jv('int',String(receiver.value).length));
  const resources=new GameTypeNative(jvm,()=>{}), physics=new PhysicsRefNative(jvm,resources);
  const bridge=new OsdButtonNative(jvm); bridge.setWorldPhysics(physics);
  const osd=object('java.render.Osd',{cam:object('Camera')});
  const handler=object('java.render.osd.dialog.FileRequesterDialog',{
    osd,fileName:jv('String',null),submissions:jv('int',0),cancels:jv('int',0),edits:jv('int',0),
  });
  const editor=object('java.render.osd.StringInput',{osd,cmd:jv('int',200),inputString:jv('String','eggman')});
  jvm.set(osd,'globalHandler',handler); jvm.set(osd,'actGadget',editor);
  const phy=object('java.util.resource.PhysicsRef');
  const button=object('java.render.osd.Button',{osd,phy,cmd:jv('int',0)});
  const group=object('java.render.Group',{osd,active:jv('int',1),gadget:object('java.render.Vector',{data:jv('Object[]',[button])})});
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',group,[]);
  jvm.natives.invoke('java.util.resource.PhysicsRef','createBox',phy,[jv('ResourceRef',group.value),jv('float',1),jv('float',1),jv('float',.001),jv('String','')]);
  try {
    await bridge.activate(phy);
    assert.equal(jvm.get(handler,'fileName').value,'eggman');
    assert.equal(jvm.get(handler,'submissions').value,1);
    assert.equal(jvm.get(handler,'edits').value,1);
    jvm.set(button,'cmd',jv('int',1));
    jvm.set(editor,'inputString',jv('String','uncommitted'));
    await bridge.activate(phy);
    assert.equal(jvm.get(handler,'cancels').value,1);
    assert.equal(jvm.get(handler,'fileName').value,'eggman','Cancel does not commit the editor');
    jvm.set(button,'cmd',jv('int',0)); jvm.set(editor,'inputString',jv('String',''));
    await bridge.activate(phy);
    assert.equal(jvm.get(handler,'submissions').value,1,'an empty filename is still rejected');
  } finally { bridge.dispose(); resources.dispose(); }
});

test('night-race menus get a background behind the text, following their Java group visibility', async () => {
  const jvm = new SlrrJvm({resolveImport: ({className}) => className === 'java.game.City'
    ? {path:'City.java',source:'package java.game; class City {}'}
    : {path:'Vector.java',source:'package java.render; class Vector { Object[] data; int size() { return 3; } Object elementAt(int i) { return data[i]; } }'}});
  await jvm.loadClass('java.game.City'); await jvm.loadClass('java.render.Vector');
  const resources=new GameTypeNative(jvm,()=>{}), physics=new PhysicsRefNative(jvm,resources);
  const owner=object('java.game.City',{nightRaceGroup:jv('int',1),nrWatchingGroup:jv('int',2)});
  const osd=object('Osd',{cam:object('Camera'),globalHandler:owner});
  const groups=[0,1,2].map(()=>object('java.render.Group',{osd,active:jv('int',1)}));
  (osd.value as {fields:Map<string,JavaValue>}).fields.set('groups',object('java.render.Vector',{data:jv('Object[]',groups.map(g=>g.value))}));
  const backgrounds:{visible:boolean;removed:boolean;bounds:number[];resource:unknown}[]=[];
  const element=(state:{visible:boolean;removed:boolean;bounds:number[]}):OsdElement=>({
    node:{remove(){state.removed=true;}} as HTMLElement,setText(){},setResource(){},
    setBounds(...bounds){state.bounds=bounds;},show(){state.visible=true;},hide(){state.visible=false;},
  });
  const bridge=new OsdButtonNative(jvm,{
    createHitTarget:()=>element({visible:false,removed:false,bounds:[]}),
    createRectangle:(x,y,w,h,z,resource)=>{const state={visible:true,removed:false,bounds:[x,y,w,h,z],resource};backgrounds.push(state);return element(state);},
  });
  bridge.setWorldPhysics(physics);
  for (const group of groups) {
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',group,[]);
    const box=object('java.util.resource.PhysicsRef');
    jvm.natives.invoke('java.util.resource.PhysicsRef','createBox',box,[jv('ResourceRef',group.value),jv('float',.8),jv('float',.2),jv('float',.001),jv('String','')]);
    jvm.natives.invoke('java.util.resource.PhysicsRef','setMatrix',box,[object('Vector3',{x:jv('float',-.5),y:jv('float',.4),z:jv('float',-.002)}),jv('Ypr',null)]);
  }
  assert.equal(backgrounds.length,2,'ordinary transparent controls keep their original style');
  assert.deepEqual(backgrounds[0].resource,{pack:'frontend.rpk',id:0xa2});
  assert.ok(backgrounds[0].bounds[4]<2,'background stays behind OSD text at depth 2');
  (groups[1].value as {fields:Map<string,JavaValue>}).fields.set('active',jv('int',0)); bridge.sync();
  assert.equal(backgrounds[0].visible,false);assert.equal(backgrounds[1].visible,true);
  (osd.value as {fields:Map<string,JavaValue>}).fields.set('cam',jv('Camera',null));bridge.sync();
  assert.equal(backgrounds[1].visible,false);
  bridge.dispose(); assert.ok(backgrounds.every(state=>state.removed));resources.dispose();
});

test('an OSD PhysicsRef creates an HTML hit target and clicks its Java Button', async () => {
  const source = `package java.render;
    class Clicks { static int count; static int hover; static int leave; }
    class Gadget { void focus() { Clicks.hover++; } void unfocus() { Clicks.leave++; } }
    class Button extends Gadget { void click() { Clicks.count++; } }
    class Group {}
    class Osd { Gadget pointedGadget;
      void activateText(Group group, Gadget gadget) { pointedGadget = gadget; gadget.focus(); }
      void deactivateText() { pointedGadget.unfocus(); pointedGadget = null; }
    }
    class Vector { Object[] elementData; int elementCount;
      int size() { return elementCount; }
      Object elementAt(int index) { return elementData[index]; }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('java.render.')
    ? { path: 'Button.java', source } : null });
  await jvm.loadClass('java.render.Button');
  await jvm.loadClass('java.render.Vector');
  await jvm.loadClass('java.render.Clicks');
  await jvm.loadClass('java.render.Osd');
  let clickFromHtml: (() => void) | undefined;
  let hoverFromHtml: (() => void) | undefined;
  let leaveFromHtml: (() => void) | undefined;
  let bounds: number[] = [];
  let depth = NaN;
  let removed = false;
  let visible = false;
  const node = { remove() { removed = true; } } as unknown as HTMLElement;
  const surface = { createHitTarget(_label: string, x: number, y: number, width: number, height: number,
    layerDepth: number, action: () => void, hover?: () => void, leave?: () => void): OsdElement {
    clickFromHtml = action;
    hoverFromHtml = hover;
    leaveFromHtml = leave;
    bounds = [x, y, width, height];
    depth = layerDepth;
    return { node, setText() {}, setResource() {}, setBounds(_x, _y, _width, _height, nextDepth) { depth = nextDepth; },
      show() { visible = true; }, hide() { visible = false; } };
  } };
  const resources = new GameTypeNative(jvm, () => {});
  const worldPhysics = new PhysicsRefNative(jvm, resources);
  const bridge = new OsdButtonNative(jvm, surface, undefined, undefined, () => 4 / 3);
  bridge.setWorldPhysics(worldPhysics);
  const cursorEvents: [number, JavaValue][] = [];
  bridge.setCursorEvents((code, physics) => cursorEvents.push([code, physics]));
  const osd = object('java.render.Osd', {
    vpAspect: jv('float', 4 / 3), vpWidth: jv('float', 1), vpHeight: jv('float', 1), cam: jv('Camera', null),
  });
  const physics = object('java.util.resource.PhysicsRef');
  const gadget = object('java.render.Button', { phy: physics, disabled: jv('int', 0) });
  const vector = object('java.render.Vector', { elementData: jv('Object[]', [gadget]), elementCount: jv('int', 1) });
  const group = object('java.render.Group', { osd, gadget: vector, active: jv('int', 1) });
  const groupRef = jv('ResourceRef', group.value);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', group, []);
  const nil = jv('Ypr', null);
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'createBox', physics,
    [groupRef, jv('float', 3.917), jv('float', 2.938), jv('float', 0.001), jv('String', ' ')]);
  const second = object('java.util.resource.PhysicsRef');
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'createBox', second,
    [groupRef, jv('float', 1), jv('float', 1), jv('float', 0.001), jv('String', ' ')]);
  const id = (ref: JavaValue) => jvm.natives.invoke('java.util.resource.ResourceRef', 'id', ref, [])!.value;
  assert.notEqual(id(physics), 0, 'OSD boxes must not match the world hover sentinel');
  assert.notEqual(id(physics), id(second), 'inventory slots have distinct native hit IDs');
  const position = object('java.lang.Vector3', { x: jv('float', 0), y: jv('float', 0), z: jv('float', -0.002) });
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'setMatrix', physics, [position, nil]);
  assert.equal(depth, osdHitDepth(-0.002, bounds[2], bounds[3]));
  (position.value as { fields: Map<string, JavaValue> }).fields.set('z', jv('float', 3));
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'setMatrix', physics, [position, nil]);
  assert.equal(depth, osdHitDepth(3, bounds[2], bounds[3]), 'a moved arrow hotspot must rise above the shield');
  const hotSpot = jvm.natives.invoke('java.util.resource.PhysicsRef', 'getPos', physics, [])!;
  assert.equal(jvm.get(hotSpot, 'z').value, 3);
  (position.value as { fields: Map<string, JavaValue> }).fields.set('z', jv('float', 4));
  assert.equal(jvm.get(hotSpot, 'z').value, 3, 'getPos returns a snapshot of the current hit box position');
  assert.ok(clickFromHtml);
  assert.ok(hoverFromHtml && leaveFromHtml);
  assert.ok(Math.abs(bounds[2] - 2) < 0.01);
  assert.ok(Math.abs(bounds[3] - 2) < 0.01);
  assert.equal(visible, false);
  (osd.value as { fields: Map<string, JavaValue> }).fields.set('cam', object('java.render.Camera'));
  bridge.sync();
  assert.equal(visible, true);
  await bridge.hover(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'hover').value, 1);
  await bridge.leave(physics);
  assert.deepEqual(cursorEvents.map(([code]) => code), [15, 16]);
  assert.equal(cursorEvents[0][1], physics, 'hover carries the native inventory panel hotspot');
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'leave').value, 1);
  assert.equal((await jvm.invokeAsync(vector, 'size')).value, 1);
  assert.equal(((await jvm.invokeAsync(vector, 'elementAt', [jv('int', 0)])).value as JavaValue).value, gadget.value);
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  (osd.value as { fields: Map<string, JavaValue> }).fields.set('cam', jv('Camera', null));
  bridge.sync();
  assert.equal(visible, false);
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  (osd.value as { fields: Map<string, JavaValue> }).fields.set('cam', object('java.render.Camera'));
  bridge.sync();
  (gadget.value as { fields: Map<string, JavaValue> }).fields.set('disabled', jv('int', 1));
  await bridge.hover(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'hover').value, 2,
    'disabled buttons still invoke Java focus, which draws their forbidden overlay');
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  await bridge.leave(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'leave').value, 2,
    'leaving the disabled button clears its overlay');
  (gadget.value as { fields: Map<string, JavaValue> }).fields.set('nofocus', jv('int', 1));
  await bridge.hover(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'hover').value, 2,
    'explicitly unfocusable controls still ignore hover');
  bridge.dispose();
  assert.equal(removed, true);
});

test('small arrow hitboxes outrank the central ghost area on the same Java depth plane', () => {
  assert.ok(osdHitDepth(3, 0.11, 0.11) > osdHitDepth(3, 1.15, 0.21));
  assert.ok(osdHitDepth(3, 1.15, 0.21) > osdHitDepth(-0.002, 2, 2));
});


test('OSD drops call Java Button overloads only on enabled visible drop targets', async () => {
  const source = `package java.render;
    class GameRef {}
    class Gadget {}
    class Button extends Gadget {
      Osd osd;
      void drop(GameRef value) { osd.dropObject = value; osd.objectDrops++; osd.dropObject = null; }
      void drop(Gadget value) { osd.dropGadget = value; osd.gadgetDrops++; osd.dropGadget = null; }
    }
    class Group {}
    class Osd { GameRef dropObject; Gadget dropGadget; int objectDrops; int gadgetDrops; }
    class Vector { Object[] elements; int size() { return elements.length; } Object elementAt(int i) { return elements[i]; } }
  `;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Button.java', source }) });
  await jvm.loadClass('java.render.Button'); await jvm.loadClass('java.render.Vector');
  const resources = new GameTypeNative(jvm, () => {}), physics = new PhysicsRefNative(jvm, resources);
  const bridge = new OsdButtonNative(jvm); bridge.setWorldPhysics(physics);
  const osd = object('java.render.Osd', { cam: object('java.render.Camera'), objectDrops: jv('int',0), gadgetDrops: jv('int',0),
    dropObject: jv('GameRef',null), dropGadget: jv('Gadget',null) });
  const hotspot = (enabled: number) => {
    const phy = object('java.util.resource.PhysicsRef');
    const button = object('java.render.Button', { osd, phy, disabled: jv('int',0), dropEnabled: jv('int',enabled) });
    const group = object('java.render.Group', { osd, active: jv('int',1),
      gadget: object('java.render.Vector', { elements: jv('Object[]',[button]) }) });
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',group,[]);
    jvm.natives.invoke('java.util.resource.PhysicsRef','createBox',phy,[jv('ResourceRef',group.value),jv('float',1),jv('float',1),jv('float',0.01),jv('String','drop')]);
    return {phy,button,group};
  };
  try {
    const target = hotspot(1), inventory = hotspot(1), closed = hotspot(0);
    assert.equal(await bridge.dropOn(target.phy,{object:object('java.render.GameRef')}),true);
    assert.equal(jvm.get(osd,'objectDrops').value,1);
    assert.equal(await bridge.dropOn(target.phy,{physics:inventory.phy}),true);
    assert.equal(jvm.get(osd,'gadgetDrops').value,1);
    assert.equal(jvm.get(osd,'dropObject').value,null);
    assert.equal(jvm.get(osd,'dropGadget').value,null);
    assert.equal(await bridge.dropOn(closed.phy,{physics:inventory.phy}),false);
    assert.equal(await bridge.dropOn(target.phy,{physics:target.phy}),false);
    jvm.set(target.button,'disabled',jv('int',1));
    assert.equal(await bridge.dropOn(target.phy,{physics:inventory.phy}),false);
    jvm.set(target.button,'disabled',jv('int',0)); jvm.set(target.group,'active',jv('int',0));
    assert.equal(await bridge.dropOn(target.phy,{physics:inventory.phy}),false);
    assert.equal(jvm.get(osd,'gadgetDrops').value,1);
  } finally { bridge.dispose(); resources.dispose(); }
});
