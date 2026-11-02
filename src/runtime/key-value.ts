/** Replaceable byte-oriented persistence behind the synchronous Java file API. */
export interface KeyValue {
  entries(): Promise<ReadonlyArray<readonly [string, Uint8Array | null]>>;
  set(key: string, value: Uint8Array | null): Promise<void>;
}

export class MemoryKeyValue implements KeyValue {
  private readonly values = new Map<string, Uint8Array | null>();
  async entries(): Promise<ReadonlyArray<readonly [string, Uint8Array | null]>> {
    return [...this.values].map(([key, value]) => [key, value && Uint8Array.from(value)]);
  }
  async set(key: string, value: Uint8Array | null): Promise<void> {
    this.values.set(key, value && Uint8Array.from(value));
  }
}

/** The browser backend stores one game file per IndexedDB record. */
export class IndexedDbKeyValue implements KeyValue {
  private database?: Promise<IDBDatabase>;
  constructor(readonly databaseName = 'slrr-virtual-files', readonly storeName = 'files') {}

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    });
    return this.database;
  }

  async entries(): Promise<ReadonlyArray<readonly [string, Uint8Array | null]>> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const result: Array<readonly [string, Uint8Array | null]> = [];
      const tx = db.transaction(this.storeName, 'readonly');
      const cursor = tx.objectStore(this.storeName).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const value = item.value as ArrayBuffer | null;
        result.push([String(item.key), value === null ? null : new Uint8Array(value)]);
        item.continue();
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read aborted'));
    });
  }

  async set(key: string, value: Uint8Array | null): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const bytes = value ? Uint8Array.from(value).buffer : null;
      tx.objectStore(this.storeName).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }
}

export function browserKeyValue(): KeyValue {
  return typeof indexedDB === 'undefined' ? new MemoryKeyValue() : new IndexedDbKeyValue();
}
