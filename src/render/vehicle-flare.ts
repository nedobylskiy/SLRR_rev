import { AdditiveBlending, CanvasTexture, Color, Matrix4, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from 'three';
import type { Assets } from '../assets';
import type { VehicleLight } from '../engine/vehicle-light';

const images = new WeakMap<Assets, Map<string, Promise<HTMLCanvasElement>>>();
async function glowImage(assets: Assets, path: string): Promise<HTMLCanvasElement> {
  let cache = images.get(assets);
  if (!cache) { cache = new Map(); images.set(assets, cache); }
  let pending = cache.get(path);
  if (!pending) {
    pending = (async () => {
      const bytes = await assets.read(path);
      if (!/\.ptx$/i.test(path)) {
        const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
        try {
          // Ordinary PNG/WebP/etc. already carry their alpha channel. Preserve
          // the whole image; only the original PTX atlas needs tile extraction.
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Lamp flare canvas unavailable');
          context.drawImage(image, 0, 0); return canvas;
        } finally { image.close(); }
      }
      if (bytes.length < 36) throw new Error(`Invalid lamp flare PTX: ${path}`);
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const colorSize = header.getUint32(20, true), alphaSize = header.getUint32(24, true);
      if (!colorSize || !alphaSize || 36 + colorSize + alphaSize > bytes.length) throw new Error(`Invalid lamp flare PTX: ${path}`);
      const decode = (data: Uint8Array) => createImageBitmap(new Blob([Uint8Array.from(data)], { type: 'image/jpeg' }));
      const [color, alpha] = await Promise.all([decode(bytes.subarray(36, 36 + colorSize)), decode(bytes.subarray(36 + colorSize, 36 + colorSize + alphaSize))]);
      try {
        const size = Math.min(128, color.width, color.height, alpha.width, alpha.height);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(color, 0, 0); const pixels = context.getImageData(0, 0, size, size);
        context.clearRect(0, 0, size, size); context.drawImage(alpha, 0, 0);
        const mask = context.getImageData(0, 0, size, size);
        for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = mask.data[i];
        context.putImageData(pixels, 0, 0); return canvas;
      } finally { color.close(); alpha.close(); }
    })();
    cache.set(path, pending);
    pending.catch(() => { if (cache!.get(path) === pending) cache!.delete(path); });
  }
  return pending;
}

/** A depth-tested, additive halo. Lamp resources provide its color and viewing cone. */
export async function createVehicleFlare(source: VehicleLight, assets: Assets, lensRadius = 0, flags = 0): Promise<Sprite> {
  const map = new CanvasTexture(await glowImage(assets, source.texture)); map.colorSpace = SRGBColorSpace;
  // The original mode-2 flare sheet places the main glow in its upper-left quadrant.
  // PNG replacements can contain the same atlas as PTX rather than a single glow.
  if (source.textureMode === 2 && !/\.ptx$/i.test(source.texture)) {
    map.repeat.set(0.5, 0.5); map.offset.set(0, 0.5);
  }
  const material = new SpriteMaterial({ map, color: new Color(...source.color), blending: AdditiveBlending,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false, fog: true });
  const sprite = new Sprite(material);
  const brake = (flags & 1) !== 0;
  const origin = new Vector3(...source.position);
  if (brake) origin.y -= 0.04;
  sprite.position.copy(origin);
  // Native glow sizes are screen-oriented; this metre-scale approximation retains
  // perspective and avoids a fullscreen postprocess for two small lamps.
  sprite.scale.setScalar(Math.max(0.05, Math.min(2, source.size * 0.075)) * (brake ? 3 : 1));
  const direction = new Vector3(...source.direction).normalize();
  const lightPosition = new Vector3(), toCamera = new Vector3(), forward = new Vector3(), inverse = new Matrix4();
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    const parent = sprite.parent;
    if (!parent) return;
    lightPosition.copy(origin).applyMatrix4(parent.matrixWorld);
    toCamera.copy(camera.position).sub(lightPosition).normalize();
    forward.copy(direction).transformDirection(parent.matrixWorld);
    const edge = Math.cos(Math.max(0.01, Math.min(Math.PI, source.cone)) * 0.5);
    const facing = Math.max(0, Math.min(1, (forward.dot(toCamera) - edge) / Math.max(0.01, 1 - edge)));
    material.opacity = Math.max(0, Math.min(1, source.alpha)) * facing;
    // Clear the lens surface slightly; ordinary scene depth still occludes the halo.
    sprite.position.copy(lightPosition).addScaledVector(toCamera, lensRadius + Math.max(0.01, source.offset * 0.01))
      .applyMatrix4(inverse.copy(parent.matrixWorld).invert());
    sprite.updateMatrixWorld(true);
  };
  return sprite;
}
