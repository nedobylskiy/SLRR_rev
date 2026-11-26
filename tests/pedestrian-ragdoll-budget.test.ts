import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BoxGeometry,Group,Mesh,MeshBasicMaterial,PerspectiveCamera,SkinnedMesh,Vector3} from 'three';
import {PedestrianCrowd} from '../src/render/pedestrian-crowd';
import {SkinnedCharacter} from '../src/render/skinned-character';
import {SceneVisibility} from '../src/render/scene-visibility';

test('crowd freezes hidden ragdolls and resumes without catching up the offscreen time',()=>{
 const steps:number[]=[],paused:number[]=[],point=new Vector3();let refreshes=0;
 const character={root:new Group(),playing:false,lastTime:1000,ragdoll:{get bounds(){return new Box3(new Vector3(-1,0,-1),new Vector3(1,2,1));},position:point,step:(dt:number)=>{steps.push(dt);return true;},setVehicles(){}},
  refresh(){refreshes++;},pauseSimulation(now:number){paused.push(now);this.lastTime=now;}};
 Object.setPrototypeOf(character,SkinnedCharacter.prototype);
 const crowd=new PedestrianCrowd();
 Object.assign(crowd,{actors:[{active:true,state:'ragdoll',height:1.8,character,mount:new Group(),walker:{position:point}}],pruneAt:Infinity,refillAt:Infinity});
 crowd.update(1000,[],point,()=>true);crowd.update(10000,[],point,()=>true);
 assert.deepEqual(steps,[]);assert.equal(refreshes,0);assert.deepEqual(paused,[1000,10000]);
 crowd.update(10016,[],point,()=>false);
 assert.deepEqual(steps,[.016]);assert.equal(refreshes,1);
 crowd.update(20000,[],point,()=>false,0);assert.deepEqual(steps,[.016]);
});

test('a visible fallen body is not culled by the cached bounds at its former walking position',()=>{
 const scene=new Group(),mount=new Group(),material=new MeshBasicMaterial(),geometry=new BoxGeometry(1,2,1);scene.add(mount);
 const mesh=new Mesh(geometry,material);mount.add(mesh);mount.position.set(0,0,-20);
 let bodyBounds:Box3|undefined;
 const character={get ragdollBounds(){return bodyBounds;}};
 const crowd=new PedestrianCrowd();Object.assign(crowd,{actors:[{active:true,height:1.8,mount,character}]});
 const camera=new PerspectiveCamera(55,1,.1,100),gate=new SceneVisibility();
 camera.position.set(0,2,0);camera.lookAt(0,0,-20);
 gate.apply(camera,100,crowd.visibilityObjects());assert.equal(mount.visible,true);gate.restore();
 // The bones move far from the walking mount. Its local mesh cache remains unchanged.
 bodyBounds=new Box3(new Vector3(14,0,-21),new Vector3(18,1,-19));
 for(const x of [12,20,30]){
  camera.position.set(x,4,0);camera.lookAt(16,.5,-20);
  gate.apply(camera,100,crowd.visibilityObjects());
  assert.equal(mount.parent,scene,'a camera looking at the fallen body must retain it from either side');gate.restore();
 }
 camera.lookAt(16,2,50);gate.apply(camera,100,crowd.visibilityObjects());assert.equal(mount.parent,null);gate.restore();
 geometry.dispose();material.dispose();
});

test('ragdoll culling bounds come from physics, without skinning every rendered vertex twice',()=>{
 const root=new Group(),mesh=new SkinnedMesh(undefined,new MeshBasicMaterial());root.add(mesh);
 let skeletonUpdates=0;
 mesh.computeBoundingBox=()=>assert.fail('expensive skinned bounding box scan');
 mesh.computeBoundingSphere=()=>assert.fail('expensive skinned bounding sphere scan');
 const context={root,skeleton:{update(){skeletonUpdates++;}},meshes:[mesh],
  ragdoll:{get bounds(){return new Box3(new Vector3(-1,0,-1),new Vector3(1,2,1));}}};
 SkinnedCharacter.prototype.refresh.call(context as unknown as SkinnedCharacter,true);
 assert.equal(skeletonUpdates,1);assert.ok(mesh.boundingBox?.containsPoint(new Vector3(0,1,0)));
 assert.ok(mesh.boundingSphere&&mesh.boundingSphere.center.distanceTo(new Vector3(1,2,1))<=mesh.boundingSphere.radius+1e-8);
 mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
});
