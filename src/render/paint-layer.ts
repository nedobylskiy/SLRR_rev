import {
  BufferGeometry, Color, CustomBlending, DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, Matrix3, Matrix4,
  Mesh, OneFactor, OneMinusSrcAlphaFactor, OrthographicCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector3, Vector4,
  WebGLRenderTarget, type Material, type MeshBasicMaterial, type MeshStandardMaterial, type Texture, type WebGLRenderer,
} from 'three';

/**
 * Per-part paint texture in the part's own UV layout. Decals (and later scratches or rust) are baked into it, and
 * the car material mixes it into the base colour before lighting, so they take the sun, shadows, reflections and
 * dents exactly like the paint around them. A projected overlay mesh with an unlit material did none of that.
 */
export interface PaintLayer {map:{value:Texture};target?:WebGLRenderTarget;owner?:Mesh;
  /** A context-independent copy (see `copyPaintLayer`), disposed with the layer. */
  copy?:Texture}

const EMPTY=new DataTexture(new Uint8Array(4),1,1);EMPTY.needsUpdate=true;

/** Paint UV attribute the layer is sampled with: the primary UVs, under a name every program declares itself. */
export const PAINT_UV='slrrPaintUv';

export function paintLayerOf(material:Material):PaintLayer|undefined{return material.userData.paintLayer as PaintLayer|undefined;}

/** Prepare a paint material once, so adding the first decal later swaps a texture instead of recompiling. */
export function configurePaintLayer(material:MeshStandardMaterial|MeshBasicMaterial,geometry:BufferGeometry){
  const uv=geometry.getAttribute('uv');if(!uv)return;
  if(!geometry.getAttribute(PAINT_UV))geometry.setAttribute(PAINT_UV,uv);
  if(paintLayerOf(material))return;
  const layer:PaintLayer={map:{value:EMPTY}};material.userData.paintLayer=layer;
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    shader.uniforms.slrrPaintLayer=layer.map;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nattribute vec2 ${PAINT_UV}; varying vec2 vSlrrPaintUv;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\nvSlrrPaintUv = ${PAINT_UV};`);
    // After the authored colour mix: the layer is premultiplied paint on top of the finished base colour.
    // Anchored on alphamap_fragment, the chunk right after color_fragment in lit and unlit shaders alike:
    // the scene lighting hook consumes color_fragment itself (it substitutes its own paint-mask mix).
    const anchor='#include <alphamap_fragment>';
    if(!shader.fragmentShader.includes(anchor)){console.warn('Paint layer: fragment anchor missing; decals will not show');return;}
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D slrrPaintLayer; varying vec2 vSlrrPaintUv;')
      .replace(anchor,`vec4 slrrLayer = texture2D(slrrPaintLayer, vSlrrPaintUv);\ndiffuseColor.rgb = diffuseColor.rgb * (1.0 - slrrLayer.a) + slrrLayer.rgb;\n${anchor}`);
  };
  material.customProgramCacheKey=()=>`${key}|paint-layer-v3`;
  material.needsUpdate=true;
}

export interface PaintUvInfo {usable:boolean;coverage:number;overlap:number}
/**
 * A layer needs UVs inside 0..1 where no two paint faces share texels; otherwise one decal would also appear
 * where the overlapping face is. Measured once per geometry on a coarse raster.
 */
export function paintUvInfo(geometry:BufferGeometry,faces?:BufferGeometry):PaintUvInfo{
  const cached=(faces??geometry).userData.slrrPaintUvInfo as PaintUvInfo|undefined;if(cached)return cached;
  const N=128,grid=new Uint8Array(N*N),uv=geometry.getAttribute('uv'),index=(faces??geometry).index;
  let covered=0,overlapping=0,outside=false;
  const count=index?.count??uv?.count??0;
  if(uv)for(let t=0;t+2<count;t+=3){
    const ids=[0,1,2].map(k=>index?index.getX(t+k):t+k);
    const xs=ids.map(i=>uv.getX(i)*N),ys=ids.map(i=>uv.getY(i)*N);
    if(xs.some(x=>x< -.5||x>N+.5)||ys.some(y=>y< -.5||y>N+.5)){outside=true;break;}
    const area=(xs[1]-xs[0])*(ys[2]-ys[0])-(xs[2]-xs[0])*(ys[1]-ys[0]);if(Math.abs(area)<1e-9)continue;
    const x0=Math.max(0,Math.floor(Math.min(...xs))),x1=Math.min(N-1,Math.ceil(Math.max(...xs)));
    const y0=Math.max(0,Math.floor(Math.min(...ys))),y1=Math.min(N-1,Math.ceil(Math.max(...ys)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const px=x+.5,py=y+.5;
      const w0=((xs[1]-px)*(ys[2]-py)-(xs[2]-px)*(ys[1]-py))/area,w1=((xs[2]-px)*(ys[0]-py)-(xs[0]-px)*(ys[2]-py))/area;
      if(w0<0||w1<0||w0+w1>1)continue;
      const cell=y*N+x;if(grid[cell]===0)covered++;else if(grid[cell]===1)overlapping++;if(grid[cell]<2)grid[cell]++;
    }
  }
  const overlap=covered?overlapping/covered:0;
  const info={usable:!!uv&&!outside&&covered>0&&overlap<=.05,coverage:covered/(N*N),overlap};
  (faces??geometry).userData.slrrPaintUvInfo=info;return info;
}

/** Texture side giving about 5 mm per texel over the paint faces, between 256 and 2048. */
export function paintLayerSize(geometry:BufferGeometry,world:Matrix4,coverage:number){
  const position=geometry.getAttribute('position'),index=geometry.index,count=index?.count??position.count;
  const a=new Vector3(),b=new Vector3(),c=new Vector3();let area=0;
  for(let t=0;t+2<count;t+=3){
    a.fromBufferAttribute(position,index?index.getX(t):t).applyMatrix4(world);
    b.fromBufferAttribute(position,index?index.getX(t+1):t+1).applyMatrix4(world);
    c.fromBufferAttribute(position,index?index.getX(t+2):t+2).applyMatrix4(world);
    area+=b.sub(a).cross(c.sub(a)).length()/2;
  }
  const side=Math.sqrt(area/Math.max(coverage,.05))/.005;
  return Math.min(2048,Math.max(256,2**Math.ceil(Math.log2(Math.max(1,side)))));
}

export interface PaintDecal {
  /** Paint faces facing the decal, with this mesh's attributes. */
  faces:BufferGeometry;world:Matrix4;
  /** World to decal space: x/y across the brush, z along its normal. */
  inverse:Matrix4;size:Vector3;normal:Vector3;
  texture:Texture;color:Color;opacity:number;flip:boolean;
  /** Non-paintable atlas mask: decal alpha is multiplied by 1 - mask.a at these UVs. */
  coverage?:{attribute:string;mask:Texture;matrix?:Matrix3};
}

const vertexShader=`
attribute vec2 ${PAINT_UV};
attribute vec2 slrrCoverageUv;
uniform mat4 slrrWorld; uniform mat4 slrrDecalInverse; uniform mat3 slrrCoverageMatrix;
varying vec3 vDecal; varying vec3 vNormal; varying vec2 vCoverageUv;
void main(){
  vec4 world=slrrWorld*vec4(position,1.0);
  vDecal=(slrrDecalInverse*world).xyz;
  vNormal=normalize(mat3(slrrWorld)*normal);
  vCoverageUv=(slrrCoverageMatrix*vec3(slrrCoverageUv,1.0)).xy;
  gl_Position=vec4(${PAINT_UV}*2.0-1.0,0.0,1.0);
}`;
const fragmentShader=`
uniform sampler2D slrrBrush; uniform sampler2D slrrCoverage; uniform float slrrUseCoverage;
uniform vec3 slrrSize; uniform vec3 slrrNormal; uniform vec4 slrrColor; uniform float slrrFlip;
varying vec3 vDecal; varying vec3 vNormal; varying vec2 vCoverageUv;
void main(){
  vec3 p=vDecal/slrrSize;
  if(any(greaterThan(abs(p),vec3(0.5))))discard;
  if(dot(normalize(vNormal),slrrNormal)<=0.05)discard;
  vec2 uv=vec2(0.5+p.x,0.5+p.y);if(slrrFlip>0.5)uv.x=1.0-uv.x;
  vec4 brush=texture2D(slrrBrush,uv);
  float alpha=brush.a*slrrColor.a;
  if(slrrUseCoverage>0.5)alpha*=1.0-texture2D(slrrCoverage,vCoverageUv).a;
  if(alpha<0.002)discard;
  gl_FragColor=vec4(brush.rgb*slrrColor.rgb*alpha,alpha);
}`;

/** Render every decal of a part, in order, into the layer's texture (cleared first). */
export function bakePaintLayer(renderer:WebGLRenderer,layer:PaintLayer,size:number,decals:PaintDecal[]){
  if(!decals.length){layer.target?.dispose();layer.target=undefined;layer.map.value=EMPTY;return;}
  if(!layer.target||layer.target.width!==size){
    layer.target?.dispose();
    layer.target=new WebGLRenderTarget(size,size,{colorSpace:SRGBColorSpace,generateMipmaps:true,minFilter:LinearMipmapLinearFilter,magFilter:LinearFilter,depthBuffer:false});
    layer.target.texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  }
  const material=new ShaderMaterial({vertexShader,fragmentShader,side:DoubleSide,depthTest:false,depthWrite:false,transparent:true,
    blending:CustomBlending,blendSrc:OneFactor,blendDst:OneMinusSrcAlphaFactor,blendSrcAlpha:OneFactor,blendDstAlpha:OneMinusSrcAlphaFactor,
    uniforms:{slrrWorld:{value:new Matrix4()},slrrDecalInverse:{value:new Matrix4()},slrrCoverageMatrix:{value:new Matrix3()},
      slrrBrush:{value:EMPTY},slrrCoverage:{value:EMPTY},slrrUseCoverage:{value:0},slrrSize:{value:new Vector3()},slrrNormal:{value:new Vector3()},
      slrrColor:{value:new Vector4()},slrrFlip:{value:0}}});
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1);
  const previousTarget=renderer.getRenderTarget(),clear=renderer.getClearColor(new Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear;
  try{
    renderer.setRenderTarget(layer.target);renderer.setClearColor(0x000000,0);renderer.clear(true,false,false);renderer.autoClear=false;
    for(const decal of decals){
      const u=material.uniforms,faces=decal.faces;
      u.slrrWorld.value.copy(decal.world);u.slrrDecalInverse.value.copy(decal.inverse);u.slrrSize.value.copy(decal.size);u.slrrNormal.value.copy(decal.normal);
      u.slrrBrush.value=decal.texture;u.slrrColor.value.set(decal.color.r,decal.color.g,decal.color.b,decal.opacity);u.slrrFlip.value=decal.flip?1:0;
      const coverage=decal.coverage&&faces.getAttribute(decal.coverage.attribute);
      u.slrrUseCoverage.value=coverage?1:0;u.slrrCoverage.value=coverage?decal.coverage!.mask:EMPTY;
      u.slrrCoverageMatrix.value.copy(decal.coverage?.matrix??new Matrix3());
      faces.setAttribute('slrrCoverageUv',coverage||faces.getAttribute(PAINT_UV)||faces.getAttribute('uv'));
      const mesh=new Mesh(faces,material);mesh.frustumCulled=false;scene.add(mesh);
      renderer.render(scene,camera);
      scene.remove(mesh);faces.deleteAttribute('slrrCoverageUv');
    }
  }finally{
    renderer.autoClear=autoClear;renderer.setRenderTarget(previousTarget);renderer.setClearColor(clear,alpha);material.dispose();
  }
  layer.map.value=layer.target.texture;
}

export function disposePaintLayer(material:Material){
  const layer=paintLayerOf(material);if(!layer)return;
  layer.target?.dispose();layer.target=undefined;layer.copy?.dispose();layer.copy=undefined;layer.map.value=EMPTY;
}

/**
 * Pixels of a baked layer as an ordinary texture. A render target exists only in the context of the renderer
 * that drew it, so surfaces drawn by another renderer (OSD part thumbnails) need this copy. Returns undefined
 * for a layer without decals.
 */
export function copyPaintLayer(renderer:WebGLRenderer,layer:PaintLayer):Texture|undefined{
  const target=layer.target;if(!target)return;
  const {width,height}=target,pixels=new Uint8Array(width*height*4);
  renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
  // Render target rows start at v = 0, as DataTexture rows do without flipY.
  const texture=new DataTexture(pixels,width,height);
  texture.colorSpace=SRGBColorSpace;texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;
  texture.needsUpdate=true;return texture;
}
