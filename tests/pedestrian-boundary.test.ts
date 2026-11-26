import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {PedestrianBoundary} from '../src/engine/pedestrian-boundary';

function reference(points:Vector3[],p:Vector3,floor=false){
  let distance=Infinity,x=0,z=0,y=p.y,nx=0,nz=0,interior=false;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    if(!floor&&length<1e-8)continue;
    const raw=((p.x-a.x)*dx+(p.z-a.z)*dz)/(floor?Math.max(1e-9,dx*dx+dz*dz):length*length),t=Math.max(0,Math.min(1,raw));
    const qx=a.x+dx*t,qz=a.z+dz*t,d=Math.hypot(p.x-qx,p.z-qz);
    if(d<distance){distance=d;x=qx;z=qz;y=a.y+(b.y-a.y)*t;nx=length?-dz/length:0;nz=length?dx/length:0;interior=raw>=0&&raw<=1;}
  }
  return {distance,x,z,y,nx,nz,interior};
}
test('indexed boundary agrees with exhaustive sampled curves, heights and oriented normals',()=>{
  const points=Array.from({length:4097},(_,i)=>new Vector3(i*.2,Math.sin(i*.01),Math.sin(i*.004)*35));
  const boundary=new PedestrianBoundary(points);
  for(let i=0;i<500;i++){
    const p=new Vector3((i*7919%10000)/10-100,0,(i*3571%1000)/10-50);
    for(const floor of [false,true]){
      const actual=boundary.nearest(p,floor),expected=reference(points,p,floor);
      for(const key of ['distance','x','y','z','nx','nz'] as const)assert.ok(Math.abs(actual[key]-expected[key])<1e-9,`${key} at ${i}`);
      assert.equal(actual.interior,expected.interior);
    }
  }
});
test('boundary keeps the first segment at shared corners and handles vertical floor segments',()=>{
  const points=[new Vector3(0,1,0),new Vector3(1,2,0),new Vector3(1,3,1)];
  const hit=new PedestrianBoundary(points).nearest(new Vector3(1,0,0));
  assert.ok(hit.nx===0);assert.equal(hit.nz,1);assert.equal(hit.y,2);
  const vertical=new PedestrianBoundary([new Vector3(2,3,4),new Vector3(2,8,4)]);
  assert.equal(vertical.nearest(new Vector3()).distance,Infinity);
  assert.equal(vertical.nearest(new Vector3(),true).y,3);
});
