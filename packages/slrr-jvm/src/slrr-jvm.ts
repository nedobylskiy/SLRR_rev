import { JavaSourceMachine, coerce, jv, parseSourceClass, type JavaHost, type JavaValue, type ResourceIdentity, type SourceClass } from './java-source.js';
import { JavaNativeRegistry } from './native.js';
import { parseSource as parseSlrrSource } from 'slrr-jvm-compiler';
import type { Expr as ParsedExpr, FloatMode, SourceClass as ParsedClass, Stmt as ParsedStmt } from 'slrr-jvm-compiler';

export interface ImportRequest { className: string; importedBy?: string }
export interface SourceLocation { path: string; source?: string }
export interface SlrrJvmOptions {
  /** Maps a Java class name to a source file; null means no source at this name. */
  resolveImport(request: ImportRequest): SourceLocation | null | Promise<SourceLocation | null>;
  /** Optional when resolveImport always supplies source. No filesystem is built into the package. */
  readSource?(path: string): string | Promise<string>;
  /** Optional eager parsing filter. Other source methods are parsed when first called. */
  selectMethods?(className: string): Iterable<string> | undefined;
  /** Float literal conversion observed in a particular SLRR build; B is the Build 940 default. */
  floatMode?: FloatMode;
  /** Allow the SLRR source dialect to narrow a float variable when only an int overload exists. */
  allowNumericNarrowing?: boolean;
  /** Resolve a resource literal to the integer used by the source file's owning RPK. */
  resolveResourceId?(resource: ResourceIdentity, sourcePath: string): number | undefined;
  budget?: number;
  maxDepth?: number;
}

export interface JavaObject { className: string; fields: Map<string, JavaValue> }
interface LoadedClass { name: string; path: string; source: string; sourceMethods: Set<string>; hintedMethods: Set<string>; parsed: SourceClass; imports: Map<string, string>; nativeMethods: { name: string; parameters: string[] }[] }
type SourceExpression = NonNullable<SourceClass['fields'][number]['expr']>;

function sourceTypeHints(cls: ParsedClass, selected: Set<string>): Set<string> {
  const hints = new Set<string>();
  const add = (name?: string, allowLowerCase = false): void => {
    const simple = name?.replace(/\[\]$/g, '').split('.').at(-1);
    if (simple && (allowLowerCase ? /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(simple)
      && !['void', 'boolean', 'byte', 'short', 'int', 'long', 'float', 'double', 'char'].includes(simple)
      : /^[A-Z][A-Za-z0-9_$]*$/.test(simple))) hints.add(simple);
  };
  const expression = (expr?: ParsedExpr): void => {
    if (!expr) return;
    if (['new', 'newarray', 'cast'].includes(expr.kind)) add(expr.text, true);
    if (expr.kind === 'instanceof') add(expr.right?.text);
    if (expr.kind === 'member') {
      let head: ParsedExpr = expr;
      while (head.kind === 'member') head = head.left!;
      if (head.kind === 'name') add(head.text);
    }
    expression(expr.left); expression(expr.right); expression(expr.third);
    for (const arg of expr.args ?? []) expression(arg);
  };
  const statement = (stmt?: ParsedStmt): void => {
    if (!stmt) return;
    expression(stmt.expr);
    statement(stmt.body); statement(stmt.elseBody); statement(stmt.init);
    for (const item of stmt.items ?? []) statement(item);
    for (const update of stmt.update ?? []) expression(update);
    for (const field of stmt.declarations ?? []) { add(field.type, true); expression(field.initial); }
    for (const entry of stmt.cases ?? []) { expression(entry.value); for (const item of entry.items) statement(item); }
  };
  add(cls.parent, true);
  for (const implemented of cls.interfaces) add(implemented, true);
  for (const member of cls.members) {
    if (member.kind === 'field') expression(member.initial);
    else if (selected.has(member.name)) {
      add(member.result, true);
      for (const parameter of member.params) add(parameter.type, true);
      statement(member.body);
    }
  }
  return hints;
}

/** Source-only SLRR Java dialect runtime. It never reads TUFA/.class files. */
export class SlrrJvm implements JavaHost {
  readonly natives = new JavaNativeRegistry();
  private readonly machine: JavaSourceMachine;
  private readonly classes = new Map<string, LoadedClass>();
  private readonly loading = new Map<string, Promise<SourceClass | null>>();
  private readonly aliases = new Map<string, string>();
  private readonly sourceLocations = new Map<string, SourceLocation>();
  private readonly globals = new Map<string, JavaValue>();
  private readonly activeClasses: string[] = [];
  private readonly staticFields = new Map<string, Map<string, JavaValue>>();
  private readonly initializing = new Set<string>();
  private readonly instanceInitialized = new WeakMap<JavaObject, Set<string>>();
  private readonly asyncInitializing = new Map<string, Promise<void>>();

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
    const location = this.sourceLocations.get(className) ?? await this.options.resolveImport({ className, importedBy });
    if (!location) {
      if (this.natives.hasClass(className)) { this.aliases.set(className.split('.').at(-1)!, className); return null; }
      throw new Error(`Java import unresolved: ${className}${importedBy ? ` from ${importedBy}` : ''}`);
    }
    if (!location.path) throw new Error(`Java import has no path: ${className}`);
    const source = location.source ?? await this.options.readSource?.(location.path);
    if (source === undefined) throw new Error(`No source reader for ${location.path}`);
    const program = parseSlrrSource(source);
    const shortName = className.split('.').at(-1)!;
    const declaration = program.classes.find(cls => cls.fullName === className);
    if (!declaration) throw new Error(`Java class missing in ${location.path}: ${className}`);
    for (const cls of program.classes) this.sourceLocations.set(cls.fullName, { path: location.path, source });
    const selectedNames = this.options.selectMethods?.(className);
    const selected = selectedNames ? new Set(selectedNames) : undefined;
    const parsed = parseSourceClass(source, selected, shortName, this.options.floatMode ?? 'B',
      resource => this.options.resolveResourceId?.(resource, location.path));
    const imports = new Map<string, string>();
    const nativeMethods = declaration.members.flatMap(member => member.kind === 'method' && member.flags.includes('native')
      ? [{ name: member.name, parameters: member.params.map(parameter => parameter.type) }] : []);
    const sourceMethods = new Set(declaration.members.flatMap(member => member.kind === 'method' && member.body ? [member.name] : []));
    const hintedMethods = selected ?? new Set(sourceMethods);
    const entry: LoadedClass = { name: className, path: location.path, source, sourceMethods, hintedMethods, parsed, imports, nativeMethods };
    this.classes.set(className, entry);
    this.aliases.set(shortName, className);
    try {
      const wildcards: string[] = [];
      for (const imported of program.imports) {
        if (imported.endsWith('.*')) { wildcards.push(imported.slice(0, -2)); continue; }
        const dependency = imported, alias = dependency.split('.').at(-1)!;
        if (imports.has(alias) && imports.get(alias) !== dependency) throw new Error(`Ambiguous Java import ${alias}`);
        imports.set(alias, dependency);
        await this.loadClass(dependency, location.path);
      }
      await this.loadTypeHints(entry, declaration, hintedMethods, program, wildcards);
      if (parsed.parent) {
        const parent = imports.get(parsed.parent) ?? (program.packageName ? `${program.packageName}.${parsed.parent}` : parsed.parent);
        if (!this.classes.has(parent) && !this.natives.hasClass(parent)) await this.loadClass(parent, location.path);
      }
      return parsed;
    } catch (error) {
      this.classes.delete(className);
      if (this.aliases.get(shortName) === className) this.aliases.delete(shortName);
      throw error;
    }
  }

  private async loadTypeHints(entry: LoadedClass, declaration: ParsedClass, selected: Set<string>,
    program: ReturnType<typeof parseSlrrSource>, wildcards: string[]): Promise<void> {
    for (const simple of sourceTypeHints(declaration, selected)) {
      const sibling = program.classes.find(cls => cls.name === simple);
      if (sibling && sibling.fullName !== entry.name) { await this.loadClass(sibling.fullName, entry.path); continue; }
      if (entry.imports.has(simple) || sibling || simple === declaration.name || simple === 'String' || simple === 'Object') continue;
      const candidates = [program.packageName, 'java.lang', ...wildcards].filter(Boolean).map(prefix => `${prefix}.${simple}`);
      for (const candidate of candidates) {
        const resolved = await this.options.resolveImport({ className: candidate, importedBy: entry.path });
        if (!resolved && !this.natives.hasClass(candidate)) continue;
        entry.imports.set(simple, candidate);
        await this.loadClass(candidate, entry.path);
        break;
      }
    }
  }

  construct(name: string, args: JavaValue[]): JavaValue {
    const className = this.resolveName(name), entry = this.classes.get(className);
    if (!entry) {
      const native = this.natives.invoke(className, '<init>', jv('class', className), args);
      if (native) return native;
      throw new Error(`Java constructor/native missing: ${className}(${args.map(arg => arg.type).join(',')})`);
    }
    this.ensureInitialized(entry);
    const object: JavaObject = { className, fields: new Map() }, receiver = jv(entry.parsed.name, object);
    this.instanceInitialized.set(object, new Set());
    this.runConstructor(receiver, entry, args);
    return receiver;
  }

  /** Execute a Java constructor, allowing native calls in its body to resolve asynchronously. */
  async constructAsync(name: string, args: JavaValue[]): Promise<JavaValue> {
    const className = this.resolveName(name);
    if (!this.classes.has(className) && this.sourceLocations.has(className)) await this.loadClass(className);
    const entry = this.classes.get(className);
    if (!entry) {
      const native = await this.natives.invokeAsync(className, '<init>', jv('class', className), args);
      if (native) return native;
      throw new Error(`Java constructor/native missing: ${className}(${args.map(arg => arg.type).join(',')})`);
    }
    await this.ensureInitializedAsync(entry);
    const object: JavaObject = { className, fields: new Map() }, receiver = jv(entry.parsed.name, object);
    this.instanceInitialized.set(object, new Set());
    await this.runConstructorAsync(receiver, entry, args);
    return receiver;
  }

  private async runConstructorAsync(receiver: JavaValue, entry: LoadedClass, args: JavaValue[]): Promise<JavaValue> {
    const constructors = entry.parsed.methods.filter(method => method.name === entry.parsed.name);
    const ctor = this.selectMethod(constructors, args, entry.name);
    if (!ctor && this.natives.canInvoke(entry.name, '<init>', args,
      (parameter, argument) => this.parameterScore(parameter, argument))) {
      if (entry.parsed.parent) await this.constructorCallAsync(receiver, entry.name, 'super', []);
      await this.initializeInstanceFieldsAsync(entry, receiver);
      return (await this.natives.invokeAsync(entry.name, '<init>', receiver, args,
        (parameter, argument) => this.parameterScore(parameter, argument)))!;
    }
    if (!ctor && args.length && constructors.length) throw new Error(`Java constructor missing: ${entry.name}(${args.length})`);
    if (!ctor && args.length && !entry.parsed.parent) throw new Error(`Java constructor missing: ${entry.name}(${args.length})`);
    const first = ctor?.body.kind === 'block' ? ctor.body.statements?.[0] : ctor?.body;
    const explicit = first?.kind === 'expr' && first.expr?.kind === 'call' && first.expr.left?.kind === 'name' && ['super', 'this'].includes(first.expr.left.text ?? '');
    if (explicit && first.expr?.left?.text === 'super') this.prepareSuperArgumentFields(entry, receiver, first.expr.items ?? []);
    if (!explicit) {
      if (entry.parsed.parent) await this.constructorCallAsync(receiver, entry.name, 'super', ctor ? [] : args);
      await this.initializeInstanceFieldsAsync(entry, receiver);
    }
    return ctor ? this.invokeSourceAsync(entry, ctor, receiver, args) : jv('void', undefined);
  }

  private async initializeInstanceFieldsAsync(entry: LoadedClass, receiver: JavaValue): Promise<void> {
    const object = this.object(receiver);
    if (!object) throw new Error('Java constructor receiver is not an object');
    const initialized = this.instanceInitialized.get(object);
    if (!initialized) throw new Error('Java constructor receiver is not tracked');
    if (initialized.has(entry.name)) return;
    initialized.add(entry.name);
    this.activeClasses.push(entry.name);
    try { await this.machine.initializeFieldsAsync(entry.parsed, receiver); }
    finally { this.activeClasses.pop(); }
  }

  private runConstructor(receiver: JavaValue, entry: LoadedClass, args: JavaValue[]): JavaValue {
    const constructors = entry.parsed.methods.filter(method => method.name === entry.parsed.name);
    const ctor = this.selectMethod(constructors, args, entry.name);
    if (!ctor && this.natives.canInvoke(entry.name, '<init>', args,
      (parameter, argument) => this.parameterScore(parameter, argument))) {
      if (entry.parsed.parent) this.constructorCall(receiver, entry.name, 'super', []);
      this.initializeInstanceFields(entry, receiver);
      return this.natives.invoke(entry.name, '<init>', receiver, args,
        (parameter, argument) => this.parameterScore(parameter, argument))!;
    }
    if (!ctor && args.length && constructors.length) throw new Error(`Java constructor missing: ${entry.name}(${args.length})`);
    if (!ctor && args.length && !entry.parsed.parent) throw new Error(`Java constructor missing: ${entry.name}(${args.length})`);
    const first = ctor?.body.kind === 'block' ? ctor.body.statements?.[0] : ctor?.body;
    const explicit = first?.kind === 'expr' && first.expr?.kind === 'call' && first.expr.left?.kind === 'name' && ['super', 'this'].includes(first.expr.left.text ?? '');
    if (explicit && first.expr?.left?.text === 'super') this.prepareSuperArgumentFields(entry, receiver, first.expr.items ?? []);
    if (!explicit) {
      if (entry.parsed.parent) this.constructorCall(receiver, entry.name, 'super', ctor ? [] : args);
      this.initializeInstanceFields(entry, receiver);
    }
    return ctor ? this.invokeSource(entry, ctor, receiver, args) : jv('void', undefined);
  }

  private initializeInstanceFields(entry: LoadedClass, receiver: JavaValue): void {
    const object = this.object(receiver);
    if (!object) throw new Error('Java constructor receiver is not an object');
    const initialized = this.instanceInitialized.get(object);
    if (!initialized) throw new Error('Java constructor receiver is not tracked');
    if (initialized.has(entry.name)) return;
    initialized.add(entry.name);
    this.activeClasses.push(entry.name);
    try { this.machine.initializeFields(entry.parsed, receiver); }
    finally { this.activeClasses.pop(); }
  }

  /** SLRR's source dialect permits literal instance fields in explicit super arguments. */
  private prepareSuperArgumentFields(entry: LoadedClass, receiver: JavaValue, arguments_: SourceExpression[]): void {
    const names = new Set<string>();
    const visit = (expr?: SourceExpression): void => {
      if (!expr) return;
      if (expr.kind === 'name' && expr.text) names.add(expr.text);
      visit(expr.left);
      visit(expr.right);
      visit(expr.extra);
      for (const item of expr.items ?? []) visit(item);
    };
    for (const argument of arguments_) visit(argument);
    for (const field of entry.parsed.fields) {
      if (!field.isStatic && names.has(field.name) && field.expr?.kind === 'literal' && field.expr.value)
        this.set(receiver, field.name, field.expr.value);
    }
  }

  constructorCall(receiver: JavaValue, fromClass: string, target: 'super' | 'this', args: JavaValue[]): JavaValue {
    const caller = this.resolveName(fromClass);
    const className = target === 'this' ? caller : this.parent(caller);
    if (!className) throw new Error(`Java parent constructor missing: ${caller}`);
    const entry = this.classes.get(className);
    if (entry) {
      const { selected, skipped } = this.resolveSuperConstructor(entry, target, args);
      const result = this.runConstructor(receiver, selected, args);
      for (const skippedEntry of skipped.reverse()) this.initializeInstanceFields(skippedEntry, receiver);
      if (target === 'super') this.initializeInstanceFields(this.classes.get(caller)!, receiver);
      return result;
    }
    const native = this.natives.invoke(className, '<init>', receiver, args);
    if (native) {
      if (target === 'super') this.initializeInstanceFields(this.classes.get(caller)!, receiver);
      return native;
    }
    if (className === 'java.lang.Object' && args.length === 0) {
      if (target === 'super') this.initializeInstanceFields(this.classes.get(caller)!, receiver);
      return jv('void', undefined);
    }
    throw new Error(`Native constructor missing: ${className}(${args.map(arg => arg.type).join(',')})`);
  }

  async constructorCallAsync(receiver: JavaValue, fromClass: string, target: 'super' | 'this', args: JavaValue[]): Promise<JavaValue> {
    const caller = this.resolveName(fromClass);
    const className = target === 'this' ? caller : this.parent(caller);
    if (!className) throw new Error(`Java parent constructor missing: ${caller}`);
    const entry = this.classes.get(className);
    if (entry) {
      const { selected, skipped } = this.resolveSuperConstructor(entry, target, args);
      const result = await this.runConstructorAsync(receiver, selected, args);
      for (const skippedEntry of skipped.reverse()) await this.initializeInstanceFieldsAsync(skippedEntry, receiver);
      if (target === 'super') await this.initializeInstanceFieldsAsync(this.classes.get(caller)!, receiver);
      return result;
    }
    const native = await this.natives.invokeAsync(className, '<init>', receiver, args);
    if (native) {
      if (target === 'super') await this.initializeInstanceFieldsAsync(this.classes.get(caller)!, receiver);
      return native;
    }
    if (className === 'java.lang.Object' && args.length === 0) {
      if (target === 'super') await this.initializeInstanceFieldsAsync(this.classes.get(caller)!, receiver);
      return jv('void', undefined);
    }
    throw new Error(`Native constructor missing: ${className}(${args.map(arg => arg.type).join(',')})`);
  }

  /** Some SLRR decompilations call a grandparent's constructor through super(...). */
  private resolveSuperConstructor(entry: LoadedClass, target: 'super' | 'this', args: JavaValue[]):
    { selected: LoadedClass; skipped: LoadedClass[] } {
    if (target !== 'super' || !args.length) return { selected: entry, skipped: [] };
    const constructors = entry.parsed.methods.filter(method => method.name === entry.parsed.name);
    if (!constructors.length || this.selectMethod(constructors, args, entry.name))
      return { selected: entry, skipped: [] };
    const skipped: LoadedClass[] = [entry];
    for (let current = entry; current.parsed.parent;) {
      const parent = current.parsed.parent;
      const ancestor = this.classes.get(current.imports.get(parent) ?? this.resolveName(parent));
      if (!ancestor) break;
      const candidates = ancestor.parsed.methods.filter(method => method.name === ancestor.parsed.name);
      if (this.selectMethod(candidates, args, ancestor.name)) return { selected: ancestor, skipped };
      skipped.push(ancestor);
      current = ancestor;
    }
    return { selected: entry, skipped: [] };
  }

  invoke(receiver: JavaValue, method: string, args: JavaValue[] = []): JavaValue {
    return this.call(receiver, method, args);
  }

  /** Resume Java source execution after Promise-returning native calls. */
  invokeAsync(receiver: JavaValue, method: string, args: JavaValue[] = []): Promise<JavaValue> {
    return this.callAsync(receiver, method, args);
  }

  global(name: string): JavaValue {
    const value = this.globals.get(name);
    if (value) return value;
    const className = this.resolveName(name);
    if (this.classes.has(className) || this.natives.hasClass(className)) {
      const entry = this.classes.get(className);
      if (entry) this.ensureInitialized(entry);
      return jv('class', className);
    }
    throw new Error(`Unknown Java name ${name}`);
  }

  async globalAsync(name: string): Promise<JavaValue> {
    const value = this.globals.get(name);
    if (value) return value;
    const className = this.resolveName(name);
    if (this.classes.has(className) || this.natives.hasClass(className)) {
      const entry = this.classes.get(className);
      if (entry) await this.ensureInitializedAsync(entry);
      return jv('class', className);
    }
    throw new Error(`Unknown Java name ${name}`);
  }

  async getAsync(receiver: JavaValue, name: string): Promise<JavaValue> {
    if (receiver.type === 'class') {
      const entry = this.classes.get(this.resolveName(String(receiver.value)));
      if (entry) for (const cls of this.lineage(entry)) await this.ensureInitializedAsync(cls);
    } else {
      const object = this.object(receiver), entry = object && this.classes.get(object.className);
      if (entry && !object!.fields.has(name)) for (const cls of this.lineage(entry))
        if (cls.parsed.fields.some(field => field.isStatic && field.name === name))
          await this.ensureInitializedAsync(cls);
    }
    return this.get(receiver, name);
  }

  get(receiver: JavaValue, name: string): JavaValue {
    if (Array.isArray(receiver.value) && name === 'length') return jv('int', receiver.value.length);
    if (receiver.type === 'ResourceRef' && name === 'typeID' && receiver.value && typeof receiver.value === 'object' && 'id' in receiver.value)
      return jv('int', Number(receiver.value.id));
    const object = this.object(receiver);
    if (object) {
      const field = object.fields.get(name);
      if (field) return field;
      const entry = this.classes.get(object.className);
      for (const cls of entry ? this.lineage(entry) : []) {
        if (cls.parsed.fields.some(candidate => candidate.isStatic && candidate.name === name))
          return this.get(jv('class', cls.name), name);
      }
      throw new Error(`Missing Java field ${object.className}.${name}`);
    }
    if (receiver.type === 'class') {
      const className = this.resolveName(String(receiver.value));
      const nativeField = this.natives.getField(className, name);
      if (nativeField) return nativeField;
      const entry = this.classes.get(className);
      for (const cls of entry ? this.lineage(entry) : []) {
        this.ensureInitialized(cls);
        const stored = this.staticFields.get(cls.name)?.get(name);
        if (stored) return stored;
        const constant = cls.parsed.constants.get(name);
        if (constant) return constant;
      }
    }
    throw new Error(`Missing Java field ${receiver.type}.${name}`);
  }

  set(receiver: JavaValue, name: string, value: JavaValue): void {
    if (receiver.type === 'class') {
      const className = this.resolveName(String(receiver.value));
      if (this.natives.setField(className, name, value)) return;
      const entry = this.classes.get(className);
      for (const cls of entry ? this.lineage(entry) : []) {
        const field = cls.parsed.fields.find(candidate => candidate.isStatic && candidate.name === name);
        if (field) { this.staticFields.get(cls.name)?.set(name, coerce(field.type, value)); return; }
      }
      throw new Error(`Undeclared Java static field ${String(receiver.value)}.${name}`);
    }
    const object = this.object(receiver), previous = object?.fields.get(name);
    if (object && !previous) {
      const entry = this.classes.get(object.className);
      const declaration = entry && this.lineage(entry).flatMap(cls => cls.parsed.fields).find(field => !field.isStatic && field.name === name);
      if (declaration) { object.fields.set(name, coerce(declaration.type, value)); return; }
      for (const cls of entry ? this.lineage(entry) : []) {
        if (cls.parsed.fields.some(field => field.isStatic && field.name === name)) {
          this.set(jv('class', cls.name), name, value);
          return;
        }
      }
    }
    if (!object || !previous) throw new Error(`Undeclared Java field ${receiver.type}.${name}`);
    object.fields.set(name, coerce(previous.type, value));
  }

  call(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): JavaValue {
    const object = this.object(receiver);
    const className = fromClass ? this.resolveName(fromClass) : object?.className ?? (receiver.type === 'class' ? this.resolveName(String(receiver.value)) : this.natives.hasClass(this.resolveName(receiver.type)) ? this.resolveName(receiver.type) : undefined);
    if (!className) throw new Error(`Java call target unavailable: ${receiver.type}.${name}`);
    const argumentTypes = args.map(arg => arg.type);
    const visited = new Set<string>();
    for (let current: string | null = className; current; current = this.classes.has(current) ? this.parent(current) : null) {
      if (visited.has(current)) throw new Error(`Java inheritance cycle at ${current}`);
      visited.add(current);
      const entry = this.classes.get(current);
      if (entry) {
        this.ensureInitialized(entry);
        if (entry.sourceMethods.has(name) && !entry.parsed.methods.some(method => method.name === name)) {
          const parsed = parseSourceClass(entry.source, new Set([name]), entry.name.split('.').at(-1), this.options.floatMode ?? 'B',
            resource => this.options.resolveResourceId?.(resource, entry.path));
          entry.parsed.methods.push(...parsed.methods.filter(method => method.name === name));
        }
        const method = this.selectMethod(entry.parsed.methods.filter(method => method.name === name), args, entry.name);
        if (method) return this.invokeSource(entry, method, receiver, args);
      }
      const native = this.natives.invoke(current, name, receiver, args, (parameter, argument) => this.parameterScore(parameter, argument));
      if (native) return native;
    }
    for (const current of visited) {
      const declared = this.classes.get(current)?.nativeMethods.some(method => method.name === name
        && method.parameters.length === args.length
        && method.parameters.every((parameter, index) => Number.isFinite(this.parameterScore(parameter, args[index]))));
      if (declared) throw new Error(`Java native implementation missing: ${current}.${name}(${argumentTypes.join(',')})`);
    }
    throw new Error(`Java method/native missing: ${className}.${name}(${argumentTypes.join(',')})`);
  }

  async callAsync(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): Promise<JavaValue> {
    const object = this.object(receiver);
    const className = fromClass ? this.resolveName(fromClass) : object?.className ?? (receiver.type === 'class' ? this.resolveName(String(receiver.value)) : this.natives.hasClass(this.resolveName(receiver.type)) ? this.resolveName(receiver.type) : undefined);
    if (!className) throw new Error(`Java call target unavailable: ${receiver.type}.${name}`);
    const argumentTypes = args.map(arg => arg.type), visited = new Set<string>();
    for (let current: string | null = className; current; current = this.classes.has(current) ? this.parent(current) : null) {
      if (visited.has(current)) throw new Error(`Java inheritance cycle at ${current}`);
      visited.add(current);
      const entry = this.classes.get(current);
      if (entry) {
        await this.ensureInitializedAsync(entry);
        if (entry.sourceMethods.has(name) && !entry.parsed.methods.some(method => method.name === name)) {
          const parsed = parseSourceClass(entry.source, new Set([name]), entry.name.split('.').at(-1), this.options.floatMode ?? 'B',
            resource => this.options.resolveResourceId?.(resource, entry.path));
          entry.parsed.methods.push(...parsed.methods.filter(method => method.name === name));
        }
        if (entry.sourceMethods.has(name) && !entry.hintedMethods.has(name)) {
          const program = parseSlrrSource(entry.source);
          const declaration = program.classes.find(cls => cls.fullName === entry.name)!;
          await this.loadTypeHints(entry, declaration, new Set([name]), program,
            program.imports.filter(imported => imported.endsWith('.*')).map(imported => imported.slice(0, -2)));
          entry.hintedMethods.add(name);
        }
        const method = this.selectMethod(entry.parsed.methods.filter(method => method.name === name), args, entry.name);
        if (method) return this.invokeSourceAsync(entry, method, receiver, args);
      }
      const native = await this.natives.invokeAsync(current, name, receiver, args,
        (parameter, argument) => this.parameterScore(parameter, argument));
      if (native) return native;
    }
    for (const current of visited) {
      const declared = this.classes.get(current)?.nativeMethods.some(method => method.name === name
        && method.parameters.length === args.length
        && method.parameters.every((parameter, index) => Number.isFinite(this.parameterScore(parameter, args[index]))));
      if (declared) throw new Error(`Java native implementation missing: ${current}.${name}(${argumentTypes.join(',')})`);
    }
    throw new Error(`Java method/native missing: ${className}.${name}(${argumentTypes.join(',')})`);
  }

  parent(name: string): string | null {
    const entry = this.classes.get(this.resolveName(name));
    if (!entry) return null;
    if (!entry.parsed.parent) return entry.name === 'java.lang.Object' ? null : 'java.lang.Object';
    return entry.imports.get(entry.parsed.parent) ?? this.resolveName(entry.parsed.parent);
  }

  isInstance(receiver: JavaValue, name: string): boolean {
    const object = this.object(receiver);
    if (!object) return false;
    const wanted = this.resolveName(name);
    const entry = this.classes.get(object.className);
    return entry ? this.lineage(entry).some(cls => cls.name === wanted || this.implementsInterface(cls, wanted)) : object.className === wanted;
  }

  private object(value: JavaValue): JavaObject | null {
    const obj = value.value;
    return obj && typeof obj === 'object' && 'className' in obj && 'fields' in obj && (obj as JavaObject).fields instanceof Map ? obj as JavaObject : null;
  }

  private ensureInitialized(entry: LoadedClass): void {
    if (this.staticFields.has(entry.name)) return;
    if (this.initializing.has(entry.name)) return;
    this.initializing.add(entry.name);
    try {
      const parent = this.parent(entry.name);
      if (parent) { const parentEntry = this.classes.get(parent); if (parentEntry) this.ensureInitialized(parentEntry); }
      const values = new Map<string, JavaValue>();
      for (const field of entry.parsed.fields.filter(field => field.isStatic))
        values.set(field.name, jv(field.type, ['int', 'float', 'double'].includes(field.type) ? 0 : null));
      this.staticFields.set(entry.name, values);
      this.activeClasses.push(entry.name);
      try { this.machine.initializeFields(entry.parsed, jv('class', entry.name), true); }
      finally { this.activeClasses.pop(); }
    } catch (error) {
      this.staticFields.delete(entry.name);
      throw error;
    } finally { this.initializing.delete(entry.name); }
  }

  private async ensureInitializedAsync(entry: LoadedClass): Promise<void> {
    // A static field initializer may refer back to its own class. Defaults are already visible.
    if (this.staticFields.has(entry.name) && this.activeClasses.includes(entry.name)) return;
    const pending = this.asyncInitializing.get(entry.name);
    if (pending) { await pending; return; }
    if (this.staticFields.has(entry.name)) return;
    const task = this.initializeClassAsync(entry);
    this.asyncInitializing.set(entry.name, task);
    try { await task; }
    finally { this.asyncInitializing.delete(entry.name); }
  }

  private async initializeClassAsync(entry: LoadedClass): Promise<void> {
    const parent = this.parent(entry.name);
    if (parent) { const parentEntry = this.classes.get(parent); if (parentEntry) await this.ensureInitializedAsync(parentEntry); }
    const values = new Map<string, JavaValue>();
    for (const field of entry.parsed.fields.filter(field => field.isStatic))
      values.set(field.name, jv(field.type, ['int', 'float', 'double'].includes(field.type) ? 0 : null));
    this.staticFields.set(entry.name, values);
    this.activeClasses.push(entry.name);
    try { await this.machine.initializeFieldsAsync(entry.parsed, jv('class', entry.name), true); }
    catch (error) { this.staticFields.delete(entry.name); throw error; }
    finally { this.activeClasses.pop(); }
  }

  private parameterScore(parameter: string, argument: JavaValue): number {
    if (argument.value === null) return ['int', 'float', 'double', 'boolean', 'byte', 'short', 'char', 'long'].includes(parameter) ? Infinity : 5;
    if (parameter === 'int' && argument.type === 'ResourceRef' && typeof argument.value === 'object'
      && 'id' in argument.value && !('fields' in argument.value)) return 1;
    if (parameter === argument.type || this.resolveName(parameter) === this.resolveName(argument.type)) return 0;
    if (argument.type === 'int' && parameter === 'float') return 1;
    if ((parameter === 'String' || parameter === 'java.lang.String')
      && argument.type === 'Object' && typeof argument.value === 'string') return 1;
    if (argument.type === 'int' && parameter === 'double') return 2;
    if (argument.type === 'float' && parameter === 'double') return 1;
    if (parameter === 'int' && ['float', 'double'].includes(argument.type) && argument.numericLiteral) return 4;
    if (this.options.allowNumericNarrowing && parameter === 'int' && ['float', 'double'].includes(argument.type)) return 6;
    if (parameter === 'Object' || parameter === 'java.lang.Object') return 20;
    const object = this.object(argument), entry = object && this.classes.get(object.className);
    if (entry) {
      const wanted = this.resolveName(parameter), lineage = this.lineage(entry);
      const distance = lineage.findIndex(cls => cls.name === wanted);
      if (distance >= 0) return distance;
      const implementedAt = lineage.findIndex(cls => this.implementsInterface(cls, wanted));
      if (implementedAt >= 0) return implementedAt + 1;
    }
    return Infinity;
  }

  private implementsInterface(entry: LoadedClass, wanted: string): boolean {
    return entry.parsed.interfaces.some(name => entry.imports.get(name) === wanted || this.resolveName(name) === wanted);
  }

  private selectMethod(methods: SourceClass['methods'], args: JavaValue[], owner: string): SourceClass['methods'][number] | undefined {
    const ranked = methods.filter(method => method.parameters.length === args.length).map(method => ({
      method,
      score: method.parameters.reduce((total, parameter, i) => total + this.parameterScore(parameter.type, args[i]), 0),
    })).filter(candidate => Number.isFinite(candidate.score)).sort((a, b) => a.score - b.score);
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
      const tied = ranked.filter(candidate => candidate.score === ranked[0].score);
      const signature = (method: SourceClass['methods'][number]) => method.parameters.map(parameter => parameter.type).join(',');
      if (tied.every(candidate => signature(candidate.method) === signature(tied[0].method)))
        return tied.at(-1)?.method;
      throw new Error(`Ambiguous Java source overload: ${owner}.${ranked[0].method.name}`);
    }
    return ranked[0]?.method;
  }

  private resolveName(name: string): string {
    if (this.classes.has(name) || this.natives.hasClass(name)) return name;
    const active = this.classes.get(this.activeClasses.at(-1) ?? '');
    const imported = active?.imports.get(name);
    if (imported) return imported;
    const packageName = active?.name.includes('.') ? active.name.slice(0, active.name.lastIndexOf('.')) : '';
    const sibling = packageName ? `${packageName}.${name}` : name;
    if (this.classes.has(sibling) || this.natives.hasClass(sibling) || this.sourceLocations.has(sibling)) return sibling;
    return this.aliases.get(name) ?? name;
  }

  private invokeSource(entry: LoadedClass, method: SourceClass['methods'][number], receiver: JavaValue, args: JavaValue[]): JavaValue {
    this.activeClasses.push(entry.name);
    try { return this.machine.invoke(method, receiver, args); }
    finally { this.activeClasses.pop(); }
  }

  private async invokeSourceAsync(entry: LoadedClass, method: SourceClass['methods'][number], receiver: JavaValue,
    args: JavaValue[]): Promise<JavaValue> {
    this.activeClasses.push(entry.name);
    try { return await this.machine.invokeAsync(method, receiver, args); }
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
