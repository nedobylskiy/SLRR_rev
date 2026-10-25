import { PartAssemblyRuntime, type AssemblyPart } from './part-assembly';
import { jv, type JavaValue } from 'slrr-jvm';

export const partSourcePaths = [
  'parts/scripts/src/Part.java', 'parts/scripts/src/BodyPart.java', 'parts/scripts/bodypart/Src/Chassis.java',
  'parts/scripts/src/RGearPart.java', 'parts/scripts/rgearpart/SRC/ReciprocatingRGearPart.java',
  'parts/scripts/rgearpart/reciprocatingrgearpart/SRC/Tyre.java', 'parts/scripts/rgearpart/SRC/ShockAbsorber.java'
];

/** Synthetic assembly definitions, real game source methods. No claim of loading a stock car CFG. */
export function createPartDemo(runtime: PartAssemblyRuntime) {
  runtime.registerDefinition({ resource: { pack: 'test/chassis.rpk', localId: 6 }, className: 'Chassis', slots: [101, 102, 103, 104, 201, 202, 203, 204, 300] });
  runtime.registerDefinition({ resource: { pack: 'test/tyres.rpk', localId: 17 }, className: 'Tyre', slots: [1], fields: { inflation: jv('float', 2.1) } });
  runtime.registerDefinition({ resource: { pack: 'test/shocks.rpk', localId: 7 }, className: 'ShockAbsorber', slots: [1], fields: { damping: jv('float', 500), rebound_factor: jv('float', 1), min_damping: jv('float', 100), max_damping: jv('float', 9000) } });
  runtime.registerDefinition({ resource: { pack: 'test/body.rpk', localId: 9 }, className: 'BodyPart', slots: [1] });
  const world = runtime.createWorld(), root = world.create({ pack: 'test/chassis.rpk', localId: 6 }); world.root = root;
  root.wear = Math.fround(0.83); root.tear = Math.fround(0.91); root.mileage = Math.fround(12345.5); root.wheelDamage = ['wheel0', null, '', 'wheel3']; root.setFloat('brake_balance', 0.67); root.setPose([1.125, -2.25, 3.5], [0.125, 0.25, -0.5]);
  root.texture = world.resources.transient(new Uint8Array([1, 2, 3, 4, 5]));
  for (let i = 0; i < 4; i++) {
    const tyre = world.create({ pack: 'test/tyres.rpk', localId: 17 }); tyre.setFloat('inflation', 1.8 + i * 0.2); tyre.wear = Math.fround(0.4 + i * 0.1); tyre.setPose([i * 0.125, 0, -1], [0, i * 0.25, 0]); world.attach(root, 101 + i, tyre, 1);
    const shock = world.create({ pack: 'test/shocks.rpk', localId: 7 }); shock.setFloat('damping', 1500 + i * 125); shock.setFloat('rebound_factor', 0.7 + i * 0.1); world.attach(root, 201 + i, shock, 1);
  }
  world.attach(root, 300, world.create({ pack: 'test/body.rpk', localId: 9 }), 1);
  root.slots[0].damage = 'slot0 damage'; root.slots[1].damage = '';
  return world;
}

/** Portable inspection view excludes runtime handles, parent pointers and update counters. */
export function describeAssembly(root: AssemblyPart): unknown {
  const field = (v: JavaValue): unknown => {
    if (v.value && typeof v.value === 'object' && 'fields' in v.value) return Object.fromEntries([...(v.value as { fields: Map<string, JavaValue> }).fields].map(([k, value]) => [k, field(value)]));
    return v.value;
  };
  const resource = (id: number) => {
    if (!id) return null;
    const r = root.world.resources.get(id); return 'pack' in r ? r : { kind: r.kind, bytes: [...r.bytes] };
  };
  return { type: root.definition.className, resource: root.definition.resource, texture: resource(root.texture), mesh: resource(root.mesh), wear: root.wear, tear: root.tear, mileage: root.mileage, wheelDamage: [...root.wheelDamage],
    fields: Object.fromEntries([...root.fields].map(([name, value]) => [name, field(value)])),
    slots: root.slots.map(slot => ({ id: slot.id, damage: slot.damage, childSlot: slot.childSlot, child: slot.child ? describeAssembly(slot.child) : null })) };
}
