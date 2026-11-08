import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { OsdTextNative } from '../src/runtime/osd-text-native';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { RenderRefNative } from '../src/runtime/render-ref-native';
import type { OsdAlign, OsdElement } from '../src/osd/osd-layer';

test('Java page changes destroy old Text HTML through renderinst.destroy without reviving it', async () => {
  const resourceSource = `package java.util.resource;
    class ResourceRef { ResourceRef() { newNative(); } native void newNative(); native int id(); native void destroy(); }
    class RenderRef extends ResourceRef { RenderRef() { super(); } }`;
  const textSource = `package java.render;
    import java.util.resource.*;
    class Text {
      RenderRef renderinst = new RenderRef(); String text;
      Text(String value) { create(null, new ResourceRef(), 0, 0); changeText(value); }
      native void create(ResourceRef group, ResourceRef font, float x, float y); native void update();
      void changeText(String value) { text = value; update(); }
      void finalize() { renderinst.destroy(); }
    }
    class Page {
      Text[] lines;
      void change(String a, String b) {
        if (lines != null) for (int i = 0; i < lines.length; i++) lines[i].finalize();
        lines = new Text[2]; lines[0] = new Text(a); lines[1] = new Text(b);
      }
      void clear() { for (int i = 0; i < lines.length; i++) lines[i].finalize(); }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => ['java.render.Text', 'java.render.Page'].includes(className)
    ? { path: 'Text.java', source: textSource } : ['java.util.resource.ResourceRef', 'java.util.resource.RenderRef'].includes(className)
    ? { path: 'ResourceRef.java', source: resourceSource } : null });
  const resources = new GameTypeNative(jvm, () => {});
  const live = new Set<{ text: string }>();
  let removals = 0;
  const bridge = new OsdTextNative(jvm, { createText(): OsdElement {
    const line = { text: '' }; live.add(line);
    return { node: { style: {}, remove() { live.delete(line); removals++; } } as unknown as HTMLElement,
      setText(text) { line.text = text; }, setResource() {}, setBounds() {},
      show() { assert.ok(live.has(line), 'destroyed text must not be shown by the visibility ticker'); }, hide() {} };
  } });
  resources.addResourceDestroyListener(ref => bridge.removeRender(ref));
  await jvm.loadClass('java.render.Page');
  const page = await jvm.constructAsync('java.render.Page', []);
  for (let index = 0; index < 4; index++) {
    await jvm.invokeAsync(page, 'change', [jv('String', `Seat ${index}`), jv('String', `$${index}`)]);
    bridge.syncVisibility();
    assert.deepEqual([...live].map(line => line.text), [`Seat ${index}`, `$${index}`]);
  }
  await jvm.invokeAsync(page, 'clear'); bridge.syncVisibility();
  assert.equal(live.size, 0); assert.equal(removals, 8);
  const destroyed = (jvm.get(page, 'lines').value as unknown[])[0];
  jvm.natives.invoke('java.render.Text', 'update', jv('Text', destroyed), []);
  jvm.natives.invoke('java.render.Text', 'changeColor', jv('Text', destroyed), [jv('int', -1)]);
  assert.equal(live.size, 0, 'late unfocus/animation calls must be harmless after the glyph is destroyed');
  bridge.dispose(); assert.equal(removals, 8, 'disposed lines have already left the live element set');
});

test('interpreted Java Text updates an OSD element through its native calls', async () => {
  const source = `package java.render;
    class Text {
      String text;
      Text() { create(null, null, 0.25, -0.5); changeText("LOADING..."); }
      native void create(ResourceRef group, ResourceRef font, float x, float y);
      native void update();
      native void changeAlign(int align);
      native void setPos(float x, float y);
      void changeText(String value) { text = value; update(); }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.render.Text'
    ? { path: 'Text.java', source } : null });
  const record = { text: '', align: 'left' as OsdAlign, x: 0, y: 0, removed: false };
  const node = { classList: { remove() {}, add(value: string) { record.align = value.slice(10) as OsdAlign; } },
    style: {}, remove() { record.removed = true; } } as unknown as HTMLElement;
  const surface = { createText(value: string, align: OsdAlign, x: number, y: number): OsdElement {
    Object.assign(record, { text: value, align, x, y });
    return { node, setText: value => { record.text = value; }, setResource() {},
      setBounds: (nextX, nextY) => { record.x = nextX; record.y = nextY; }, show() {}, hide() {} };
  } };
  const bridge = new OsdTextNative(jvm, surface);
  await jvm.loadClass('java.render.Text');
  const instance = await jvm.constructAsync('java.render.Text', []);
  assert.deepEqual([record.text, record.x, record.y], ['LOADING...', 0.25, -0.5]);
  await jvm.invokeAsync(instance, 'changeText', [jv('String', 'READY')]);
  await jvm.invokeAsync(instance, 'changeAlign', [jv('int', 1)]);
  await jvm.invokeAsync(instance, 'setPos', [jv('float', -0.3), jv('float', 0.4)]);
  assert.deepEqual([record.text, record.align, record.x, record.y], ['READY', 'center', -0.3, 0.4]);
  bridge.dispose();
  assert.equal(record.removed, true);
});

test('the original fade font glyph is not rendered as a literal letter', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  jvm.natives.register('java.util.resource.ResourceRef', 'id', [], () => jv('int', 0x1a25));
  let displayed = 'unset';
  const surface = { createText(): OsdElement {
    return { node: { style: {} } as HTMLElement, setText(value) { displayed = value; },
      setResource() {}, setBounds() {}, show() {}, hide() {} };
  } };
  new OsdTextNative(jvm, surface);
  const text = jv('Text', { className: 'java.render.Text', fields: new Map([['text', jv('String', 'a')]]) });
  const font = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  jvm.natives.invoke('java.render.Text', 'create', text,
    [jv('ResourceRef', null), font, jv('float', 0), jv('float', 0.7)]);
  jvm.natives.invoke('java.render.Text', 'update', text, []);
  assert.equal(displayed, '');
});

test('Text.getWidthPixels returns a font-sized width for TextBox wrapping', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  jvm.natives.register('java.util.resource.ResourceRef', 'id', [], () => jv('int', 0x20));
  new OsdTextNative(jvm);
  const font = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  const width = (value: string | null) => Number(jvm.natives.invoke('java.render.Text', 'getWidthPixels',
    jv('class', 'java.render.Text'), [jv('String', value), font])?.value);
  assert.equal(width(null), 0);
  assert.equal(width(''), 0);
  assert.ok(width('Credits') > width('Credit'));
  assert.ok(width('Credits') > 40);
});

test('Text.renderinst.setMatrix moves the HTML glyph used by CreditsDialog', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  let position = { x: 0, y: 0 };
  const surface = { createText(): OsdElement {
    return { node: { style: {} } as HTMLElement, setText() {}, setResource() {},
      setBounds(x, y) { position = { x, y }; }, show() {}, hide() {} };
  } };
  const textNative = new OsdTextNative(jvm, surface);
  new RenderRefNative(jvm, resources, (receiver, matrix) => textNative.setRenderMatrix(receiver, matrix));
  const renderinst = jv('RenderRef', { className: 'java.util.resource.RenderRef', fields: new Map() });
  const text = jv('Text', { className: 'java.render.Text', fields: new Map([['renderinst', renderinst]]) });
  const font = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', font, []);
  jvm.natives.invoke('java.render.Text', 'create', text,
    [jv('ResourceRef', null), font, jv('float', 0), jv('float', 0)]);
  const next = jv('Vector3', { className: 'java.lang.Vector3', fields: new Map([
    ['x', jv('float', -0.2)], ['y', jv('float', 0.7)], ['z', jv('float', 0)],
  ]) });
  jvm.natives.invoke('java.util.resource.RenderRef', 'setMatrix', renderinst, [next, jv('Ypr', null)]);
  assert.deepEqual(position, { x: -0.2, y: 0.7 });
  const reported = jvm.natives.invoke('java.render.Text', 'getPos', text, []);
  assert.equal(reported && jvm.get(reported, 'x').value, -0.2);
  assert.equal(reported && jvm.get(reported, 'y').value, 0.7);
});

test('only Osd.dark turns a fade glyph into a full-screen dimmer', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  jvm.natives.register('java.util.resource.ResourceRef', 'id', [], () => jv('int', 0x1a25));
  const classes = new Set<string>();
  const surface = { createText(): OsdElement {
    return { node: { style: {}, classList: { add(name: string) { classes.add(name); } } } as unknown as HTMLElement,
      setText() {}, setResource() {}, setBounds() {}, show() {}, hide() {} };
  } };
  new OsdTextNative(jvm, surface);
  const text = jv('Text', { className: 'java.render.Text', fields: new Map() });
  const osd = jv('Osd', { className: 'java.render.Osd', fields: new Map() });
  const group = jv('Group', { className: 'java.render.Group', fields: new Map([['osd', osd]]) });
  const font = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  jvm.natives.invoke('java.render.Text', 'create', text,
    [jv('ResourceRef', group.value), font, jv('float', 0), jv('float', 0)]);
  jvm.natives.invoke('java.render.Text', 'changeColor', text, [jv('int', -1)]);
  assert.equal(classes.has('osd-fade-overlay'), false);
  (osd.value as { fields: Map<string, unknown> }).fields.set('dark', text);
  jvm.natives.invoke('java.render.Text', 'changeColor', text, [jv('int', 0x0f000000)]);
  assert.equal(classes.has('osd-fade-overlay'), true);
});

test('hiding a Java OSD also hides its text and dark overlay', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  jvm.natives.register('java.util.resource.ResourceRef', 'id', [], () => jv('int', 0x1a25));
  let shown = false;
  const surface = { createText(): OsdElement {
    return { node: { style: {}, classList: { add() {} } } as unknown as HTMLElement,
      setText() {}, setResource() {}, setBounds() {}, show() { shown = true; }, hide() { shown = false; } };
  } };
  const bridge = new OsdTextNative(jvm, surface);
  const text = jv('Text', { className: 'java.render.Text', fields: new Map() });
  const osd = jv('Osd', { className: 'java.render.Osd', fields: new Map([['cam', jv('Camera', {})]]) });
  const group = jv('ResourceRef', { className: 'java.render.Group', fields: new Map([
    ['osd', osd], ['active', jv('int', 1)],
  ]) });
  const font = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  jvm.natives.invoke('java.render.Text', 'create', text,
    [group, font, jv('float', 0), jv('float', 0)]);
  (osd.value as { fields: Map<string, unknown> }).fields.set('dark', text);
  jvm.natives.invoke('java.render.Text', 'changeColor', text, [jv('int', 0x7f000000)]);
  bridge.syncVisibility();
  assert.equal(shown, true);
  (osd.value as { fields: Map<string, unknown> }).fields.set('cam', jv('Camera', null));
  bridge.syncVisibility();
  assert.equal(shown, false);
});


test('Java TextBox width normalization matches CSS pixels independently of configured resolution and viewport width',async()=>{
  const sources:Record<string,string>={
    'java.util.Config':'package java.util; class Config { static int video_x=800; }',
    'java.render.Text':`package java.render; import java.util.*;
      class Text { public static native float getWidthPixels(String text,ResourceRef font);
        public static float getWidth(String text,ResourceRef font,Viewport viewport){return 2*getWidthPixels(text,font)/(Config.video_x*viewport.getWidth());}
      }`,
    'java.render.Viewport':'package java.render; class Viewport { native float getWidth(); }',
  };
  const jvm=new SlrrJvm({resolveImport:({className})=>sources[className]?{path:className+'.java',source:sources[className]}:null});
  jvm.natives.register('java.util.resource.ResourceRef','id',[],()=>jv('int',0x20));
  let viewportWidth=.75;let stage={width:1440,height:810};
  jvm.natives.register('java.render.Viewport','getWidth',[],()=>jv('float',viewportWidth));
  new OsdTextNative(jvm,undefined,undefined,()=>stage);
  await jvm.loadClass('java.render.Text');await jvm.loadClass('java.util.Config');
  const font=jv('ResourceRef',{className:'java.util.resource.ResourceRef',fields:new Map()}),viewport=jv('Viewport',{className:'java.render.Viewport',fields:new Map()});
  const baseline=new SlrrJvm({resolveImport:()=>null});baseline.natives.register('java.util.resource.ResourceRef','id',[],()=>jv('int',0x20));new OsdTextNative(baseline);
  for(const configured of [800,1920])for(const stageWidth of [1024,1440])for(const fraction of [.75,1]){
    jvm.set(jv('class','java.util.Config'),'video_x',jv('int',configured));stage={width:stageWidth,height:stageWidth*9/16};viewportWidth=fraction;
    for(const text of ['garage.','Drop parts here from the Parts Bin to repair them!']){
      const pixels=Number(baseline.natives.invoke('java.render.Text','getWidthPixels',jv('class','java.render.Text'),[jv('String',text),font])!.value);
      const width=Number((await jvm.invokeAsync(jv('class','java.render.Text'),'getWidth',[jv('String',text),font,viewport])).value);
      // TextBox centers a left-anchored line by subtracting half this normalized width.
      const left=(1-width/2)*stageWidth*fraction/2;
      assert.ok(Math.abs(left+pixels/2-stageWidth*fraction/2)<1e-3,'long and short lines share the same physical midpoint');
    }
  }
});


test('TextBox line spacing and font height use physical OSD stage pixels, including sub-viewports',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null});let stage={width:1440,height:810},fraction=.7;
  jvm.natives.register('java.util.resource.ResourceRef','id',[],()=>jv('int',0x139));
  jvm.natives.register('java.render.Viewport','getHeight',[],()=>jv('float',fraction));
  jvm.natives.register('java.render.Viewport','getWidth',[],()=>jv('float',fraction));
  new OsdTextNative(jvm,undefined,undefined,()=>stage);
  const font=jv('ResourceRef',{className:'java.util.resource.ResourceRef',fields:new Map()}),viewport=jv('Viewport',{className:'java.render.Viewport',fields:new Map()});
  const metric=(name:string)=>Number(jvm.natives.invoke('java.render.Text',name,jv('class','java.render.Text'),[font,viewport])!.value);
  for(const height of [600,810,1080])for(const region of [.5,.7,1]){
    stage={width:height*16/9,height};fraction=region;
    assert.ok(Math.abs(metric('getLineSpacing')*height*region/2-18.75)<1e-6,'15px font advances 18.75px per line at every screen height');
    assert.ok(Math.abs(metric('getHeight')*height*region/2-15)<1e-6);
    assert.ok(Math.abs(metric('getCharWidth')*stage.width*region/2-15)<1e-6);
  }
});
