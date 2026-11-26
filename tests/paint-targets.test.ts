import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Matrix4,Vector3} from 'three';
import {EngineWorld,type EnginePart} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';
import {paintTargets} from '../src/render/paint-targets';

test('one decal crosses a panel seam with identical coordinates and orientation, excluding another car and distant panels',()=>{
  const world=new EngineWorld(),proxies=new Map<EnginePart,Group>();
  const create=(id:number,parent?:EnginePart,x=0,rotated=false,paintable=true)=>{
    const part=world.create({key:{pack:'car.rpk',id},alias:'panel',cfgPath:'panel.cfg',config:parsePartConfig(paintable?'texture 0x10':'category 3')});
    part.nativeId=id;part.parent=parent;part.local.makeTranslation(x,0,0);
    if(rotated)part.local.multiply(new Matrix4().makeRotationZ(Math.PI/2));
    const group=new Group();group.matrixAutoUpdate=false;group.matrix.copy(part.matrix());const material=new MeshBasicMaterial();if(paintable)material.userData.paintDefault='paint.png';group.add(new Mesh(new BoxGeometry(1,1,1),material));proxies.set(part,group);return part;
  };
  const root=create(1,undefined,0,false,false),left=create(2,root),right=create(3,root,1,true);
  create(4,root,4);create(5,root,1,false,false);
  const otherRoot=create(6,undefined,0,false,false);create(7,otherRoot,1);
  const targets=paintTargets(proxies,{id:2,local:[.49,0,.5],normal:[0,0,1]},.4);
  assert.deepEqual(targets.map(target=>target.id),[2,3]);
  for(const target of targets){
    const frame=(target.id===2?left:right).matrix();
    assert.ok(new Vector3(...target.position).applyMatrix4(frame).distanceTo(new Vector3(.49,0,.5))<1e-6);
    assert.ok(new Vector3(...target.tangent!).transformDirection(frame).distanceTo(new Vector3(1,0,0))<1e-6);
    assert.ok(new Vector3(...target.normal).transformDirection(frame).distanceTo(new Vector3(0,0,1))<1e-6);
  }
  assert.deepEqual(paintTargets(proxies,{id:2,local:[0,0,.5]},.4),[]);
  for(const group of proxies.values())group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();(object.material as MeshBasicMaterial).dispose();}});
  world.dispose();
});
