import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { parseSdat, serializeSdat, type Sdat } from '../formats/sdat';
import { MemoryFile } from './memory-file';
import type { GameTypeNative } from './game-type-native';
import type { VirtualFileSystem } from './virtual-file-system';

interface OpenFile { path: string; mode: 0 | 1; stream: MemoryFile; sdat?: Sdat }
const owner = 'java.io.File';
const voidValue = () => jv('void', undefined);

/** Original File natives against the virtual filesystem, with SDAT framing. */
export class FileNative {
  private readonly opened = new WeakMap<JavaObject, OpenFile>();

  constructor(jvm: SlrrJvm, private readonly fs: VirtualFileSystem, private readonly resources: GameTypeNative) {
    jvm.natives.register(owner, 'open', ['int'], ({ receiver, args }) => {
      this.close(receiver);
      const path = this.path(receiver);
      const mode = Number(args[0].value);
      if (!path || (mode !== 0 && mode !== 1)) return jv('int', 0);
      if (mode === 1) {
        const stream = new MemoryFile();
        this.opened.set(this.object(receiver), { path, mode, stream });
        this.fs.write(path, serializeSdat({ type: 2, flags: 0, payload: new Uint8Array(),
          packs: new Map(), unsaved: [] }));
        return jv('int', 1);
      }
      const bytes = this.fs.read(path);
      if (!bytes) return jv('int', 0);
      let payload = bytes, sdat: Sdat | undefined;
      if (bytes.length >= 4 && new TextDecoder('ascii').decode(bytes.subarray(0, 4)) === 'SDAT')
        payload = (sdat = parseSdat(bytes)).payload;
      this.opened.set(this.object(receiver), { path, mode, stream: new MemoryFile(payload), sdat });
      return jv('int', 1);
    });
    jvm.natives.register(owner, 'close', [], ({ receiver }) => {
      this.close(receiver); return voidValue();
    });
    jvm.natives.register(owner, 'write', ['int'], ({ receiver, args }) =>
      jv('int', this.write(receiver, stream => { stream.writeInt(Number(args[0].value)); return 4; })));
    jvm.natives.register(owner, 'write', ['float'], ({ receiver, args }) =>
      jv('int', this.write(receiver, stream => { stream.writeFloat(Number(args[0].value)); return 4; })));
    jvm.natives.register(owner, 'write', ['String'], ({ receiver, args }) =>
      jv('int', this.write(receiver, stream => {
        const text = args[0].value == null ? null : String(args[0].value);
        const before = stream.position;
        stream.writeString(text);
        return text === null ? 0 : stream.position - before - 4;
      })));
    jvm.natives.register(owner, 'write', ['ResourceRef'], ({ receiver, args }) =>
      jv('int', this.write(receiver, stream => {
        const resource = args[0].value == null ? null : this.resources.getResource(args[0]);
        if (resource?.resourceId) throw new Error('File.write(ResourceRef) needs SDAT resource remount support');
        stream.writeInt(resource?.resourceId ?? 0);
        return 4;
      })));
    jvm.natives.register(owner, 'readInt', [], ({ receiver }) =>
      jv('int', this.read(receiver, stream => stream.position + 4 <= stream.size ? stream.readInt() : 0, 0)));
    jvm.natives.register(owner, 'readFloat', [], ({ receiver }) =>
      jv('float', this.read(receiver, stream => stream.position + 4 <= stream.size ? stream.readFloat() : 0, 0)));
    jvm.natives.register(owner, 'readResID', [], ({ receiver }) =>
      jv('int', this.read(receiver, stream => {
        if (stream.position + 4 > stream.size) return 0;
        const id = stream.readInt();
        const file = this.opened.get(this.object(receiver));
        if (id && file?.sdat && (file.sdat.packs.size || file.sdat.unsaved.length))
          throw new Error('File.readResID() needs SDAT resource remount support');
        return id;
      }, 0)));
    jvm.natives.register(owner, 'readString', [], ({ receiver }) =>
      jv('String', this.read(receiver, stream => stream.position + 4 <= stream.size ? stream.readString() : null, null)));
    jvm.natives.register(owner, 'exists', ['String'], ({ args }) =>
      jv('int', this.fs.exists(String(args[0].value ?? '')) ? 1 : 0));
    jvm.natives.register(owner, 'delete', ['String'], ({ args }) =>
      jv('int', this.fs.delete(String(args[0].value ?? '')) ? 0 : -1));
    jvm.natives.register(owner, 'copy', ['String', 'String'], ({ args }) =>
      jv('int', this.fs.copy(String(args[0].value ?? ''), String(args[1].value ?? '')) ? 0 : -1));
    jvm.natives.register(owner, 'move', ['String', 'String'], ({ args }) =>
      jv('int', this.fs.move(String(args[0].value ?? ''), String(args[1].value ?? '')) ? 0 : -1));
  }

  private close(receiver: JavaValue): void {
    const object = this.object(receiver);
    const file = this.opened.get(object);
    if (!file) return;
    this.opened.delete(object);
    if (file.mode === 1) this.fs.write(file.path, serializeSdat({ type: 2, flags: 0,
      payload: file.stream.toBytes(), packs: new Map(), unsaved: [] }));
  }

  private write(receiver: JavaValue, action: (stream: MemoryFile) => number): number {
    const file = this.opened.get(this.object(receiver));
    return file?.mode === 1 ? action(file.stream) : 0;
  }

  private read<T>(receiver: JavaValue, action: (stream: MemoryFile) => T, fallback: T): T {
    const file = this.opened.get(this.object(receiver));
    return file?.mode === 0 ? action(file.stream) : fallback;
  }

  private path(receiver: JavaValue): string | null {
    const value = this.object(receiver).fields.get('name')?.value;
    return typeof value === 'string' && value ? value : null;
  }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`File receiver is not a Java object: ${receiver.type}`);
    return object;
  }
}
