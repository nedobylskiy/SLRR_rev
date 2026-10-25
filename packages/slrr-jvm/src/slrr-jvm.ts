import { JavaSourceMachine, coerce, jv, parseSourceClass, type JavaHost, type JavaValue, type SourceClass } from './java-source.js';
import { JavaNativeRegistry } from './native.js';

export interface ImportRequest { className: string; importedBy?: string }
export interface SourceLocation { path: string; source?: string }
export interface SlrrJvmOptions {
  /** Maps a Java class name to a source file. Return null only for host-native classes. */
  resolveImport(request: ImportRequest): SourceLocation | null | Promise<SourceLocation | null>;
  /** Optional when resolveImport always supplies source. No filesystem is built into the package. */
  readSource?(path: string): string | Promise<string>;
  /** Only selected method bodies are parsed; other Java syntax can remain in the file. */
  selectMethods(className: string): Iterable<string>;
  budget?: number;
  maxDepth?: number;
}

export interface JavaObject { className: string; fields: Map<string, JavaValue> }
interface LoadedClass { name: string; path: string; parsed: SourceClass; imports: Map<string, string> }

/** Source-only SLRR Java dialect runtime. It never reads TUFA/.class files. */
export class SlrrJvm implements JavaHost {
  readonly natives = new JavaNativeRegistry();
  private readonly machine: JavaSourceMachine;
  private readonly classes = new Map<string, LoadedClass>();
  private readonly loading = new Map<string, Promise<SourceClass | null>>();
  private readonly aliases = new Map<string, string>();
  private readonly globals = new Map<string, JavaValue>();
  private readonly activeClasses: string[] = [];

  constructor(readonly options: SlrrJvmOptions) {
    this.machine = new JavaSourceMachine(this, options.budget, options.maxDepth);
  }

  registerGlobal(name: string, value: JavaValue): void {
    if (this.globals.has(name)) throw new Error(`Java global already registered: ${name}`);
    this.globals.set(name, value);
  }

  /** Preloads explicit imports so execution itself stays synchronous. */
  async loadClass(className: string, importedBy?: string): Promise<SourceClass | null> {
    const known = this.classes.get(className);
    if (known) return known.parsed;
    const pending = this.loading.get(className);
    if (pending) return pending;
    const loading = this.loadResolvedClass(className, importedBy);
    this.loading.set(className, loading);
    try { return await loading; }
    finally { this.loading.delete(className); }
  }

  private async loadResolvedClass(className: string, importedBy?: string): Promise<SourceClass | null> {
    const location = await this.options.resolveImport({ className, importedBy });
    if (!location) {
      if (this.natives.hasClass(className)) { this.aliases.set(className.split('.').at(-1)!, className); return null; }
      throw new Error(`Java import unresolved: ${className}${importedBy ? ` from ${importedBy}` : ''}`);
    }
    if (!location.path) throw new Error(`Java import has no path: ${className}`);
    const source = location.source ?? await this.options.readSource?.(location.path);
    if (source === undefined) throw new Error(`No source reader for ${location.path}`);
    const shortName = className.split('.').at(-1)!;
    const declaredPackage = /\bpackage\s+([\w.]+)\s*;/.exec(source)?.[1];
    const declaredName = declaredPackage ? `${declaredPackage}.${shortName}` : shortName;
    if (declaredName !== className) throw new Error(`Java class name mismatch: requested ${className}, found ${declaredName}`);
    const parsed = parseSourceClass(source, new Set(this.options.selectMethods(className)), shortName);
    const imports = new Map<string, string>();
    const entry: LoadedClass = { name: className, path: location.path, parsed, imports };
    this.classes.set(className, entry);
    this.aliases.set(shortName, className);
    try {
      for (const match of source.matchAll(/(?:^|;)\s*import\s+([\w.]+)(\.\*)?\s*;/gm)) {
        if (match[2]) throw new Error(`Wildcard Java import unsupported: ${match[0].trim()}`);
        const dependency = match[1], alias = dependency.split('.').at(-1)!;
        if (imports.has(alias) && imports.get(alias) !== dependency) throw new Error(`Ambiguous Java import ${alias}`);
        imports.set(alias, dependency);
        await this.loadClass(dependency, location.path);
      }
      if (parsed.parent) {
        const parent = imports.get(parsed.parent) ?? (declaredPackage ? `${declaredPackage}.${parsed.parent}` : parsed.parent);
        if (!this.classes.has(parent) && !this.natives.hasClass(parent)) await this.loadClass(parent, location.path);
      }
      return parsed;
    } catch (error) {
      this.classes.delete(className);
      if (this.aliases.get(shortName) === className) this.aliases.delete(shortName);
      throw error;
    }
  }

  construct(name: string, args: JavaValue[]): JavaValue {
    const className = this.resolveName(name), entry = this.classes.get(className);
    if (!entry) throw new Error(`Java class not loaded: ${className}`);
    const object: JavaObject = { className, fields: new Map() }, receiver = jv(entry.parsed.name, object);
    for (const cls of this.lineage(entry).reverse()) {
      this.activeClasses.push(cls.name);
      try { this.machine.initializeFields(cls.parsed, receiver); }
      finally { this.activeClasses.pop(); }
    }
    const ctor = entry.parsed.methods.find(method => method.name === entry.parsed.name && method.parameters.length === args.length);
    if (ctor) this.invokeSource(entry, ctor, receiver, args);
    else if (args.length) throw new Error(`Java constructor missing: ${className}(${args.length})`);
    return receiver;
  }

  invoke(receiver: JavaValue, method: string, args: JavaValue[] = []): JavaValue {
    return this.call(receiver, method, args);
  }

  global(name: string): JavaValue {
    const value = this.globals.get(name);
    if (value) return value;
    const className = this.resolveName(name);
    if (this.classes.has(className) || this.natives.hasClass(className)) return jv('class', className);
    throw new Error(`Unknown Java name ${name}`);
  }

  get(receiver: JavaValue, name: string): JavaValue {
    const object = this.object(receiver);
    if (object) {
      const field = object.fields.get(name);
      if (field) return field;
      throw new Error(`Missing Java field ${object.className}.${name}`);
    }
    if (receiver.type === 'class') {
      const entry = this.classes.get(this.resolveName(String(receiver.value)));
      for (const cls of entry ? this.lineage(entry) : []) {
        const constant = cls.parsed.constants.get(name);
        if (constant) return constant;
      }
    }
    throw new Error(`Missing Java field ${receiver.type}.${name}`);
  }

  set(receiver: JavaValue, name: string, value: JavaValue): void {
    const object = this.object(receiver), previous = object?.fields.get(name);
    if (object && !previous) {
      const entry = this.classes.get(object.className);
      const declaration = entry && this.lineage(entry).flatMap(cls => cls.parsed.fields).find(field => field.name === name);
      if (declaration) { object.fields.set(name, coerce(declaration.type, value)); return; }
    }
    if (!object || !previous) throw new Error(`Undeclared Java field ${receiver.type}.${name}`);
    object.fields.set(name, coerce(previous.type, value));
  }

  call(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): JavaValue {
    const object = this.object(receiver);
    const className = fromClass ? this.resolveName(fromClass) : object?.className ?? (receiver.type === 'class' ? this.resolveName(String(receiver.value)) : undefined);
    if (!className) throw new Error(`Java call target unavailable: ${receiver.type}.${name}`);
    const entry = this.classes.get(className);
    for (const cls of entry ? this.lineage(entry) : []) {
      const candidates = cls.parsed.methods.filter(method => method.name === name && method.parameters.length === args.length);
      if (candidates.length > 1) throw new Error(`Ambiguous Java source overload: ${cls.name}.${name}`);
      if (candidates[0]) return this.invokeSource(cls, candidates[0], receiver, args);
      if (this.natives.has(cls.name, name, args.map(arg => arg.type))) return this.natives.invoke(cls.name, name, receiver, args)!;
    }
    if (this.natives.has(className, name, args.map(arg => arg.type))) return this.natives.invoke(className, name, receiver, args)!;
    throw new Error(`Java method/native missing: ${className}.${name}(${args.map(arg => arg.type).join(',')})`);
  }

  parent(name: string): string | null {
    const entry = this.classes.get(this.resolveName(name));
    if (!entry?.parsed.parent) return null;
    return entry.imports.get(entry.parsed.parent) ?? this.resolveName(entry.parsed.parent);
  }

  private object(value: JavaValue): JavaObject | null {
    const obj = value.value;
    return obj && typeof obj === 'object' && 'className' in obj && 'fields' in obj && (obj as JavaObject).fields instanceof Map ? obj as JavaObject : null;
  }

  private resolveName(name: string): string {
    if (this.classes.has(name) || this.natives.hasClass(name)) return name;
    const active = this.classes.get(this.activeClasses.at(-1) ?? '');
    const imported = active?.imports.get(name);
    if (imported) return imported;
    const packageName = active?.name.includes('.') ? active.name.slice(0, active.name.lastIndexOf('.')) : '';
    const sibling = packageName ? `${packageName}.${name}` : name;
    if (this.classes.has(sibling) || this.natives.hasClass(sibling)) return sibling;
    return this.aliases.get(name) ?? name;
  }

  private invokeSource(entry: LoadedClass, method: SourceClass['methods'][number], receiver: JavaValue, args: JavaValue[]): JavaValue {
    this.activeClasses.push(entry.name);
    try { return this.machine.invoke(method, receiver, args); }
    finally { this.activeClasses.pop(); }
  }

  private lineage(entry: LoadedClass): LoadedClass[] {
    const result: LoadedClass[] = [], seen = new Set<string>();
    for (let cls: LoadedClass | undefined = entry; cls; cls = cls.parsed.parent ? this.classes.get(cls.imports.get(cls.parsed.parent) ?? this.resolveName(cls.parsed.parent)) : undefined) {
      if (seen.has(cls.name)) throw new Error(`Java inheritance cycle at ${cls.name}`);
      seen.add(cls.name); result.push(cls);
    }
    return result;
  }
}
