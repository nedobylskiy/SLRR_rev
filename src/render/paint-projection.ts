import {BufferGeometry,Float32BufferAttribute,Matrix3,Matrix4,Vector2,Vector3,type Euler,type MeshBasicMaterial,type Texture} from 'three';

interface Vertex {p:Vector3;n:Vector3;uv:Vector2}
/** Clip paint faces while retaining their original UVs for the non-paintable atlas mask. */
export function projectPaintGeometry(surface:BufferGeometry,world:Matrix4,point:Vector3,orientation:Euler,size:Vector3,coverage?:string,uvTransform?:Matrix3){
  const projector=new Matrix4().makeRotationFromEuler(orientation).setPosition(point),inverse=projector.clone().invert();
  const normals=new Matrix3().getNormalMatrix(world),position=surface.getAttribute('position'),normal=surface.getAttribute('normal');
  const uv=coverage&&surface.getAttribute(coverage),indices=surface.index;
  const output:number[]=[],outputNormals:number[]=[],outputUv:number[]=[],coverageUv:number[]=[];
  const vertex=(i:number):Vertex=>{
    const sample=uv?new Vector2(uv.getX(i),uv.getY(i)):new Vector2();if(uvTransform)sample.applyMatrix3(uvTransform);
    return {p:new Vector3().fromBufferAttribute(position,i).applyMatrix4(world).applyMatrix4(inverse),
      n:new Vector3().fromBufferAttribute(normal,i).applyNormalMatrix(normals),uv:sample};
  };
  for(let i=0;i<(indices?.count??position.count);i+=3){
    let polygon=[0,1,2].map(j=>vertex(indices?indices.getX(i+j):i+j));
    for(const axis of ['x','y','z'] as const)for(const side of [-1,1]){
      const clipped:Vertex[]=[],half=size[axis]/2;
      for(let j=0;j<polygon.length;j++){
        const a=polygon[j],b=polygon[(j+1)%polygon.length],da=half-side*a.p[axis],db=half-side*b.p[axis];
        if(da>=0)clipped.push(a);
        if((da>=0)!==(db>=0)){
          const t=da/(da-db);clipped.push({p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t),uv:a.uv.clone().lerp(b.uv,t)});
        }
      }
      polygon=clipped;
    }
    for(let j=1;j+1<polygon.length;j++)for(const v of [polygon[0],polygon[j],polygon[j+1]]){
      output.push(...v.p.clone().applyMatrix4(projector).toArray());outputNormals.push(...v.n.clone().normalize().toArray());
      outputUv.push(.5+v.p.x/size.x,.5+v.p.y/size.y);coverageUv.push(v.uv.x,v.uv.y);
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(output,3));geometry.setAttribute('normal',new Float32BufferAttribute(outputNormals,3));geometry.setAttribute('uv',new Float32BufferAttribute(outputUv,2));
  if(uv)geometry.setAttribute('slrrPaintCoverageUv',new Float32BufferAttribute(coverageUv,2));return geometry;
}

export function maskPaintProjection(material:MeshBasicMaterial,mask:Texture){
  material.onBeforeCompile=shader=>{
    shader.uniforms.slrrPaintCoverage={value:mask};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 slrrPaintCoverageUv; varying vec2 vSlrrPaintCoverageUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvSlrrPaintCoverageUv=slrrPaintCoverageUv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D slrrPaintCoverage; varying vec2 vSlrrPaintCoverageUv;')
      .replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.a *= 1.0-texture2D(slrrPaintCoverage,vSlrrPaintCoverageUv).a;\nif(diffuseColor.a<0.001)discard;');
  };
  material.customProgramCacheKey=()=> 'paint-projection-coverage-v1';
}
