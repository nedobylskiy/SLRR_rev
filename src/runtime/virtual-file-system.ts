import { normalizePath } from '../assets';
import type { KeyValue } from './key-value';

/** Read-only installation files with a persistent writable overlay. */
export class VirtualFileSystem {
  private readonly originals = new Map<string, Uint8Array>();
  private readonly originalNames = new Set<string>();
  private readonly overlay = new Map<string, Uint8Array | null>();
  private pending: Promise<void> = Promise.resolve();

  private constructor(private readonly store: KeyValue) {}

  static async load(store: KeyValue): Promise<VirtualFileSystem> {
    const fs = new VirtualFileSystem(store);
    for (const [path, bytes] of await store.entries())
      fs.overlay.set(normalizePath(path), bytes && Uint8Array.from(bytes));
    return fs;
  }

  mountOriginal(path: string, bytes: Uint8Array): void {
    const key = normalizePath(path);
    this.originalNames.add(key);
    this.originals.set(key, Uint8Array.from(bytes));
  }

  indexOriginalPath(path: string): void { this.originalNames.add(normalizePath(path)); }

  read(path: string): Uint8Array | null {
    const key = normalizePath(path);
    const bytes = this.overlay.has(key) ? this.overlay.get(key) : this.originals.get(key);
    return bytes ? Uint8Array.from(bytes) : null;
  }

  exists(path: string): boolean {
    const key = normalizePath(path);
    return this.overlay.has(key) ? this.overlay.get(key) !== null : this.originalNames.has(key);
  }

  /** Writable entries include tombstones, which hide installation files. */
  overlayEntries(): ReadonlyArray<readonly [string, boolean]> {
    return [...this.overlay].map(([path, bytes]) => [path, bytes !== null]);
  }

  originalPaths(): readonly string[] { return [...this.originals.keys()]; }

  shadows(path: string): boolean { return this.overlay.has(normalizePath(path)); }

  write(path: string, bytes: Uint8Array): void {
    this.change(normalizePath(path), Uint8Array.from(bytes));
  }

  delete(path: string): boolean {
    if (!this.exists(path)) return false;
    this.change(normalizePath(path), null);
    return true;
  }

  copy(source: string, destination: string): boolean {
    const bytes = this.read(source);
    if (!bytes) return false;
    this.write(destination, bytes);
    return true;
  }

  move(source: string, destination: string): boolean {
    const from = normalizePath(source), to = normalizePath(destination);
    const bytes = this.read(from);
    if (!bytes || (from !== to && this.exists(to))) return false;
    if (from === to) return true;
    this.write(to, bytes);
    this.delete(from);
    return true;
  }

  flush(): Promise<void> { return this.pending; }

  private change(key: string, bytes: Uint8Array | null): void {
    this.overlay.set(key, bytes);
    this.pending = this.pending.then(() => this.store.set(key, bytes));
  }
}
