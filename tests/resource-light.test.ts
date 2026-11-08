import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AmbientLight, DirectionalLight, Group, Vector3 } from 'three';
import { createResourceLight, parseResourceLight } from '../src/render/resource-light';
import type { RpkEntry } from '../src/formats/rpk';
import { Assets } from '../src/assets';
import { trafficSignalGlowTexture } from '../src/render/traffic-signals';

function entry(text: string, type = 13): RpkEntry {
  return { superId: 0x1000b, typeId: 0x1d, type, flags: 0, compatibility: 1, offset: 0, size: text.length,
    alias: 'garage', data: new TextEncoder().encode(text) };
}

test('traffic signal CFG light resolves a type-14 billboard and its texture in the dependency pack',async()=>{
  const assets=new Assets([],async()=>new Uint8Array());
  const requests:{pack:string;id:number}[]=[];
  assets.resource=async(pack,id)=>{
    requests.push({pack,id});
    if(pack==='objects.rpk'&&id===0x30006)return {packPath:'particles.rpk',entry:entry('mesh 0x5\ntexture 0x4',14)};
    if(pack==='particles.rpk'&&id===4)return {packPath:'particles.rpk',entry:entry('sourcefile particles/textures/Flare.ptx',7)};
    throw Error('Unexpected glow resource lookup');
  };
  assert.equal(await trafficSignalGlowTexture(assets),'particles/textures/Flare.ptx');
  assert.deepEqual(requests,[{pack:'objects.rpk',id:0x30006},{pack:'particles.rpk',id:4}]);
});
test('RPK garage directional lights use RGB, metre poses and the original direction instead of loading a mesh', () => {
  const definition = parseResourceLight(entry(`type directional
diffuse 1.000 0.919 0.958 1.000
specular 0.000 0.500 0.500 0.500
ambient 0.000 0.347 0.347 0.347
position 0.000 3.000 0.000
direction 0.000 -1.000 0.000
range 5000.000
attenuation 0.000 0.000 0.000`))!;
  const group = createResourceLight(definition);
  const light = group.children.find(child => child instanceof DirectionalLight) as DirectionalLight;
  const ambient = group.children.find(child => child instanceof AmbientLight) as AmbientLight;
  assert.deepEqual(light.position.toArray(), [0, 3, 0]);
  assert.deepEqual(light.target.position.toArray(), [0, 2, 0]);
  assert.deepEqual(light.color.toArray(), [0.919, 0.958, 1]);
  assert.deepEqual(ambient.color.toArray(), [0.347, 0.347, 0.347], 'ambient alpha zero must not black out its RGB');
  assert.deepEqual(light.userData.specularColor, [0, 0.5, 0.5, 0.5]);
  const parent = new Group(); parent.position.set(20, 4, -10); parent.rotation.z = Math.PI / 2; parent.add(group); parent.updateMatrixWorld(true);
  assert.ok(light.getWorldPosition(new Vector3()).distanceTo(new Vector3(17, 4, -10)) < 1e-10);
  const direction = light.target.getWorldPosition(new Vector3()).sub(light.getWorldPosition(new Vector3())).normalize();
  assert.ok(direction.distanceTo(new Vector3(1, 0, 0)) < 1e-10, 'light and target inherit the Java transform together');
  assert.equal(group.children.some(child => child.type === 'Mesh'), false);
});

test('resource lights are classified by RPK type, not the neon alias; invalid definitions fail explicitly', () => {
  assert.equal(parseResourceLight(entry('type directional', 14)), null);
  assert.throws(() => parseResourceLight(entry('type point')), /Unsupported RPK light type/);
  assert.throws(() => parseResourceLight(entry('type directional\ndirection 0 0 0')), /direction is zero/);
  assert.throws(() => parseResourceLight(entry('type directional\ndiffuse 1 NaN 0 1')), /Invalid RPK light diffuse/);
  assert.throws(() => parseResourceLight(entry('type directional\nposition 0 1')), /Invalid RPK light position/);
});
