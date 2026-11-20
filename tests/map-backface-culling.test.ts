import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,DoubleSide,FrontSide,MeshStandardMaterial,PlaneGeometry} from 'three';
import {hasFrontWinding,MapBackfaceCulling} from '../src/render/map-backface-culling';

test('map winding rejects reversed triangles and accepts authored fronts',()=>{
  const plane=new PlaneGeometry();assert.equal(hasFrontWinding(plane),true);
  const index=plane.index!;const a=index.getX(0);index.setX(0,index.getX(1));index.setX(1,a);
  assert.equal(hasFrontWinding(plane),false);
  assert.equal(hasFrontWinding(new BoxGeometry()),true);
});

test('map culling toggles existing and future opaque surfaces, preserving foliage and shadows',()=>{
  const policy=new MapBackfaceCulling(),geometry=new PlaneGeometry();
  const opaque=new MeshStandardMaterial({side:DoubleSide});policy.configure(opaque,geometry);
  const foliage=new MeshStandardMaterial({side:DoubleSide,alphaTest:.5});policy.configure(foliage,geometry);
  const glass=new MeshStandardMaterial({side:DoubleSide,transparent:true});policy.configure(glass,geometry);
  policy.setEnabled(true);
  assert.equal(opaque.side,FrontSide);assert.equal(opaque.shadowSide,DoubleSide);
  assert.equal(foliage.side,DoubleSide);assert.equal(glass.side,DoubleSide);
  const future=new MeshStandardMaterial({side:DoubleSide});policy.configure(future,geometry);assert.equal(future.side,FrontSide);
  opaque.dispose();policy.setEnabled(false);
  assert.equal(future.side,DoubleSide);assert.equal(opaque.side,FrontSide);
});

test('ground markings cull their underside for both cutout and blended overlays, independently of opaque culling',()=>{
  const policy=new MapBackfaceCulling(),ground=new PlaneGeometry().rotateX(-Math.PI/2);
  const cutout=new MeshStandardMaterial({side:DoubleSide,alphaTest:.5});
  const blend=new MeshStandardMaterial({side:DoubleSide,transparent:true,opacity:.7});
  policy.configure(cutout,ground);policy.configure(blend,ground);
  policy.setEnabled(true);policy.setEnabled(false);
  assert.equal(cutout.side,FrontSide);assert.equal(blend.side,FrontSide);
  const sign=new MeshStandardMaterial({side:DoubleSide,transparent:true});policy.configure(sign,new PlaneGeometry());
  assert.equal(sign.side,DoubleSide,'vertical transparent objects retain their existing policy');
});
