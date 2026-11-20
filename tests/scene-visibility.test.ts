import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,Vector3,Box3} from 'three';
import {SceneVisibility} from '../src/render/scene-visibility';

test('primary camera excludes offscreen and distant objects from color AND shadows, preserving simulation state',()=>{
  const scene=new Group(),geometry=new BoxGeometry(2,2,2),material=new MeshBasicMaterial(),gate=new SceneVisibility();
  const camera=new PerspectiveCamera(60,1,.1,1000);camera.lookAt(0,0,-1);
  const object=(x:number,y:number,z:number)=>{const mesh=new Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;scene.add(mesh);return mesh;};
  const near=object(0,0,-10),behind=object(0,0,10),far=object(0,0,-200),above=object(0,40,-10),disabled=object(0,0,-5),baked=object(0,0,300);
  disabled.visible=false;
  const sources=[near,behind,far,above,disabled].map(object=>({object}));
  try{
    gate.apply(camera,100,sources);
    assert.equal(near.visible,true);for(const o of [behind,far,above,disabled])assert.equal(o.visible,false);
    const casters:Mesh[]=[];scene.traverseVisible(o=>{if(o instanceof Mesh&&o.castShadow)casters.push(o);});
    assert.deepEqual(casters,[near,baked],'hidden objects cannot reach a shadow pass, while baked exceptions are untouched');
    assert.equal(behind.parent,null,'offscreen objects are physically absent from the scene during every render pass');assert.deepEqual(behind.position.toArray(),[0,0,10]);
    gate.restore();assert.equal(behind.parent,scene);assert.equal(behind.visible,true);assert.equal(disabled.visible,false);
    camera.lookAt(0,-1,0);gate.apply(camera,100,sources);assert.equal(near.visible,false,'pitch participates in the full 3D frustum');gate.restore();
    camera.position.set(0,0,-190);camera.lookAt(0,0,-200);gate.apply(camera,30,sources);assert.equal(far.visible,true,'range follows the camera after it moves away from the player');assert.equal(near.visible,false);
  }finally{gate.restore();geometry.dispose();material.dispose();}
});

test('instance buffers changing while detached invalidate cached culling bounds',()=>{
  const scene=new Group(),geometry=new BoxGeometry(2,2,2),material=new MeshBasicMaterial(),gate=new SceneVisibility();
  const camera=new PerspectiveCamera(60,1,.1,1000);camera.lookAt(0,0,-1);
  const object=new InstancedMesh(geometry,material,2);scene.add(object);object.count=1;
  try{
    object.setMatrixAt(0,new Matrix4().makeTranslation(0,0,10));object.instanceMatrix.needsUpdate=true;
    gate.apply(camera,100,[{object}]);assert.equal(object.parent,null);gate.restore();
    object.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-10));object.instanceMatrix.needsUpdate=true;
    gate.apply(camera,100,[{object}]);assert.equal(object.parent,scene,'new visible placements must not inherit old offscreen bounds');gate.restore();
    object.count=0;gate.apply(camera,100,[{object}]);gate.restore();
  }finally{gate.restore();object.dispose();geometry.dispose();material.dispose();}
});

test('live physics bounds override stale world-space panel geometry and the auxiliary shadow reserve is excluded',()=>{
  const scene=new Group(),geometry=new BoxGeometry(2,2,2),material=new MeshBasicMaterial(),gate=new SceneVisibility();
  const camera=new PerspectiveCamera(60,1,.1,1000);camera.lookAt(0,0,-1);
  const car=new Group(),aux=new Mesh(geometry,material);car.add(new Mesh(geometry,material));scene.add(car,aux);
  const bounds=new Box3().setFromCenterAndSize(new Vector3(0,0,-20),new Vector3(2,2,4));
  try{
    gate.apply(camera,100,[{object:car,bounds},{object:aux,exclude:true}]);assert.equal(car.visible,true);assert.equal(aux.visible,false);gate.restore();
    bounds.translate(new Vector3(0,0,40));gate.apply(camera,100,[{object:car,bounds}]);assert.equal(car.visible,false);gate.restore();
    const moving=new Mesh(geometry,material);moving.position.z=-10;scene.add(moving);gate.apply(camera,100,[{object:moving}]);assert.equal(moving.visible,true);gate.restore();moving.position.z=10;gate.apply(camera,100,[{object:moving}]);assert.equal(moving.visible,false,'cached bounds follow the new object transform');
  }finally{gate.restore();geometry.dispose();material.dispose();}
});
