import test from 'node:test';
import assert from 'node:assert/strict';
import {VehiclePhysicsWorld} from '../src/engine/vehicle-physics-world';
import {VehiclePhysicsClient} from '../src/engine/vehicle-physics-client';

test('external contacts run on every shared physics tick, not once per rendered frame',()=>{
  const world=new VehiclePhysicsWorld(120);let ticks=0;world.onTick=()=>ticks++;
  world.advance(1/30);assert.equal(ticks,4,'a 33 ms frame at 120 Hz tests contacts four times');
  world.advance(1/240);assert.equal(ticks,4,'no tick, no test');
  world.advance(1/240);assert.equal(ticks,5);
});

test('the main-thread client reports per-tick contacts only once a world and a handler exist',()=>{
  const client=new VehiclePhysicsClient();
  assert.equal(client.runsTickContacts,false);
  client.setTickContacts(()=>{});
  assert.equal(client.runsTickContacts,false,'no world before the first car registers');
  client.setTickContacts(undefined);client.dispose();
});
