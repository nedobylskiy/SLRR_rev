import { normalizePath } from '../assets';
import type { KeyValue } from './key-value';

/** Read-only installation files with a persistent writable overlay. */
export class VirtualFileSystem {
  private readonly originals = new Map<string, Uint8Array>();
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
    this.originals.set(normalizePath(path), Uint8Array.from(bytes));
  }

  read(path: string): Uint8Array | null {
    const key = normalizePath(path);
    const bytes = this.overlay.has(key) ? this.overlay.get(key) : this.originals.get(key);
    return bytes ? Uint8Array.from(bytes) : null;
  }

  exists(path: string): boolean { return this.read(path) !== null; }

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
