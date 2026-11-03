import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assets } from '../src/assets';
import { PartFactory, type JavaInstalledPart, type JavaStockSelection, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { Viewer } from '../src/render/viewer';
import { Group } from 'three';

test('Java garage edits preserve unchanged parts and resolve only newly installed definitions', async () => {
  const definitions = [
    'slot 1 0 0 0 0 0 10\nslot -1 0 0 0 0 0 20',
    'slot 0 0 0 0 0 0 1\nslot 0 1 0 0 0 0 2',
    'slot 0 0 0 0 0 0 1',
    'slot 0 0 0 0 0 0 1',
  ].map((cfg, id): PartDefinition => ({ key: { pack: 'cars/test.rpk', id }, alias: `part${id}`,
    cfgPath: `${id}.cfg`, config: parsePartConfig(cfg) }));
  const reads: number[] = [];
  const factory = new PartFactory(new Assets([], async () => { throw new Error('Unexpected asset read'); }));
  factory.definition = async key => { reads.push(key.id); return definitions[key.id]; };
  const node = (id: number, slot: number, children: JavaInstalledPart[] = []): JavaInstalledPart => ({
    nativeId: 100 + id, key: definitions[id].key, parentSlot: slot, ownSlot: 1,
    positions: new Map(), wear: 1, children,
  });
  const door = node(1, 10, [node(2, 2)]), engine = node(3, 20);
  const selection = (installed: JavaInstalledPart[]): JavaStockSelection => ({
    nativeId: 100, installed, body: [], mechanical: [], tyres: [], wheelRefs: [],
  });
  const built = await factory.stock(definitions[0].key, { javaSelection: selection([door, engine]) });
  const originalRoot = built.root, originalEngine = built.root.children.get(20)!;
  const oldDoor = built.root.children.get(10)!, oldWindow = oldDoor.children.get(2)!;
  const initialReads = reads.length;
  await factory.syncJavaAssembly(built.root, selection([engine]));
  assert.equal(reads.length, initialReads, 'removal must not reload any definitions or meshes');
  assert.equal(built.root, originalRoot);
  assert.equal(built.root.children.get(20), originalEngine);
  assert.equal(built.world.parts.size, 2);
  assert.equal(built.world.parts.has(oldDoor.id), false);
  assert.equal(built.world.parts.has(oldWindow.id), false);
  assert.equal(built.world.disposed, false);
  await factory.syncJavaAssembly(built.root, selection([door, engine]));
  assert.deepEqual(reads.slice(initialReads), [1, 2], 'reinstall resolves only the new subtree');
  assert.equal(built.root.children.get(20), originalEngine);
  assert.equal(built.root.children.get(10)!.children.size, 1);
  assert.equal(built.world.parts.size, 4);
  const currentDoor = built.root.children.get(10)!;
  const adjusted = selection([door, engine]);
  adjusted.rootPositions = new Map([[10, { position: [2, 0, 0] }]]);
  await factory.syncJavaAssembly(built.root, adjusted);
  assert.equal(built.root.children.get(10), currentDoor);
  assert.equal(currentDoor.local.elements[12], 2);
  assert.equal(reads.length, initialReads + 2);
  built.world.dispose();
});

test('viewer drops only removed proxies and does not reload meshes already on screen', async () => {
  const factory = new PartFactory(new Assets([], async () => { throw new Error('Existing meshes must not be read again'); }));
  factory.definition = async key => ({ key, alias: 'test', cfgPath: 'test.cfg', config: parsePartConfig(''),
    model: { path: 'already-loaded.scx', textures: [] } });
  const built = await factory.stock({ pack: 'cars/test.rpk', id: 1 });
  const removed = built.world.create(built.root.definition);
  const keptGroup = new Group(), removedGroup = new Group(), scene = new Group();
  scene.add(keptGroup, removedGroup);
  const proxies = new Map([[built.root, keptGroup], [removed, removedGroup]]), collisions = new Map([[removed, {}]]);
  const disposed: Group[] = [];
  const viewer = { generation: 0, proxies, collisionMeshes: collisions, disposeGroup: (group: Group) => disposed.push(group) } as unknown as Viewer;
  Object.setPrototypeOf(viewer, Viewer.prototype);
  built.world.parts.delete(removed.id);
  Viewer.prototype.syncWorldVisuals.call(viewer, built.world);
  assert.deepEqual(disposed, [removedGroup]);
  assert.equal(keptGroup.parent, scene);
  assert.equal(removedGroup.parent, null);
  assert.equal(proxies.get(built.root), keptGroup);
  assert.equal(collisions.has(removed), false);
  built.root.renderVisible = false;
  Viewer.prototype.syncWorldVisuals.call(viewer, built.world);
  assert.equal(keptGroup.visible, false, 'filtered parts also leave the raycast candidate set');
  await Viewer.prototype.showWorld.call(viewer, built.world, factory.assets, true, true);
  assert.equal(proxies.get(built.root), keptGroup);
  assert.equal(keptGroup.visible, false, 'publishing new meshes must preserve Java visibility filters');
});
