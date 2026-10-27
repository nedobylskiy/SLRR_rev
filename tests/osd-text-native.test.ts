import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { OsdTextNative } from '../src/runtime/osd-text-native';
import type { OsdAlign, OsdElement } from '../src/osd/osd-layer';

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
