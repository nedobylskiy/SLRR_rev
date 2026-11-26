import test from 'node:test';
import assert from 'node:assert/strict';
import {mapRenderDaypart} from '../src/engine/map-objects';

test('a CFG day/night render pair is recognised by flags 68 and 4 together',()=>{
  const house=[{flags:68},{flags:4}];
  assert.equal(mapRenderDaypart(house,house[0]),'day');assert.equal(mapRenderDaypart(house,house[1]),'night');
  const lamp=[{flags:4},{}];
  assert.equal(mapRenderDaypart(lamp,lamp[0]),undefined,'flag 4 alone is not a night variant');
  const withPiece=[{flags:68},{flags:4},{}];
  assert.equal(mapRenderDaypart(withPiece,withPiece[2]),undefined,'unflagged pieces always draw');
});
