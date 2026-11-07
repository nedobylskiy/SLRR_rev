import test from 'node:test';
import assert from 'node:assert/strict';
import {CpuWorkProfile} from '../src/runtime/cpu-work-profile';

test('CPU work capture is opt-in, drains once and accounts throwing synchronous work',()=>{
  const p=new CpuWorkProfile();p.add('ignored_count');p.measure('ignored_ms',()=>42);assert.deepEqual(p.drain(),{});
  p.setEnabled(true);p.add('calls_count',3);assert.throws(()=>p.measure('throw_ms',()=>{throw Error('test');}));
  const row=p.drain();assert.equal(row.calls_count,3);assert.ok(Number.isFinite(row.throw_ms)&&row.throw_ms>=0);assert.deepEqual(p.drain(),{});
  p.add('stale_count');p.setEnabled(false);p.setEnabled(true);assert.deepEqual(p.drain(),{});
});
