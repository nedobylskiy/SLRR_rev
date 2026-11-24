import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Matrix4,Quaternion,Vector3} from 'three';
import {StaticMapDuplicates} from '../src/render/static-map-duplicates';

const cm=new Matrix4().makeScale(.01,.01,.01);
const pose=(x:number,yaw=0)=>new Matrix4().compose(new Vector3(x,0,-3),new Quaternion().setFromEuler(new Euler(0,yaw,0)),new Vector3(1,1,1));

test('a script copy of a static map model at the same pose is recognised, by path and pose only',()=>{
  const d=new StaticMapDuplicates(),root=new Matrix4();
  d.add(String.raw`misc\garage\g1\garazs_01_targyak.scx`,pose(2,.5));
  const same=pose(2,.5).multiply(cm);
  assert.equal(d.covers('MISC/garage/g1/garazs_01_targyak.scx',same,root),true,'path case and separators do not matter');
  assert.equal(d.covers('misc/garage/g1/other.scx',same,root),false,'another model');
  assert.equal(d.covers('misc/garage/g1/garazs_01_targyak.scx',pose(2.01,.5).multiply(cm),root),false,'1 cm away is a separate placement');
  assert.equal(d.covers('misc/garage/g1/garazs_01_targyak.scx',pose(2,.6).multiply(cm),root),false,'turned');
  assert.equal(d.covers('misc/garage/g1/garazs_01_targyak.scx',pose(2,.5).multiply(new Matrix4().makeScale(.02,.02,.02)),root),false,'scaled');
  const moved=new Matrix4().makeTranslation(100,0,0);
  assert.equal(d.covers('misc/garage/g1/garazs_01_targyak.scx',moved.clone().multiply(same),moved),true,'compared in the static root frame');
  d.clear();assert.equal(d.covers('misc/garage/g1/garazs_01_targyak.scx',same,root),false,'a new map forgets the old one');
});
