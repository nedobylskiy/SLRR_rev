import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm,jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';
import type { RpkPack } from '../src/formats/rpk';

test('catalog traversal preserves local entry IDs and pack arithmetic across remounted and child resources', async () => {
  const pack = (entries: [number,number,string][],dependencies: RpkPack['dependencies']=[]): RpkPack => ({
    version:512,warnings:[],dependencies,entries:entries.map(([typeId,superId,alias]) => ({
      typeId,superId,alias,type:8,flags:0,compatibility:1,offset:0,size:0,data:new Uint8Array(),
    })),
  });
  const catalog = new ResourceCatalog([
    ['parts.rpk',pack([[0xf229,0,'suspensions']])],
    ...['cars/a.rpk','cars/b.rpk'].map(path => [path,pack([[0x74,0x1f229,'car suspension'],[0x88,0x74,'strut']],
      [{id:0x10000,path:'parts.rpk',trailer:0}])] as const),
  ]);
  const jvm = new SlrrJvm({resolveImport:() => ({path:'ResourceRef.java',source:`package java.util.resource;
    class ResourceRef { ResourceRef(int id) { set(id); } native void set(int id); }`})});
  const resources = new GameTypeNative(jvm,()=>{},undefined,catalog);
  await jvm.loadClass('java.util.resource.ResourceRef');
  const ref = (path: string,id: number) => jvm.construct('java.util.resource.ResourceRef',[resources.remountSavedResource(path,id)]);
  const call = (name: string,receiver: ReturnType<typeof ref>) => jvm.natives.invoke('java.util.resource.ResourceRef',name,receiver,[])!;
  try {
    // Unrelated SDAT remounts must not change root F229 into an allocation counter.
    resources.remountSavedResource('other.rpk',3);
    const root = ref('parts.rpk',0xf229);
    const first = call('getFirstChild',root), second = call('getNextChild',first);
    assert.ok(first.value);assert.ok(second.value);assert.equal(call('getNextChild',second).value,null);
    const firstId = Number(call('id',first).value), secondId = Number(call('id',second).value);
    assert.equal(firstId&0xffff,0x74);assert.equal(secondId&0xffff,0x74);
    assert.notEqual(firstId>>16,secondId>>16,'different car packs cannot collapse into the same namespace');
    for (const child of [first,second]) {
      const leaf = call('getFirstChild',child), id = call('id',leaf);
      assert.equal(Number(id.value)&0xffff,0x88);
      assert.equal(Number(id.value)>>16,Number(call('id',child).value)>>16);
      assert.equal((id.resource?.id),0x88,'resource metadata retains a local identity');
      const node = resources.getResource(child)!;
      const chassis = jv('Chassis',{className:'java.game.parts.bodypart.Chassis',fields:new Map()});
      jvm.natives.invoke('java.lang.GameType','createNativeInstance',chassis,
        [jv('GameRef',null),resources.remountSavedResource(node.resourcePack!,6),jv('String',null),jv('String',null)]);
      const type = await jvm.natives.invokeAsync('java.util.resource.GameRef','getInfo',chassis,[jv('int',6),jv('int',0)]);
      assert.equal(Number(type!.value)>>16,Number(call('id',child).value)>>16,
        'Catalog currentCarPackId must match children belonging to that car');
    }
    assert.deepEqual(resources.resolveResourceIdentity(firstId),{pack:'cars/a.rpk',id:0x74});
  } finally { resources.dispose(); }
});
