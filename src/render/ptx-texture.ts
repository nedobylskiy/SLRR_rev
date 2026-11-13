import { CanvasTexture } from 'three';
import { parsePtx } from '../formats/ptx';

/** Decode the full-resolution mip, preserving straight RGB/alpha for Three materials. */
export async function ptxTexture(bytes: Uint8Array): Promise<CanvasTexture> {
  const texture = new CanvasTexture(await ptxCanvas(bytes));
  texture.flipY = false;
  return texture;
}

/** Shared decoder for WebGL textures and HTML OSD images. */
export async function ptxCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const image = parsePtx(bytes), level = image.levels.at(-1)!;
  const decode = (data: Uint8Array) => createImageBitmap(new Blob([Uint8Array.from(data)],{type:'image/jpeg'}));
  const color = await decode(level.color);
  let alpha: ImageBitmap | undefined;
  try {
    if (level.alpha) alpha = await decode(level.alpha);
    if (color.width !== image.width || color.height !== image.height
      || alpha && (alpha.width !== color.width || alpha.height !== color.height)) throw new Error('PTX: JPEG dimensions do not match');
    const canvas = document.createElement('canvas');canvas.width = color.width;canvas.height = color.height;
    const context = canvas.getContext('2d',{willReadFrequently:true});
    if (!context) throw new Error('PTX: canvas unavailable');
    context.drawImage(color,0,0);
    if (alpha) {
      const pixels = context.getImageData(0,0,canvas.width,canvas.height);
      context.drawImage(alpha,0,0);
      const mask = context.getImageData(0,0,canvas.width,canvas.height);
      for (let i=0;i<pixels.data.length;i+=4) pixels.data[i+3] = mask.data[i];
      context.putImageData(pixels,0,0);
    }
    return canvas;
  } finally { color.close();alpha?.close(); }
}
