import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, PerspectiveCamera, Raycaster, Sprite, SpriteMaterial, Vector2, Vector3 } from 'three';
import { intersectPartGeometry } from '../src/render/part-picking';

for(const visible of [false,true])test(`headlamp and taillamp flare sprites cannot intercept part selection (visible=${visible})`,()=>{
  const lamp=new Group(),hood=new Group(),root=new Group();root.add(lamp,hood);
  const lens=new Mesh(new PlaneGeometry(.3,.3),new MeshBasicMaterial());lens.position.x=-1;lamp.add(lens);
  const flare=new Sprite(new SpriteMaterial());flare.position.z=1;flare.scale.set(10,10,1);flare.visible=visible;lamp.add(flare);
  const body=new Mesh(new PlaneGeometry(1,1),new MeshBasicMaterial());hood.position.x=1;hood.add(body);
  const camera=new PerspectiveCamera(60,1,.1,100);camera.position.z=5;camera.updateMatrixWorld();root.updateMatrixWorld(true);
  const aim=new Vector3(1,0,0).project(camera),ray=new Raycaster();ray.setFromCamera(new Vector2(aim.x,aim.y),camera);
  assert.equal(ray.intersectObjects([lamp,hood],true)[0].object,flare,'the old recursive picker hits even an invisible sprite');
  assert.equal(intersectPartGeometry(ray,[lamp,hood])?.object,body);
  const front=new Vector3(-1,0,0).project(camera);ray.setFromCamera(new Vector2(front.x,front.y),camera);
  assert.equal(intersectPartGeometry(ray,[lamp,hood])?.object,lens,'the actual lamp mesh remains selectable');
});

test('hidden CFG channels and invisible material groups do not intercept geometry selection',()=>{
  const group=new Group(),hidden=new Group();hidden.visible=false;group.add(hidden);
  hidden.add(new Mesh(new PlaneGeometry(2,2),new MeshBasicMaterial()));hidden.position.z=2;
  const opaque=new Mesh(new PlaneGeometry(2,2),new MeshBasicMaterial());group.add(opaque);
  const invisible=new Mesh(new PlaneGeometry(2,2),new MeshBasicMaterial({visible:false}));invisible.position.z=1;group.add(invisible);
  const camera=new PerspectiveCamera();camera.position.z=5;camera.updateMatrixWorld();group.updateMatrixWorld(true);
  const ray=new Raycaster();ray.setFromCamera(new Vector2(),camera);
  assert.equal(intersectPartGeometry(ray,[group])?.object,opaque);
  group.visible=false;assert.equal(intersectPartGeometry(ray,[group]),undefined);
});
