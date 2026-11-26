import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Scene,Vector3} from 'three';
import {cacheUnchangedTransform} from '../src/render/stable-transform';

test('unchanged containers do not force static descendants, but moving children still update',()=>{
  const scene=new Scene(),root=new Group(),fixed=new Group(),moving=new Group();
  scene.add(root);root.add(fixed,moving);fixed.matrixAutoUpdate=false;
  cacheUnchangedTransform(scene);cacheUnchangedTransform(root);
  fixed.matrix.makeTranslation(3,0,0);fixed.matrixWorldNeedsUpdate=true;
  scene.updateMatrixWorld();
  let multiplies=0;
  const multiply=fixed.matrixWorld.multiplyMatrices.bind(fixed.matrixWorld);
  fixed.matrixWorld.multiplyMatrices=(a,b)=>{multiplies++;return multiply(a,b);};
  moving.position.x=2;scene.updateMatrixWorld();
  assert.equal(multiplies,0);
  assert.equal(new Vector3().setFromMatrixPosition(moving.matrixWorld).x,2);
  root.position.x=5;scene.updateMatrixWorld();
  assert.equal(multiplies,1);
  assert.equal(new Vector3().setFromMatrixPosition(fixed.matrixWorld).x,8);
  scene.updateMatrixWorld(true);assert.equal(multiplies,2);
});

test('reparenting, direct matrix invalidation and disabling the cache retain normal updates',()=>{
  const scene=new Scene(),root=new Group(),child=new Group(),other=new Group();
  let enabled=true;
  cacheUnchangedTransform(scene,()=>enabled);cacheUnchangedTransform(root,()=>enabled);
  scene.add(root,other);root.add(child);other.position.x=7;child.matrixAutoUpdate=false;
  child.matrix.makeTranslation(1,0,0);child.matrixWorldNeedsUpdate=true;
  scene.updateMatrixWorld();
  other.add(root);scene.updateMatrixWorld();
  assert.equal(new Vector3().setFromMatrixPosition(child.matrixWorld).x,8);
  child.matrix.makeTranslation(2,0,0);child.matrixWorldNeedsUpdate=true;scene.updateMatrixWorld();
  assert.equal(new Vector3().setFromMatrixPosition(child.matrixWorld).x,9);
  enabled=false;root.updateMatrix();assert.equal(root.matrixWorldNeedsUpdate,true);
});

test('late streamed subtrees with authored matrices are initialized under a stationary root',()=>{
  const scene=new Scene(),root=new Group();scene.add(root);
  cacheUnchangedTransform(scene);cacheUnchangedTransform(root);scene.updateMatrixWorld();
  const part=new Group(),mesh=new Group();part.matrixAutoUpdate=mesh.matrixAutoUpdate=false;
  part.matrix.makeTranslation(4,0,0);mesh.matrix.makeTranslation(2,0,0);part.add(mesh);root.add(part);
  scene.updateMatrixWorld();
  assert.equal(new Vector3().setFromMatrixPosition(mesh.matrixWorld).x,6);
});
