import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {DeformablePanel} from '../src/engine/deformable-panel';
import {PanelCollisionSkin,RigidCollisionSkin} from '../src/engine/panel-collision-skin';

test('rigid collision indexing preserves all triangle corners under successive attachment transforms',()=>{
  const source=[0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0,0,0,1e-9,1,0,0,0,1,0];
  const skin=new RigidCollisionSkin(source),original=[...source],out=[123,456,789];
  assert.equal(skin.vertexCount,5,'only exactly equal positions are shared');
  for(const frame of [new Matrix4(),new Matrix4().makeRotationY(.7).setPosition(23,-5,17),new Matrix4().makeScale(.5,2,-1)]){
    assert.equal(skin.write(frame,out,3),5);
    for(let i=0;i<source.length;i+=3){
      const expected=new Vector3().fromArray(source,i).applyMatrix4(frame);
      assert.ok(expected.distanceTo(new Vector3().fromArray(out,3+i))<1e-12);
    }
    assert.deepEqual(out.slice(0,3),[123,456,789]);assert.equal(out.length,source.length+3);
  }
  assert.deepEqual(source,original,'source geometry remains immutable');
});

test('indexed collision skin matches per-corner skinning after deformation and rotated body transforms',()=>{
  const source=[-1,1,-1,1,1,-1,1,1,1,-1,1,-1,1,1,1,-1,1,1];
  const panel=new DeformablePanel(source,{mass:10,mount:[0,1,0]});
  const skin=new PanelCollisionSkin(panel,source),direct:number[]=[];
  const reference=Array.from({length:source.length/3},(_,i)=>panel.bind(source.slice(i*3,i*3+3)));
  let calls=0;const original=panel.skin.bind(panel);panel.skin=(...args)=>{calls++;original(...args);};
  const inverse=new Matrix4().makeRotationY(.63).setPosition(5,-2,9).invert();
  for(let pass=0;pass<3;pass++){
    for(let i=0;i<panel.positions.length;i++)panel.positions[i]+=.003*Math.sin(i+pass);
    const output=[123,456,789];skin.write(panel,inverse,output,3);
    for(let i=0;i<reference.length;i++){
      original(reference[i],direct,0);
      const expected=new Vector3().fromArray(direct).applyMatrix4(inverse);
      assert.ok(expected.distanceTo(new Vector3().fromArray(output,3+i*3))<1e-12);
    }
    assert.deepEqual(output.slice(0,3),[123,456,789]);
  }
  assert.equal(skin.uniqueBindings.length,4);assert.equal(calls,12,'four unique vertices, rather than six corners, per update');
});

test('each part owns its skin cache and distinct positions remain distinct',()=>{
  const source=[0,1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,0,1,0,1,1,1,0,1,1.000000001];
  const a=new DeformablePanel(source,{mass:10,mount:[0,1,0]}),b=new DeformablePanel(source,{mass:10,mount:[0,1,0]});
  const first=new PanelCollisionSkin(a,source),second=new PanelCollisionSkin(b,source);
  assert.equal(first.uniqueBindings.length,5);
  a.positions[0]+=.1;const outA:number[]=[],outB:number[]=[];
  first.write(a,new Matrix4(),outA,0);second.write(b,new Matrix4(),outB,0);
  assert.notDeepEqual(outA,outB);
});
