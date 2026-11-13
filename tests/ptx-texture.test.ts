import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePtx } from '../src/formats/ptx';
import { ptxTexture } from '../src/render/ptx-texture';
import { textureAlphaMode } from '../src/render/texture-alpha';
import { diffuseTextureIndex } from '../src/render/diffuse-texture';
import { OsdLayer } from '../src/osd/osd-layer';
import { Assets } from '../src/assets';

const jpeg = (id: number) => Buffer.from([255,216,id,255,217]);
function fixture(alpha = false) {
  const head = Buffer.alloc(16);head.writeUInt32LE(2,4);head.writeUInt32LE(4,8);head.writeUInt32LE(4,12);
  const mip = (id: number) => {
    const rgb = jpeg(id), a = alpha ? jpeg(id+1) : Buffer.alloc(0), h = Buffer.alloc(20);
    h.writeUInt32LE(rgb.length+a.length,0);h.writeUInt32LE(rgb.length,4);h.writeUInt32LE(a.length,8);
    return Buffer.concat([h,rgb,a]);
  };
  return Buffer.concat([head,mip(1),mip(3)]);
}

test('PTX parses opaque/alpha mip chains smallest first and rejects truncated or invalid records', () => {
  for (const alpha of [false,true]) {
    const bytes = fixture(alpha), parsed = parsePtx(bytes);
    assert.equal(parsed.width,4);assert.equal(parsed.height,4);assert.equal(parsed.levels.length,2);
    assert.deepEqual(parsed.levels.at(-1)!.color,jpeg(3));
    assert.deepEqual(parsed.levels.at(-1)!.alpha,alpha ? jpeg(4) : undefined);
    for (let length=0;length<bytes.length;length++) assert.throws(() => parsePtx(bytes.subarray(0,length)));
    const bad = Buffer.from(bytes);bad.writeUInt32LE(99,16);assert.throws(() => parsePtx(bad),/mip header/);
    const badJpeg = Buffer.from(bytes);badJpeg[36]=0;assert.throws(() => parsePtx(badJpeg),/JPEG/);
  }
});

test('PTX texture uses the largest JPEG and optional alpha, retaining opaque colour and image orientation', async () => {
  const bitmap = globalThis.createImageBitmap, document = globalThis.document, observer = globalThis.ResizeObserver;
  const decoded: number[] = [], closed: number[] = [];
  globalThis.createImageBitmap = (async (blob: Blob) => {
    const id = new Uint8Array(await blob.arrayBuffer())[2];decoded.push(id);
    return {width:4,height:4,id,close(){closed.push(id);}};
  }) as any;
  globalThis.document = {createElement() {
    let current = new Uint8ClampedArray(64);
    return {width:0,height:0,style:{},append(){},remove(){},clientWidth:1600,clientHeight:900,
      toBlob(callback: (blob:Blob)=>void, type:string){callback(new Blob([current.slice().buffer],{type}));},
      getContext(){return {
      drawImage(image: {id:number}) { for (let i=0;i<64;i+=4) current.set(image.id===4?[128,128,128,255]:[32,64,96,255],i); },
      getImageData(){return {data:current.slice()};},
      putImageData(image: {data:Uint8ClampedArray}){current=new Uint8ClampedArray(image.data);},
    };}};
  }} as any;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as any;
  try {
    for (const alpha of [false,true]) {
      decoded.length=closed.length=0;
      const texture = await ptxTexture(fixture(alpha));
      assert.deepEqual(decoded,alpha?[3,4]:[3]);assert.deepEqual(closed,decoded);
      const pixels = texture.image.getContext('2d').getImageData().data;
      assert.deepEqual(Array.from(pixels.slice(0,4)),[32,64,96,alpha?128:255]);
      assert.equal(texture.flipY,false);
      assert.equal(textureAlphaMode(fixture(alpha),'battery.ptx',{width:4,height:4,data:pixels}),alpha?'blend':'opaque');
      texture.dispose();
    }
    const bytes = fixture(true), path = 'frontend/textures/slider_knob.ptx';
    let reads = 0;
    const assets = new Assets([{path,size:bytes.length}],async()=>{reads++;return bytes;});
    const resource = assets.registerTexture(path);
    const layer = new OsdLayer({append(){}} as any,assets);
    try {
      const url = await layer.imageUrl(resource);
      assert.equal(await layer.imageUrl(resource),url);
      assert.equal(reads,1);
      const blob = await (await fetch(url)).blob();
      assert.equal(blob.type,'image/png');
      assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0,4)),[32,64,96,128]);
    } finally { layer.dispose(); }
  } finally { globalThis.createImageBitmap=bitmap;globalThis.document=document;globalThis.ResizeObserver=observer; }
});

test('single-atlas diffuse binding handles stale export slots without guessing missing multi-texture bindings', () => {
  assert.equal(diffuseTextureIndex(2,['inline4_all.dds']),0);
  assert.equal(diffuseTextureIndex(0,['inline4_all.dds']),0);
  assert.equal(diffuseTextureIndex(0xffff,['atlas.dds']),0xffff);
  assert.equal(diffuseTextureIndex(0xffffffff,['atlas.dds']),0xffffffff);
  assert.equal(diffuseTextureIndex(2,['atlas.dds','chrome.dds']),2);
  assert.equal(diffuseTextureIndex(1,['atlas.dds','','detail.dds']),1);
  assert.equal(diffuseTextureIndex(2,['']),2);
});
