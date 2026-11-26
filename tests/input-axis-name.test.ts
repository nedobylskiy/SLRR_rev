import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ControllerNative } from '../src/runtime/controller-native';
import { InputNative, inputAxisName } from '../src/runtime/input-native';

test('Input.axisName labels ControlSet bindings: DIK keys and mouse axes/buttons', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }), events = new GameTypeNative(jvm, () => {});
  new InputNative(jvm, new ControllerNative(jvm, () => 0), events);
  const name = (device: number, axis: number) =>
    jvm.natives.invoke('java.io.Input', 'axisName', jv('class', 'java.io.Input'), [jv('int', device), jv('int', axis)])!.value;
  // ControlSet.defaults: RCDIK_UP/DOWN/LEFT/RIGHT, SPACE, A, Z, C, N, H, F12, ESCAPE, PGUP, NUMPADENTER.
  assert.deepEqual([200, 208, 203, 205, 57, 30, 44, 46, 49, 35, 88, 1, 201, 156].map(axis => name(0, axis)),
    ['Up', 'Down', 'Left', 'Right', 'Space', 'A', 'Z', 'C', 'N', 'H', 'F12', 'Esc', 'Page Up', 'Num Enter']);
  assert.deepEqual([0, 1, 2, 3, 4].map(axis => name(1, axis)), ['Mouse X', 'Mouse Y', 'Mouse Wheel', 'Mouse Button 1', 'Mouse Button 2']);
  assert.equal(inputAxisName(0, 250), 'Key 250');
  assert.equal(inputAxisName(3, 2), 'Device 3 Axis 2');
  events.dispose();
});

test('Input.activeAxis reports the pressed key or mouse button for OptionsDialog redefinition', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }), events = new GameTypeNative(jvm, () => {});
  const input = new InputNative(jvm, new ControllerNative(jvm, () => 0), events);
  const active = (device: number) =>
    jvm.natives.invoke('java.io.Input', 'activeAxis', jv('class', 'java.io.Input'), [jv('int', device)])!.value;
  assert.equal(active(0), -1); assert.equal(active(1), -1);
  input.setKeyboardCode('KeyN', true);
  assert.equal(active(0), 49, 'N is DIK 49');
  input.setKeyboardCode('KeyN', false);
  assert.equal(active(0), -1, 'released keys are not active');
  input.setPhysicalAxis(1, 0, 0.9); input.setPhysicalAxis(1, 2, -1);
  assert.equal(active(1), -1, 'cursor position and wheel samples are not a press');
  input.setPhysicalAxis(1, 3, 1);
  assert.equal(active(1), 3);
  events.dispose();
});
