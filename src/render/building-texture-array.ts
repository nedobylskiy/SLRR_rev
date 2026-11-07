import {buildingLayerKey} from './building-material-batch';
import {Color,LinearFilter,LinearMipmapLinearFilter,Mesh,MeshBasicMaterial,MeshStandardMaterial,NoBlending,NoToneMapping,OrthographicCamera,PlaneGeometry,RepeatWrapping,Scene,SRGBColorSpace,Vector4,WebGLArrayRenderTarget,type WebGLRenderer} from 'three';

/** Copy source textures on GPU into standard WebGL2 texture-array layers.
 * Array layers preserve repeating UVs and independent mipmaps without atlas gutters. */
export function createBuildingTextureArray(renderer:WebGLRenderer,materials:MeshStandardMaterial[],maxBytes=256*1048576){
  const sizes=materials.map(m=>({width:m.map?.image?.width??1,height:m.map?.image?.height??1}));
  const width=Math.max(...sizes.map(s=>s.width)),height=Math.max(...sizes.map(s=>s.height));
  // Keep this prototype bounded; unsupported large groups keep their source materials.
  if(width>2048||height>2048||width*height*materials.length>16*1024*1024||width*height*materials.length*4*4/3>maxBytes)throw Error('Building texture array exceeds preparation budget');
  const target=new WebGLArrayRenderTarget(width,height,materials.length,{depthBuffer:false,stencilBuffer:false,
    minFilter:LinearMipmapLinearFilter,magFilter:LinearFilter,wrapS:RepeatWrapping,wrapT:RepeatWrapping,colorSpace:SRGBColorSpace,generateMipmaps:false});
  target.texture.name='Unified building diffuse layers';
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2),quad=new Mesh(geometry,new MeshBasicMaterial());
  scene.add(quad);quad.frustumCulled=false;
  const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel(),viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
  const clear=renderer.getClearColor(new Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear,tone=renderer.toneMapping,xr=renderer.xr.enabled;
  try{
    renderer.xr.enabled=false;renderer.toneMapping=NoToneMapping;renderer.autoClear=true;renderer.setScissorTest(false);renderer.setClearColor(0xffffff,1);
    for(let i=0;i<materials.length;i++){
      const source=materials[i],copy=source.map?.clone();
      if(copy){copy.offset.set(0,0);copy.repeat.set(1,1);copy.rotation=0;copy.center.set(0,0);copy.matrix.identity();copy.matrixAutoUpdate=false;}
      const material=new MeshBasicMaterial({map:copy??null,color:source.color,depthTest:false,depthWrite:false,toneMapped:false,transparent:true,blending:NoBlending});
      quad.material.dispose();quad.material=material;
      target.texture.generateMipmaps=i===materials.length-1;
      renderer.setRenderTarget(target,i);renderer.render(scene,camera);copy?.dispose();
    }
    return target;
  }catch(error){target.dispose();throw error;}
  finally{
    renderer.setRenderTarget(previous,face,level);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    renderer.setClearColor(clear,alpha);renderer.autoClear=autoClear;renderer.toneMapping=tone;renderer.xr.enabled=xr;geometry.dispose();quad.material.dispose();
  }
}

/** Ref-counted across repeated render variants; one array upload per source set. */
export class BuildingTextureArrays {
  private entries=new Map<string,{target:WebGLArrayRenderTarget;users:number;bytes:number}>();
  get bytes(){return [...this.entries.values()].reduce((n,e)=>n+e.bytes,0);}
  get count(){return this.entries.size;}
  acquire(renderer:WebGLRenderer,materials:MeshStandardMaterial[]){
    const key=JSON.stringify(materials.map(buildingLayerKey));let entry=this.entries.get(key);
    if(!entry){const target=createBuildingTextureArray(renderer,materials,256*1048576-this.bytes);
      entry={target,users:0,bytes:Math.ceil(target.width*target.height*target.depth*4*4/3)};this.entries.set(key,entry);}
    entry.users++;const owned=entry;let released=false;
    return {texture:entry.target.texture,release:()=>{if(released)return;released=true;if(--owned.users===0){owned.target.dispose();this.entries.delete(key);}}};
  }
}
