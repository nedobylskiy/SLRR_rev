import type { Texture } from 'three';

/** Share decoded/uploaded pixels, while each material owns its sampler and UV transform. */
export class TextureSourceCache {
  private entries = new Map<string, { promise: Promise<Texture>; users: number }>();

  async acquire(key: string, load: () => Promise<Texture>): Promise<Texture> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { promise: load(), users: 0 };
      this.entries.set(key, entry);
      const created = entry;
      void entry.promise.catch(() => { if (this.entries.get(key) === created) this.entries.delete(key); });
    }
    entry.users++;
    let source: Texture;
    try { source = await entry.promise; }
    catch (error) { entry.users--; throw error; }
    const texture = source.clone();
    const current = entry;
    const release = () => {
      texture.removeEventListener('dispose', release);
      if (--current.users === 0) {
        if (this.entries.get(key) === current) this.entries.delete(key);
        source.dispose();
      }
    };
    texture.addEventListener('dispose', release);
    return texture;
  }
}
