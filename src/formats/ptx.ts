import { BinaryReader } from '../binary';

export interface PtxLevel { color: Uint8Array; alpha?: Uint8Array }
export interface PtxImage { width: number; height: number; levels: PtxLevel[] }

/** Stock PTX stores JPEG mip levels smallest first, with an optional alpha JPEG per level. */
export function parsePtx(bytes: Uint8Array): PtxImage {
  const r = new BinaryReader(bytes,'PTX');
  if (r.u32() !== 0) throw new Error('PTX: invalid header');
  const count = r.u32(), width = r.u32(), height = r.u32();
  if (!count || count > 32 || !width || !height || width > 16384 || height > 16384)
    throw new Error('PTX: invalid mip count or dimensions');
  const jpeg = (size: number) => {
    const data = r.take(size);
    if (size < 2 || data[0] !== 255 || data[1] !== 216) throw new Error('PTX: invalid JPEG payload');
    return data;
  };
  const levels: PtxLevel[] = [];
  for (let i=0;i<count;i++) {
    const total = r.u32(), colorSize = r.u32(), alphaSize = r.u32(), reserved = r.u32();
    r.f32(); // Native mip level metadata; payload sizes delimit the images.
    if (reserved !== 0 || !colorSize || total !== colorSize + alphaSize) throw new Error('PTX: invalid mip header');
    r.require(total);
    levels.push({color:jpeg(colorSize),alpha:alphaSize ? jpeg(alphaSize) : undefined});
  }
  return {width,height,levels};
}
