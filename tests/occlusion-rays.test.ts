import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BoxGeometry,Color,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Ray,Vector3} from 'three';
import {OccluderGeometry,occludedBox} from '../src/render/occlusion-rays';
import {MapRaycastOcclusion} from '../src/render/map-raycast-occlusion';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

test('a visual opening stays open even when the occluder bounding box covers the ray',()=>{
  const parts=[[-2,0,2,10],[2,0,2,10],[0,3,2,4],[0,-3,2,4]].map(([x,y,w,h])=>{
    const g=new PlaneGeometry(w,h);g.translate(x,y,-5);return g;
  });
  const wall=new OccluderGeometry(mergeGeometries(parts));
  assert.equal(wall.nearest(new Ray(new Vector3(),new Vector3(0,0,-1)),20),undefined);
});

test('rays against a convex wall prove coverage; gaps, mixed blockers and inside-camera boxes fail open',()=>{
  const plane=new PlaneGeometry(6,10);plane.translate(0,0,-5);const geometry=new OccluderGeometry(plane),origin=new Vector3();
  const hit=(point:Vector3)=>{const far=point.length()-.5,ray=new Ray(origin,point.clone().normalize());return geometry.nearest(ray,far)?.patches.map(String);};
  assert.ok(occludedBox(new Box3(new Vector3(-1,-1,-13),new Vector3(1,1,-11)),origin,hit));
  assert.equal(occludedBox(new Box3(new Vector3(7,-1,-13),new Vector3(9,1,-11)),origin,hit),false);
  assert.equal(occludedBox(new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1)),origin,hit),false);
  let count=0;assert.equal(occludedBox(new Box3(new Vector3(-1,-1,-13),new Vector3(1,1,-11)),origin,()=>[String(count++%2)]),false);
});

function fixture(){
  const draws:InstancedMesh[]=[];
  let shadowWork=()=>{};
  const renderer:any={renderBufferDirect:(_c:any,_s:any,_g:any,_m:any,object:InstancedMesh)=>draws.push(object),shadowMap:{render:()=>shadowWork()}};
  const occlusion=new MapRaycastOcclusion(renderer);occlusion.setEnabled(true);occlusion.budgetMs=100;
  const root=new Group(),camera=new PerspectiveCamera(90,1,.1,100);camera.lookAt(0,0,-1);
  const material=new MeshStandardMaterial({side:DoubleSide});
  const wall=new InstancedMesh(new PlaneGeometry(6,10),material,1);wall.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-5));wall.castShadow=true;
  const target=new InstancedMesh(new BoxGeometry(2,2,2),material,2);
  target.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-12));target.setMatrixAt(1,new Matrix4().makeTranslation(8,0,-12));
  target.setColorAt(0,new Color(0xff0000));target.setColorAt(1,new Color(0x0000ff));target.castShadow=true;
  root.add(wall,target);
  const prepare=()=>{for(let i=0;i<4;i++)occlusion.prepare(camera,root);};
  const draw=(object:InstancedMesh)=>renderer.renderBufferDirect(camera,null,object.geometry,object.material,object,null);
  return {root,camera,material,wall,target,occlusion,draws,renderer,prepare,draw,setShadowWork:(work:()=>void)=>{shadowWork=work;}};
}
test('color pass uses compacted visible instances while shadows/reflections keep the original matrices and colors',()=>{
  const f=fixture();f.prepare();
  const proxy=f.root.children.find(o=>o.userData.rayOcclusionProxy) as InstancedMesh;
  assert.ok(proxy);assert.equal(proxy.count,1);assert.equal(proxy.castShadow,false);
  const matrix=new Matrix4(),color=new Color();proxy.getMatrixAt(0,matrix);proxy.getColorAt(0,color);
  assert.equal(matrix.elements[12],8);assert.equal(color.getHex(),0x0000ff);assert.equal(f.target.count,2);
  f.occlusion.renderMain(false,()=>{f.draw(f.target);f.draw(proxy);});assert.deepEqual(f.draws,[proxy]);
  f.draws.length=0;f.draw(f.target);f.draw(proxy);assert.deepEqual(f.draws,[f.target],'reflection/capture uses the complete source');
  f.draws.length=0;f.setShadowWork(()=>{f.draw(f.target);f.draw(proxy);});
  f.occlusion.renderMain(false,()=>f.renderer.shadowMap.render());assert.deepEqual(f.draws,[f.target],'dynamic shadow pass retains all source instances');
  f.draws.length=0;
  f.occlusion.renderMain(true,()=>f.draw(f.target));assert.deepEqual(f.draws,[f.target],'resident inspection bypasses occlusion');
  f.occlusion.reset();assert.equal(f.root.children.some(o=>o.userData.rayOcclusionProxy),false);
});
test('camera changes, removed blockers and alpha-cutout blockers cannot leave stale hidden objects',()=>{
  const f=fixture();f.prepare();assert.ok(f.root.children.some(o=>o.userData.rayOcclusionProxy));
  f.camera.position.x=10;f.camera.lookAt(10,0,-1);f.prepare();assert.equal(f.root.children.some(o=>o.userData.rayOcclusionProxy),false);
  f.camera.position.x=0;f.camera.lookAt(0,0,-1);f.prepare();assert.ok(f.root.children.some(o=>o.userData.rayOcclusionProxy));
  f.material.alphaTest=.5;f.prepare();assert.equal(f.root.children.some(o=>o.userData.rayOcclusionProxy),false);
  f.material.alphaTest=0;f.prepare();assert.ok(f.root.children.some(o=>o.userData.rayOcclusionProxy));
  f.wall.removeFromParent();f.wall.dispose();f.prepare();assert.equal(f.root.children.some(o=>o.userData.rayOcclusionProxy),false);
  f.occlusion.setEnabled(false);assert.equal(f.target.count,2);
});
test('a wall clipped by the near plane cannot hide a distant visible box',()=>{
  const f=fixture();f.wall.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-.01));f.wall.instanceMatrix.needsUpdate=true;
  f.prepare();assert.equal(f.root.children.some(o=>o.userData.rayOcclusionProxy),false);f.occlusion.reset();
});
test('a fully hidden batch skips only color submission and proxy cleanup never disposes source geometry',()=>{
  const f=fixture();f.target.count=1;let geometryDisposals=0;
  f.target.geometry.addEventListener('dispose',()=>geometryDisposals++);f.prepare();
  f.occlusion.renderMain(false,()=>f.draw(f.target));assert.equal(f.draws.length,0);
  f.draw(f.target);assert.deepEqual(f.draws,[f.target]);assert.equal(f.target.count,1);
  f.target.dispose();f.prepare();assert.equal(geometryDisposals,0);f.occlusion.reset();
});
test('a tessellated convex facade occludes across all its triangle boundaries',()=>{
  const f=fixture();f.wall.geometry=new PlaneGeometry(6,10,12,20);f.prepare();
  assert.ok(f.root.children.some(o=>o.userData.rayOcclusionProxy));f.occlusion.reset();
});
test('small camera motion retains a revalidated proof without restarting the candidate queue',()=>{
  const f=fixture();f.prepare();const proxy=f.root.children.find(o=>o.userData.rayOcclusionProxy);
  const cursor=(f.occlusion as any).cursor;f.occlusion.budgetMs=0;
  for(let i=0;i<5;i++){f.camera.position.x+=.0001;f.camera.lookAt(f.camera.position.x,0,-1);f.occlusion.prepare(f.camera,f.root);}
  assert.equal(f.root.children.find(o=>o.userData.rayOcclusionProxy),proxy);
  assert.equal((f.occlusion as any).cursor,cursor);assert.match(f.occlusion.lines()[1],/retained proofs 1/);f.occlusion.reset();
});
test('a center ray alone never hides a box protruding outside the occluder silhouette',()=>{
  const f=fixture();f.target.geometry=new BoxGeometry(10,10,10);f.target.count=1;f.prepare();
  assert.equal(f.root.children.some(o=>o.userData.rayOcclusionProxy),false);
  f.occlusion.renderMain(false,()=>f.draw(f.target));assert.deepEqual(f.draws,[f.target]);f.occlusion.reset();
});
test('a convex coverage proof also handles partially clipped target bounds',()=>{
  const f=fixture();f.wall.geometry=new PlaneGeometry(100,100);f.target.geometry=new BoxGeometry(30,10,2);f.target.count=1;f.prepare();
  f.occlusion.renderMain(false,()=>f.draw(f.target));assert.equal(f.draws.length,0);f.occlusion.reset();
});
test('connected triangulated surfaces with a hole are not promoted to a filled convex patch',()=>{
  const geometry=new PlaneGeometry(6,6,6,6),indices=Array.from(geometry.index!.array);
  geometry.setIndex(indices.filter((_,i)=>{const cell=Math.floor(i/6),x=cell%6,y=Math.floor(cell/6);return !([2,3].includes(x)&&[2,3].includes(y));}));
  geometry.translate(0,0,-5);const rays=new OccluderGeometry(geometry);
  assert.equal(rays.nearest(new Ray(new Vector3(),new Vector3(0,0,-1)),20),undefined);
  const hit=rays.nearest(new Ray(new Vector3(),new Vector3(2,0,-5).normalize()),20)!;
  assert.ok(hit);const throughHole=new Ray(new Vector3(),new Vector3(0,0,-1));
  for(const patch of hit.patches){
    const polygon=rays.patchVertices(patch);if(!polygon)continue;
    for(let i=1;i+1<polygon.length;i++)assert.equal(throughHole.intersectTriangle(polygon[0],polygon[i],polygon[i+1],false,new Vector3()),null);
  }
});
