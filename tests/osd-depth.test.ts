import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv } from 'slrr-jvm';
import { osdDepth, osdViewport, osdViewportPriority, projectOsdBounds } from '../src/runtime/osd-depth';
import { osdHitDepth } from '../src/runtime/osd-button-native';
import type { ViewportNative } from '../src/runtime/viewport-native';

test('tooltip text uses the cursor-owned viewport and stays above its background',()=>{
  const viewport=jv('Viewport',{className:'java.render.Viewport',fields:new Map()});
  const cursor=jv('MouseCursor',{className:'java.io.MouseCursor',fields:new Map([['vp',viewport]])});
  const layout={priority:127,left:0,top:0,width:1,height:1};
  const viewports={get:(ref:typeof viewport)=>ref===viewport?layout:undefined} as unknown as ViewportNative;
  assert.deepEqual(osdViewport(cursor,viewports),layout);
  assert.ok(osdDepth(osdViewportPriority(cursor,viewports),2)>osdDepth(127,0));
});

test('a modal Java viewport sits above the menu and video while keeping its own control order', () => {
  const viewport = jv('Viewport', { className: 'java.render.Viewport', fields: new Map() });
  const osd = jv('Osd', { className: 'java.render.Osd', fields: new Map([['vp', viewport]]) });
  const group = jv('Group', { className: 'java.render.Group', fields: new Map([['osd', osd]]) });
  const viewports = { get: () => ({ priority: 24 }) } as unknown as ViewportNative;
  assert.equal(osdViewportPriority(group, viewports), 24);
  const dialogBackground = osdDepth(24, -2000);
  const dialogText = osdDepth(24, 2);
  const dialogButton = osdDepth(24, osdHitDepth(0, 0.4, 0.15));
  const menuTop = osdDepth(20, osdHitDepth(3, 0.11, 0.11));
  assert.ok(dialogBackground > menuTop);
  assert.ok(dialogText > dialogBackground);
  assert.ok(dialogButton > dialogBackground);
  assert.ok(osdDepth(20, -2000) > 0, 'video stays behind Java OSD surfaces');
});

test('dialog-local OSD bounds project into the Java viewport without stretching the stage', () => {
  const viewport = { priority: 24, left: 0.1, top: 0.233, width: 0.8, height: 0.534 };
  assert.deepEqual(projectOsdBounds(viewport, 0, 0, 2, 2),
    { x: 0, y: 0, width: 1.6, height: 1.068 });
  const button = projectOsdBounds(viewport, 0, 0.6);
  assert.ok(Math.abs(button.y - 0.3204) < 0.001);
});
