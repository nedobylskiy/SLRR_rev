import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Matrix3,Matrix4,Vector3} from 'three';
import {deformationNormals} from '../src/render/deformation-normals';

function square(hard=false){
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0],3));
  const a=new Vector3(0,.2,1).normalize(),b=hard?new Vector3(.5,0,1).normalize():a;
  g.setAttribute('normal',new Float32BufferAttribute([...a.toArray(),...a.toArray(),...a.toArray(),...b.toArray(),...b.toArray(),...b.toArray()],3));return g;
}
test('deformation keeps authored normals and UV seam smoothing while preserving hard edges',()=>{
  for(const hard of [false,true]){
    const g=square(hard),normals=deformationNormals(g),original=new Float32Array(g.getAttribute('normal').array);normals.update();
    for(let i=0;i<original.length;i++)assert.ok(Math.abs(g.getAttribute('normal').array[i]-original[i])<1e-6);
    g.getAttribute('position').setZ(4,.6);normals.update();
    const n=g.getAttribute('normal'),a=new Vector3().fromBufferAttribute(n,1),b=new Vector3().fromBufferAttribute(n,3);
    if(hard)assert.ok(a.distanceTo(b)>.1,'authored hard edges must stay split');else assert.ok(a.distanceTo(b)<1e-6,'duplicated seam vertices must share a smooth normal');
    normals.restore();assert.deepEqual(new Float32Array(n.array),original);g.dispose();
  }
});
test('normal transport follows rigid motion and centimetre-to-metre scale without losing authored shading',()=>{
  const g=square(),normals=deformationNormals(g),original=new Float32Array(g.getAttribute('normal').array);
  const frame=new Matrix4().makeRotationAxis(new Vector3(1,2,3).normalize(),1.2).scale(new Vector3(.01,.01,.01)).setPosition(5,3,-2);
  g.applyMatrix4(frame);normals.update();const transform=new Matrix3().getNormalMatrix(frame),n=g.getAttribute('normal');
  for(let i=0;i<n.count;i++){const expected=new Vector3().fromArray(original,i*3).applyMatrix3(transform).normalize();assert.ok(new Vector3().fromBufferAttribute(n,i).distanceTo(expected)<1e-4);}
  g.getAttribute('position').array.fill(0);normals.update();assert.ok(Array.from(n.array).every(Number.isFinite),'collapsed triangles must not generate NaN');g.dispose();
});
