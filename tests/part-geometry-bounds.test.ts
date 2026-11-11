import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BoxGeometry,Group,Mesh,MeshBasicMaterial,Sprite,SpriteMaterial} from 'three';
import {partGeometryBounds} from '../src/render/part-geometry-bounds';

test('part bounds ignore flare sprites and nested lamp effects, but follow deformed vertices',()=>{
  const group=new Group(),mesh=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());group.add(mesh);
  const flare=new Sprite(new SpriteMaterial());flare.scale.setScalar(100);flare.position.set(30,30,30);group.add(flare);
  const effects=new Group();effects.add(new Mesh(new BoxGeometry(200,200,200)));group.add(effects);
  const bounds=partGeometryBounds(group,new Box3());assert.equal(bounds.max.x,1);assert.equal(bounds.min.x,-1);
  const position=mesh.geometry.getAttribute('position');position.setX(0,3);position.needsUpdate=true;
  partGeometryBounds(group,bounds);assert.equal(bounds.max.x,3);
});
