import {CanvasTexture,CompressedTexture,DataTexture,RGBAFormat,UnsignedByteType,type Texture} from 'three';

/** GPU bytes of the uploaded levels: stored mips for DDS, else 4 bytes/texel plus a generated mip chain. */
export function textureBytes(texture:Texture):number {
  const mips=(texture.mipmaps??[]) as {data?:ArrayBufferView}[];
  const stored=mips.reduce((n,m)=>n+(m.data?.byteLength??0),0);
  if(stored)return stored;
  const image=texture.image as {width?:number;height?:number}|undefined;
  return image?.width&&image.height?image.width*image.height*4*(texture.generateMipmaps?4/3:1):0;
}

export function textureSize(texture:Texture):[number,number] {
  const mip=(texture.mipmaps?.[0]??texture.image) as {width?:number;height?:number}|undefined;
  return [mip?.width??0,mip?.height??0];
}

function copySampling(from:Texture,to:Texture){
  to.name=from.name;to.colorSpace=from.colorSpace;to.wrapS=from.wrapS;to.wrapT=from.wrapT;
  to.repeat.copy(from.repeat);to.offset.copy(from.offset);to.center.copy(from.center);to.rotation=from.rotation;
  to.flipY=from.flipY;to.anisotropy=from.anisotropy;to.magFilter=from.magFilter;to.minFilter=from.minFilter;
  to.premultiplyAlpha=from.premultiplyAlpha;to.needsUpdate=true;
}

/**
 * A copy `levels` mips smaller (each level halves both sides). DDS chains are sliced without decoding,
 * so the result is exactly the mip the GPU would have sampled at that distance. Images are box-resampled.
 * Returns undefined when the texture cannot be reduced (no stored mips, unknown image type, already 1 px).
 */
export function reduceTexture(texture:Texture,levels:number):Texture|undefined {
  if(levels<=0)return;
  if((texture as CompressedTexture).isCompressedTexture){
    const mips=texture.mipmaps as {data:Uint8Array;width:number;height:number}[];
    const drop=Math.min(levels,mips.length-1);
    if(drop<=0)return;
    const kept=mips.slice(drop),result=new CompressedTexture(kept,kept[0].width,kept[0].height,texture.format as CompressedTexture['format'],texture.type);
    copySampling(texture,result);result.generateMipmaps=false;return result;
  }
  const image=texture.image as (CanvasImageSource&{width:number;height:number})|{data:Uint8Array;width:number;height:number}|undefined;
  if(!image?.width||!image.height)return;
  const width=Math.max(1,image.width>>levels),height=Math.max(1,image.height>>levels);
  if(width===image.width&&height===image.height)return;
  if('data' in image){
    if(!(texture as DataTexture).isDataTexture||texture.format!==RGBAFormat||texture.type!==UnsignedByteType||!(image.data instanceof Uint8Array))return;
    const data=new Uint8Array(width*height*4),fx=image.width/width,fy=image.height/height;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
      let sum=0;
      for(let sy=0;sy<fy;sy++)for(let sx=0;sx<fx;sx++)sum+=image.data[((y*fy+sy)*image.width+(x*fx+sx))*4+c];
      data[(y*width+x)*4+c]=Math.round(sum/(fx*fy));
    }
    const result=new DataTexture(data,width,height,RGBAFormat,UnsignedByteType);copySampling(texture,result);
    result.generateMipmaps=texture.generateMipmaps;return result;
  }
  if(typeof document==='undefined')return;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)return;
  context.imageSmoothingQuality='high';context.drawImage(image,0,0,width,height);
  const result=new CanvasTexture(canvas);copySampling(texture,result);result.generateMipmaps=texture.generateMipmaps;return result;
}
