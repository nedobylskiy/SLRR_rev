import test from 'node:test';
import assert from 'node:assert/strict';
import {GlActivity} from '../src/render/gl-activity';

test('GL activity observes resource calls without adding GL calls and restores original methods',context=>{
  let now=0,calls=0,waits=0;context.mock.method(performance,'now',()=>now);
  const gl={bufferData(){assert.equal(this,gl);calls++;now+=5;return 17;},finish(){waits++;}};
  const original=gl.bufferData,probe=new GlActivity(gl as any);probe.setEnabled(true);
  assert.equal(gl.bufferData(),17);assert.equal(calls,1);assert.equal(waits,0);
  assert.match(probe.lines().join('\n'),/bufferData: 1 calls · total 5.0 ms · max 5.0/);
  probe.dispose();assert.equal(gl.bufferData,original);gl.bufferData();assert.equal(calls,2);assert.equal(waits,0);
});
