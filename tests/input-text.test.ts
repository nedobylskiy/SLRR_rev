import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';
import { InputNative } from '../src/runtime/input-native';
import { ControllerNative } from '../src/runtime/controller-native';
import { GameTypeNative } from '../src/runtime/game-type-native';

test('cheat check uses flushed key history, encoded Java codes and consumes matches', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const events = new GameTypeNative(jvm, () => {});
  const controllers = new ControllerNative(jvm, () => 0);
  const input = new InputNative(jvm, controllers, events);
  const codes = jv('String[]', ['begformoney', 'testme'].map(text => jv('String',
    [...text].map(c => String.fromCharCode(c.charCodeAt(0) + 1)).join(''))));
  const check = () => jvm.natives.invoke('java.game.GameLogic', 'kismajomCheck', jv('class', 'java.game.GameLogic'), [codes])!.value;
  const type = (text: string) => { for (const c of text) {
    input.setKeyboardCode(`Key${c.toUpperCase()}`, true, c.charCodeAt(0));
    input.setKeyboardCode(`Key${c.toUpperCase()}`, false);
    jvm.natives.invoke('java.io.Input', 'lastKey', jv('class', 'java.io.Input'), []);
  } };
  assert.equal(check(), -1);
  type('xxxxxxxxxxxxxxxxxxxxxxxxbegformoney');
  assert.equal(check(), 0); assert.equal(check(), -1);
  type('testme'); assert.equal(check(), 1);
  type('wrong'); assert.equal(check(), -1);
  events.dispose();
});

test('Input.lastKey carries physical scans and typed UTF-16 characters without duplicating presses', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const events = new GameTypeNative(jvm, () => {});
  let input!: InputNative;
  const controllers = new ControllerNative(jvm, (device, axis) => input.physicalAxis(device, axis));
  input = new InputNative(jvm, controllers, events);
  const key = () => Number(jvm.natives.invoke('java.io.Input', 'lastKey', jv('class', 'java.io.Input'), [])!.value);
  input.setKeyboardCode('KeyA', true, 'A'.charCodeAt(0));
  let packed = key(); assert.equal(packed & 0xffff, 30); assert.equal(packed >> 16, 65);
  assert.equal(key(), 0); assert.equal(input.physicalAxis(0, 30), 1);
  input.setKeyboardCode('KeyA', true, 'a'.charCodeAt(0), true);
  assert.equal(key() >> 16, 97, 'OS key repeat reaches the Java editor');
  input.setKeyboardCode('KeyA', false); assert.equal(key(), 0); assert.equal(input.physicalAxis(0, 30), 0);
  for (const [code, character] of [['Backspace', 8], ['Enter', 13], ['Escape', 27], ['KeyD', 0x416]] as const) {
    input.setKeyboardCode(code, true, character); assert.equal(key() >> 16, character); input.setKeyboardCode(code, false);
  }
  input.setKeyboardCode('Slash', true, 47); assert.equal(key() >> 16, 47, 'text works even for unmapped physical keys');
  input.setKeyboardCode('ArrowUp', true); assert.equal(key(), 200, 'non-text physical input retains its scan');
  events.dispose();
});
