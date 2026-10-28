import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import type { Assets } from '../src/assets';
import type { GameTypeNative } from '../src/runtime/game-type-native';
import { SfxRefNative } from '../src/runtime/sfx-ref-native';

test('SfxRef plays an RPK sound through the effects channel and returns a stoppable handle', async () => {
  const original = globalThis.AudioContext;
  let starts = 0, stops = 0, gainValue = 0;
  class FakeContext {
    destination = {};
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    createBufferSource() { return {
      buffer: null, playbackRate: { value: 1 }, loop: false, onended: null,
      connect() {}, disconnect() {}, start() { starts++; }, stop() { stops++; },
    }; }
    createGain() { return { gain: { get value() { return gainValue; }, set value(value: number) { gainValue = value; } },
      connect() {}, disconnect() {} }; }
  }
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  try {
    const source = new TextEncoder().encode('sourcefile frontend\\sounds\\mnuselect.wav');
    let requestedId = 0;
    const assets = {
      resource: async (_pack: string, id: number) => { requestedId = id; return { entry: { data: source } }; },
      read: async () => new Uint8Array([1, 2, 3]),
    } as unknown as Assets;
    const resources = { getResource: () => ({ resourcePack: 'frontend', resourceId: 0x1007a }) } as unknown as GameTypeNative;
    const jvm = new SlrrJvm({ resolveImport: () => null });
    const bridge = new SfxRefNative(jvm, assets, resources, () => 0.5);
    const receiver = jv('SfxRef', { className: 'java.util.resource.SfxRef', fields: new Map() });
    const handle = jvm.natives.invoke('java.util.resource.SfxRef', 'nplay', receiver,
      [jv('Object', null), jv('float', 0), jv('float', 1), jv('float', 1), jv('int', 0), jv('int', 0)])!;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(starts, 1);
    assert.equal(requestedId, 0x7a);
    assert.ok(gainValue > 0 && gainValue <= 0.5);
    jvm.natives.invoke('java.util.resource.SfxRef', 'stop', receiver, [handle]);
    assert.equal(stops, 1);
    bridge.dispose();
  } finally {
    globalThis.AudioContext = original;
  }
});
