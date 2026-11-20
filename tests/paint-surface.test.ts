import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {isPaintSurface,paintSurfaceGeometry} from '../src/render/paint-surface';

test('glass, unpainted trim and hidden materials cannot receive decals even inside a paintable part',()=>{
  const paint=new MeshBasicMaterial(),glass=new MeshBasicMaterial({transparent:true,opacity:.4}),trim=new MeshBasicMaterial();
  paint.userData.paintDefault='white.png';glass.userData.paintDefault='white.png';
  assert.equal(isPaintSurface(paint),true);assert.equal(isPaintSurface(glass),false);assert.equal(isPaintSurface(trim),false);
  const geometry=new BoxGeometry(),mesh=new Mesh(geometry,[paint,paint,paint,paint,glass,trim]);
  mesh.updateMatrixWorld();
  assert.equal(paintSurfaceGeometry(mesh,new Vector3(0,0,1)),undefined,'glass face is excluded, and the reverse side must not catch the projection');
  mesh.material=[paint,paint,paint,paint,paint,trim];
  const projected=paintSurfaceGeometry(mesh,new Vector3(0,0,1));assert.ok(projected);
  assert.equal(projected.index?.count,6,'only two outward-facing painted triangles remain');
  paint.visible=false;assert.equal(paintSurfaceGeometry(mesh,new Vector3(0,0,1)),undefined);
  assert.equal(geometry.index?.count,36,'projection never edits the vehicle geometry');
  projected.dispose();geometry.dispose();paint.dispose();glass.dispose();trim.dispose();
});
