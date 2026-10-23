export type ScriptValue = null | number | string | boolean | ScriptObject;
export interface ScriptObject { className: string; fields: Map<string, ScriptValue> }
export type NativeImplementation = (receiver: ScriptObject | null, args: ScriptValue[]) => ScriptValue | void;

/** Native calls are identified by full class, method and descriptor, never by name alone. */
export class NativeRegistry {
  private methods = new Map<string, NativeImplementation>();
  private key(className: string, method: string, descriptor: string) { return `${className}#${method}${descriptor}`; }
  register(className: string, method: string, descriptor: string, implementation: NativeImplementation) {
    const key = this.key(className, method, descriptor);
    if (this.methods.has(key)) throw new Error(`Native already registered: ${key}`);
    this.methods.set(key, implementation);
  }
  invoke(className: string, method: string, descriptor: string, receiver: ScriptObject | null, args: ScriptValue[]) {
    const key = this.key(className, method, descriptor), implementation = this.methods.get(key);
    if (!implementation) throw new Error(`Missing native: ${key}`);
    return implementation(receiver, args);
  }
  get signatures() { return [...this.methods.keys()].sort(); }
}

export type FfiType = 'int' | 'uint' | 'uint64' | 'float' | 'double' | 'pointer' | 'string';
export interface LegacyPrototype { result: FfiType; args: FfiType[] }
export function parseLegacyPrototype(format: string): LegacyPrototype {
  const valid = new Set(['int', 'uint', 'uint64', 'float', 'double', 'pointer', 'string']);
  const parts = format.split(':');
  if (parts.length > 2) throw new Error('Invalid DLL prototype: expected result:type;type');
  const result = parts[0], args = parts.length === 2 ? parts[1].split(';') : [];
  if (!valid.has(result) || args.some(t => !valid.has(t))) throw new Error(`Unsupported DLL prototype: ${format}`);
  return { result: result as FfiType, args: args as FfiType[] };
}

/** Synchronous host capability contract matching Object.runDLL. Browser has no Win32 loader. */
export class LegacyDllBridge {
  private exports = new Map<string, { format: string; call: (args: readonly string[]) => string }>();
  private key(library: string, method: string) { return `${library.replaceAll('\\', '/').toLowerCase()}!${method}`; }
  register(library: string, method: string, format: string, call: (args: readonly string[]) => string) {
    parseLegacyPrototype(format);
    const key = this.key(library, method);
    if (this.exports.has(key)) throw new Error(`DLL capability already registered: ${key}`);
    this.exports.set(key, { format, call });
  }
  runDLL(library: string, method: string, format: string, args: readonly string[]) {
    const prototype = parseLegacyPrototype(format);
    if (args.length !== prototype.args.length) throw new Error(`DLL argument count: expected ${prototype.args.length}, received ${args.length}`);
    const key = this.key(library, method), entry = this.exports.get(key);
    if (!entry) throw new Error(`Host DLL capability unavailable: ${key}. A browser cannot load Windows DLLs.`);
    if (entry.format !== format) throw new Error(`DLL prototype mismatch: ${key}`);
    return entry.call(args);
  }
}
