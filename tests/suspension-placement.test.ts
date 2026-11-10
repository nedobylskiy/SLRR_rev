import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { EngineWorld, PartFactory, type JavaStockSelection } from '../src/engine/world';
import { Assets } from '../src/assets';
import { linkedSlotFrame } from '../src/engine/linked-slots';
import { suspensionDebugMatrix, defaultSuspensionDebug } from '../src/render/suspension-debug';
import { parsePartConfig } from '../src/formats/cfg';
import { RigidBody3D } from '../src/engine/rigid-body-3d';
import { Suspension3D, TestTerrain } from '../src/engine/suspension-3d';

test('suspension placement shifts installation and physical wheel hardpoints together without changing CFG', () => {
  const world = new EngineWorld();
  const cfg = parsePartConfig([0, 1, 2, 3].map(i => `type 10 sphere 0.3\nwheel ${i % 2 ? 0.7 : -0.7} -0.6 ${i < 2 ? -1.3 : 1.3} 0 0 0 0 0 1 0\nslot 0 0 0 0 0 0 ${101 + i}\nslottype ${101 + i}`).join('\n') + '\nslot 0 0 0 0 0 0 123\nslottype 203\nslot 0 0 0 0 0 0 303\nslottype 303');
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'car', cfgPath: '', config: cfg });
  root.wheelFrameOffsetY = 0.165;
  for (const id of [101, 102, 103, 104, 123, 303]) {
    const part = world.create({ key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: '', config: parsePartConfig('slot 0 0 0 0 0 0 1') });
    world.install(root, id, part, 1);
    assert.ok(Math.abs(part.local.elements[13] + 0.435) < 1e-10);
    world.refreshAttachment(part);
    assert.ok(Math.abs(part.local.elements[13] + 0.435) < 1e-10, 'refresh must not add the offset twice');
  }
  const body = new RigidBody3D(1000, new Box3(new Vector3(-1, -0.5, -2), new Vector3(1, 0.5, 2)));
  const suspension = new Suspension3D(root, body, new TestTerrain());
  for (const wheel of suspension.wheels) {
    assert.ok(Math.abs(wheel.center.y + 0.435) < 1e-10);
    assert.ok(Math.abs(wheel.hardpoint.y - (wheel.center.y + wheel.rest)) < 1e-10);
  }
  assert.equal(cfg.wheels[0].position[1], -0.6, 'original configuration remains unchanged');
});

test('global corner calibration applies once to loaded assemblies, physical carriers and linked anchors on different chassis', async () => {
  const corrections = [0.055,-0.055,-0.075,0.075];
  for (const width of [0.7,0.85]) {
    const cfg = parsePartConfig([0,1,2,3].map(i =>
      `type 10 sphere 0.3\nwheel ${i%2 ? width : -width} -0.6 ${i<2 ? -1.3 : 1.3} 0 0 0 1 1 1 0\n`
      + [101,201,301].map((type,group) => `slot 0 0 0 0 0 0 ${1001+i+group*100}\nslottype ${type+i}`).join('\n')).join('\n'));
    const original = JSON.stringify(cfg);
    const assets = new Assets([],async () => { throw new Error('No asset reads expected'); });
    const factory = new PartFactory(assets);
    factory.definition = async key => ({key,alias:String(key.id),cfgPath:'',config:key.id===1?cfg:parsePartConfig('slot 0 0 0 0 0 0 1')});
    const selection: JavaStockSelection = {body:[],mechanical:[],tyres:[],wheelRefs:[],installed:cfg.slots.map((slot,i) => ({
      key:{pack:'test.rpk',id:i+2},parentSlot:slot.id,ownSlot:1,positions:new Map(),wear:1,children:[],
    }))};
    // A fresh build and a subsequent rebuild from the same saved selection use
    // the same defaults, without baking calibration into serialized CFG data.
    for (let rebuild=0;rebuild<2;rebuild++) {
      const {world,root} = await factory.stock({pack:'test.rpk',id:1},{javaSelection:selection});
      try {
        const body = new RigidBody3D(1000,new Box3(new Vector3(-1,-0.5,-2),new Vector3(1,0.5,2)));
        const suspension = new Suspension3D(root,body,new TestTerrain());
        for (let corner=0;corner<4;corner++) {
          const x = cfg.wheels[corner].position[0]+corrections[corner];
          assert.ok(Math.abs(suspension.wheels[corner].center.x-x)<1e-10);
          assert.ok(Math.abs(suspension.wheels[corner].hardpoint.x-x)<1e-10);
          assert.ok(Math.abs(suspension.wheels[corner].center.y+0.460)<1e-10,'base height includes the additional -0.025 m correction');
          assert.ok(Math.abs(root.wheelFrame(corner).elements[12]-x)<1e-10);
          for (const group of [0,1,2]) {
            const part = root.children.get(1001+corner+group*100)!;
            world.refreshAttachment(part);
            assert.ok(Math.abs(part.local.elements[12]-x)<1e-10);
            const link = linkedSlotFrame(part,1001)!;
            assert.ok(Math.abs(part.matrix().multiply(link).elements[12]-x)<1e-10);
            assert.deepEqual(suspensionDebugMatrix(part,defaultSuspensionDebug()).elements,part.matrix().elements,
              'zero sliders preserve calibrated geometry');
          }
        }
        assert.equal(JSON.stringify(cfg),original);
      } finally { world.dispose(); }
    }
    const audit = await factory.stock({pack:'test.rpk',id:1},{javaSelection:selection,suspensionMountOffsetY:0,suspensionMountOffsets:[]});
    assert.equal(audit.root.wheelFrame(0).elements[12],-width,'uncalibrated audits can disable all offsets');
    audit.world.dispose();
  }
});
