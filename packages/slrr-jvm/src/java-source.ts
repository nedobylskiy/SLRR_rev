/** Restricted, parsed Java source interpreter. No eval/Function or ambient JS access. */
import { parseSource as parseSlrrSource } from 'slrr-jvm-compiler';
import type { Expr as ParsedExpr, Stmt as ParsedStmt, FloatMode } from 'slrr-jvm-compiler';
import { floatLiteralBits } from './float-literal.js';
export interface ResourceIdentity { pack: string; id: number }
export interface JavaValue { type: string; value: unknown; resource?: ResourceIdentity; resourceId?: number; numericLiteral?: boolean }
export const jv = (type: string, value: unknown): JavaValue => ({ type, value });
export const nil = () => jv('Object', null);
type Expr = { kind: string; line: number; text?: string; value?: JavaValue; items?: Expr[]; left?: Expr; right?: Expr; extra?: Expr };
type Stmt = { kind: string; statements?: Stmt[]; expr?: Expr; condition?: Expr; body?: Stmt; otherwise?: Stmt; init?: Stmt; update?: Expr; updates?: Expr[]; declarations?: { type: string; name: string; expr?: Expr }[]; cases?: { value?: Expr; statements: Stmt[] }[] };
export interface SourceMethod { owner: string; name: string; parameters: { type: string; name: string }[]; result: string; isStatic: boolean; body: Stmt; line: number }
export interface SourceClass { name: string; parent: string | null; methods: SourceMethod[]; constants: Map<string, JavaValue>; fields: { type: string; name: string; expr?: Expr; isStatic: boolean }[] }
export interface JavaHost {
  global(name: string): JavaValue;
  get(receiver: JavaValue, name: string): JavaValue;
  set(receiver: JavaValue, name: string, value: JavaValue): void;
  call(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): JavaValue;
  construct(name: string, args: JavaValue[]): JavaValue;
  constructorCall(receiver: JavaValue, fromClass: string, target: 'super' | 'this', args: JavaValue[]): JavaValue;
  parent(name: string): string | null;
  isInstance(receiver: JavaValue, name: string): boolean;
  globalAsync?(name: string): Promise<JavaValue>;
  getAsync?(receiver: JavaValue, name: string): Promise<JavaValue>;
  callAsync?(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): Promise<JavaValue>;
  constructAsync?(name: string, args: JavaValue[]): Promise<JavaValue>;
  constructorCallAsync?(receiver: JavaValue, fromClass: string, target: 'super' | 'this', args: JavaValue[]): Promise<JavaValue>;
}

function sourceLiteral(text: string, floatMode: FloatMode,
  resolveResourceId?: (resource: ResourceIdentity) => number | undefined): JavaValue {
  if (text === 'null') return nil();
  if (text === 'true' || text === 'false') return jv('int', text === 'true' ? 1 : 0);
  if (text.startsWith('"') || text.startsWith("'")) {
    const decoded = text.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|[nrtbf"'\\])/g, (_m, c: string) => c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c));
    return text.startsWith("'") ? jv('int', decoded.charCodeAt(0)) : jv('String', decoded);
  }
  const resource = /^(.*):0[xX]([\da-fA-F]+)r$/.exec(text);
  if (resource) {
    const identity = { pack: resource[1], id: Number.parseInt(resource[2], 16) };
    const resourceId = resolveResourceId?.(identity);
    if (resourceId !== undefined && !Number.isInteger(resourceId)) throw new Error(`Invalid resource ID for ${text}`);
    return { ...jv('ResourceRef', identity), resource: identity,
      ...(resourceId === undefined ? {} : { resourceId: resourceId | 0 }) };
  }
  if (!/^0[xX]/.test(text) && /[.eEfFdD]/.test(text)) {
    const bits = floatLiteralBits(text, floatMode);
    const buffer = new ArrayBuffer(4), view = new DataView(buffer);
    view.setUint32(0, bits, true);
    return { ...jv('float', view.getFloat32(0, true)), numericLiteral: true };
  }
  return { ...jv('int', Number(text) | 0), numericLiteral: true };
}

function adaptExpr(expr: ParsedExpr, floatMode: FloatMode,
  resolveResourceId?: (resource: ResourceIdentity) => number | undefined): Expr {
  const child = (value: ParsedExpr | undefined) => value ? adaptExpr(value, floatMode, resolveResourceId) : undefined;
  if (expr.kind === 'paren') return adaptExpr(expr.left!, floatMode, resolveResourceId);
  if (expr.kind === 'literal') return { kind: 'literal', line: expr.token.line,
    value: sourceLiteral(expr.value!, floatMode, resolveResourceId) };
  if (expr.kind === 'this' || expr.kind === 'super') return { kind: 'name', line: expr.token.line, text: expr.kind };
  if (expr.kind === 'newarray') return { kind: 'arrayNew', line: expr.token.line, text: expr.text, right: child(expr.right) };
  return {
    kind: expr.kind, line: expr.token.line, text: expr.text,
    left: child(expr.left), right: child(expr.right), extra: child(expr.third),
    items: expr.args?.map(arg => adaptExpr(arg, floatMode, resolveResourceId)),
  };
}

function adaptStmt(stmt: ParsedStmt, floatMode: FloatMode,
  resolveResourceId?: (resource: ResourceIdentity) => number | undefined): Stmt {
  const child = (value: ParsedStmt | undefined) => value ? adaptStmt(value, floatMode, resolveResourceId) : undefined;
  const expression = (value: ParsedExpr) => adaptExpr(value, floatMode, resolveResourceId);
  switch (stmt.kind) {
    case 'empty': return { kind: 'block', statements: [] };
    case 'block': return { kind: 'block', statements: (stmt.items ?? []).map(x => child(x)!) };
    case 'exprs': return { kind: 'exprs', statements: (stmt.items ?? []).map(x => child(x)!) };
    case 'local': return { kind: 'var', declarations: (stmt.declarations ?? []).map(x => ({ type: x.type, name: x.name,
      expr: x.initial ? expression(x.initial) : undefined })) };
    case 'if': return { kind: 'if', condition: expression(stmt.expr!), body: child(stmt.body), otherwise: child(stmt.elseBody) };
    case 'while': case 'do': return { kind: stmt.kind, condition: expression(stmt.expr!), body: child(stmt.body) };
    case 'for': return { kind: 'for', init: child(stmt.init), condition: stmt.expr ? expression(stmt.expr) : undefined,
      updates: stmt.update?.map(expression), body: child(stmt.body) };
    case 'switch': return { kind: 'switch', condition: expression(stmt.expr!), cases: (stmt.cases ?? []).map(x => ({
      value: x.value ? expression(x.value) : undefined, statements: x.items.map(item => child(item)!),
    })) };
    case 'return': case 'expr': return { kind: stmt.kind, expr: stmt.expr ? expression(stmt.expr) : undefined };
    case 'break': case 'continue': return { kind: stmt.kind };
    default: throw new Error(`Unsupported Java statement ${stmt.kind} at line ${stmt.token.line}`);
  }
}

export function parseSourceClass(source: string, selected?: ReadonlySet<string>, className?: string, floatMode: FloatMode = 'B',
  resolveResourceId?: (resource: ResourceIdentity) => number | undefined): SourceClass {
  const program = parseSlrrSource(source);
  const cls = className ? program.classes.find(x => x.name === className || x.fullName === className) : program.classes[0];
  if (!cls) throw new Error(`Java class missing: ${className ?? '(first)'}`);
  const included = selected ?? new Set(cls.members.filter(x => x.kind === 'method').map(x => x.name));
  const methods: SourceMethod[] = [], constants = new Map<string, JavaValue>(), fields: SourceClass['fields'] = [];
  for (const member of cls.members) {
    if (member.kind === 'field') {
      const initial = member.initial ? adaptExpr(member.initial, floatMode, resolveResourceId) : undefined;
      fields.push({ type: member.type, name: member.name, expr: initial, isStatic: member.flags.includes('static') });
      if (/^[A-Z][A-Z0-9_]*$/.test(member.name) && initial?.kind === 'literal') constants.set(member.name, coerce(member.type, initial.value!));
    } else if (member.body && included.has(member.name)) {
      methods.push({ owner: cls.name, name: member.name, result: member.result, isStatic: member.flags.includes('static'),
        parameters: member.params, body: adaptStmt(member.body, floatMode, resolveResourceId), line: member.token.line });
    }
  }
  return { name: cls.name, parent: cls.parent ?? null, methods, constants, fields };
}

class Scope {
  values = new Map<string, JavaValue>();
  constructor(readonly parent?: Scope) {}
  owner(name: string): Scope | undefined { return this.values.has(name) ? this : this.parent?.owner(name); }
}
export function coerce(type: string, value: JavaValue): JavaValue {
  if (type === 'int') {
    const resource = value.resourceId ?? (value.type === 'ResourceRef' && value.value && typeof value.value === 'object' && 'id' in value.value
      ? Number(value.value.id) : Number(value.value));
    const result = jv(type, resource | 0);
    if (value.resource) result.resource = value.resource;
    if (value.resourceId !== undefined) result.resourceId = value.resourceId;
    return result;
  }
  if (type === 'float') return jv(type, Math.fround(Number(value.value)));
  if (type === 'double') return jv(type, Number(value.value));
  const result = jv(type, value.value);
  if (type === 'ResourceRef' && value.resource) {
    result.resource = value.resource;
    if (value.resourceId !== undefined) result.resourceId = value.resourceId;
  }
  return result;
}
const truth = (v: JavaValue) => v.value !== null && v.value !== false && v.value !== 0;
type Flow = { kind: 'return' | 'break' | 'continue'; value?: JavaValue } | undefined;

class JavaSourceLocationError extends Error {
  constructor(readonly line: number, message: string) { super(message); }
}

export class JavaSourceMachine {
  private remaining = 0; private depth = 0; private singleIteration = false;
  private readonly arrayResourceOrigins = new WeakMap<unknown[], Map<number, Pick<JavaValue, 'resource' | 'resourceId'>>>();
  constructor(readonly host: JavaHost, readonly budget = 1_000_000, readonly maxDepth = 128) {}
  invoke(method: SourceMethod, receiver: JavaValue, args: JavaValue[]): JavaValue {
    if (this.depth === 0) this.remaining = this.budget;
    if (args.length !== method.parameters.length) throw new Error(`Java argument count: ${method.owner}.${method.name}`);
    if (this.depth >= this.maxDepth) throw new Error('Java call depth exceeded');
    this.depth++;
    const scope = new Scope(); method.parameters.forEach((p, i) => scope.values.set(p.name, coerce(p.type, args[i])));
    try { const flow = this.statement(method.body, scope, receiver, method); return flow?.value ?? jv('void', undefined); }
    catch (e) { throw new Error(`${method.owner}.${method.name} (source line ${e instanceof JavaSourceLocationError ? e.line : method.line}): ${e instanceof Error ? e.message : e}`); }
    finally { this.depth--; }
  }
  invokeTick(method: SourceMethod, receiver: JavaValue, args: JavaValue[]): JavaValue {
    this.singleIteration = true;
    try { return this.invoke(method, receiver, args); }
    finally { this.singleIteration = false; }
  }
  async invokeAsync(method: SourceMethod, receiver: JavaValue, args: JavaValue[]): Promise<JavaValue> {
    this.requireAsyncHost();
    if (this.depth === 0) this.remaining = this.budget;
    if (args.length !== method.parameters.length) throw new Error(`Java argument count: ${method.owner}.${method.name}`);
    if (this.depth >= this.maxDepth) throw new Error('Java call depth exceeded');
    this.depth++;
    const scope = new Scope(); method.parameters.forEach((p, i) => scope.values.set(p.name, coerce(p.type, args[i])));
    try { const flow = await this.statementAsync(method.body, scope, receiver, method); return flow?.value ?? jv('void', undefined); }
    catch (e) { throw new Error(`${method.owner}.${method.name} (source line ${e instanceof JavaSourceLocationError ? e.line : method.line}): ${e instanceof Error ? e.message : e}`); }
    finally { this.depth--; }
  }
  async initializeFieldsAsync(cls: SourceClass, receiver: JavaValue, staticOnly = false): Promise<void> {
    this.requireAsyncHost();
    if (this.depth === 0) this.remaining = this.budget;
    const scope = new Scope();
    const initializer: SourceMethod = { owner: cls.name, name: '<fields>', parameters: [], result: 'void', isStatic: false,
      body: { kind: 'block', statements: [] }, line: 0 };
    for (const field of cls.fields.filter(field => field.isStatic === staticOnly)) {
      try {
        const value = field.expr ? await this.expressionAsync(field.expr, scope, receiver, initializer) : jv(field.type, ['int', 'float', 'double'].includes(field.type) ? 0 : null);
        this.host.set(receiver, field.name, coerce(field.type, value));
      } catch (error) {
        const line = error instanceof JavaSourceLocationError ? error.line : field.expr?.line ?? 0;
        throw new Error(`${cls.name}.<fields> (source line ${line}): ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  private requireAsyncHost(): void {
    if (!this.host.globalAsync || !this.host.getAsync || !this.host.callAsync || !this.host.constructAsync || !this.host.constructorCallAsync)
      throw new Error('Async Java execution requires async host callbacks');
  }
  initializeFields(cls: SourceClass, receiver: JavaValue, staticOnly = false) {
    if (this.depth === 0) this.remaining = this.budget;
    const scope = new Scope();
    const initializer: SourceMethod = { owner: cls.name, name: '<fields>', parameters: [], result: 'void', isStatic: false,
      body: { kind: 'block', statements: [] }, line: 0 };
    for (const field of cls.fields.filter(field => field.isStatic === staticOnly)) {
      try {
        const value = field.expr ? this.expression(field.expr, scope, receiver, initializer) : jv(field.type, ['int', 'float', 'double'].includes(field.type) ? 0 : null);
        this.host.set(receiver, field.name, coerce(field.type, value));
      } catch (error) {
        const line = error instanceof JavaSourceLocationError ? error.line : field.expr?.line ?? 0;
        throw new Error(`${cls.name}.<fields> (source line ${line}): ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  private step() { if (--this.remaining < 0) throw new Error('Java execution budget exceeded'); }
  private arrayElement(values: unknown[], index: number, type: string): JavaValue {
    return { ...jv(type, values[index]), ...this.arrayResourceOrigins.get(values)?.get(index) };
  }
  private setArrayElement(values: unknown[], index: number, type: string, value: JavaValue): void {
    const coerced = coerce(type, value);
    values[index] = coerced.value;
    let origins = this.arrayResourceOrigins.get(values);
    if (coerced.resource) {
      if (!origins) { origins = new Map(); this.arrayResourceOrigins.set(values, origins); }
      origins.set(index, { resource: coerced.resource, resourceId: coerced.resourceId });
    } else origins?.delete(index);
  }
  private reference(expr: Expr, scope: Scope, self: JavaValue, method: SourceMethod) {
    if (expr.kind === 'name') {
      const owner = scope.owner(expr.text!);
      return owner ? { get: () => owner.values.get(expr.text!)!, set: (v: JavaValue) => owner.values.set(expr.text!, coerce(owner.values.get(expr.text!)!.type, v)) }
        : { get: () => this.host.get(self, expr.text!), set: (v: JavaValue) => this.host.set(self, expr.text!, v) };
    }
    if (expr.kind === 'member') { const obj = this.expression(expr.left!, scope, self, method); return { get: () => this.host.get(obj, expr.text!), set: (v: JavaValue) => this.host.set(obj, expr.text!, v) }; }
    if (expr.kind === 'index') {
      const array = this.expression(expr.left!, scope, self, method), index = Number(this.expression(expr.right!, scope, self, method).value);
      if (!Array.isArray(array.value) || !Number.isInteger(index) || index < 0 || index >= array.value.length) throw new Error('Invalid Java array index');
      const values = array.value as unknown[];
      const elementType = array.type.endsWith('[]') ? array.type.slice(0, -2) : 'int';
      return { get: () => this.arrayElement(values, index, elementType),
        set: (v: JavaValue) => this.setArrayElement(values, index, elementType, v) };
    }
    throw new Error(`Unsupported Java assignment target ${expr.kind}`);
  }
  private expression(expr: Expr, scope: Scope, self: JavaValue, method: SourceMethod): JavaValue {
    this.step(); const ev = (e: Expr) => this.expression(e, scope, self, method);
    try {
    switch (expr.kind) {
      case 'literal': return expr.value!;
      case 'name': {
        if (expr.text === 'this') return self;
        if (expr.text === 'super') return jv('super', { receiver: self, owner: method.owner });
        const local = scope.owner(expr.text!); if (local) return local.values.get(expr.text!)!;
        try { return this.host.get(self, expr.text!); }
        catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith('Missing Java field ')) throw error;
          return this.host.global(expr.text!);
        }
      }
      case 'member': return this.host.get(ev(expr.left!), expr.text!);
      case 'new': return this.host.construct(expr.text!, expr.items!.map(ev));
      case 'arrayNew': {
        const length = Number(ev(expr.right!).value);
        if (!Number.isInteger(length) || length < 0 || length > 100_000) throw new Error('Invalid Java array length');
        return jv(`${expr.text}[]`, Array(length).fill(['int', 'float', 'double'].includes(expr.text!) ? 0 : null));
      }
      case 'index': return this.reference(expr, scope, self, method).get();
      case 'cast': return coerce(expr.text!, ev(expr.left!));
      case 'call': {
        const callee = expr.left!;
        if (callee.kind === 'name' && (callee.text === 'super' || callee.text === 'this'))
          return this.host.constructorCall(self, method.owner, callee.text, expr.items!.map(ev));
        if (callee.kind === 'name') return this.host.call(self, callee.text!, expr.items!.map(ev));
        if (callee.kind !== 'member') throw new Error('Only named Java calls supported');
        const receiver = ev(callee.left!), args = expr.items!.map(ev);
        if (receiver.type === 'super') { const s = receiver.value as { receiver: JavaValue; owner: string }; const parent = this.host.parent(s.owner); if (!parent) throw new Error('Missing superclass'); return this.host.call(s.receiver, callee.text!, args, parent); }
        return this.host.call(receiver, callee.text!, args);
      }
      case 'assign': {
        const ref = this.reference(expr.left!, scope, self, method), value = ev(expr.right!);
        ref.set(expr.text === '=' ? value : this.binary(expr.text!.slice(0, -1), ref.get(), value)); return ref.get();
      }
      case 'postfix': case 'unary': {
        if (expr.text === '++' || expr.text === '--') { const ref = this.reference(expr.left!, scope, self, method), before = ref.get(); ref.set(this.binary(expr.text === '++' ? '+' : '-', before, jv('int', 1))); return expr.kind === 'postfix' ? before : ref.get(); }
        const v = ev(expr.left!);
        if (expr.text === '!') return jv('int', truth(v) ? 0 : 1);
        if (expr.text === '~') return jv('int', ~Number(v.value));
        const result = coerce(v.type, jv(v.type, expr.text === '-' ? -Number(v.value) : Number(v.value)));
        if (v.numericLiteral) result.numericLiteral = true;
        return result;
      }
      case 'binary': {
        const a = ev(expr.left!);
        if (expr.text === '&&') return jv('int', truth(a) && truth(ev(expr.right!)) ? 1 : 0);
        if (expr.text === '||') return jv('int', truth(a) || truth(ev(expr.right!)) ? 1 : 0);
        return this.binary(expr.text!, a, ev(expr.right!));
      }
      case 'ternary': return truth(ev(expr.left!)) ? ev(expr.right!) : ev(expr.extra!);
      case 'instanceof': return jv('int', this.host.isInstance(ev(expr.left!), expr.right!.text!) ? 1 : 0);
      default: throw new Error(`Unsupported Java expression ${expr.kind}`);
    }
    } catch (error) {
      if (error instanceof JavaSourceLocationError) throw error;
      throw new JavaSourceLocationError(expr.line, error instanceof Error ? error.message : String(error));
    }
  }
  private async referenceAsync(expr: Expr, scope: Scope, self: JavaValue, method: SourceMethod): Promise<{ get: () => Promise<JavaValue>; set: (value: JavaValue) => void }> {
    if (expr.kind === 'name') {
      const owner = scope.owner(expr.text!);
      return owner ? { get: async () => owner.values.get(expr.text!)!, set: v => { owner.values.set(expr.text!, coerce(owner.values.get(expr.text!)!.type, v)); } }
        : { get: () => this.host.getAsync!(self, expr.text!), set: v => this.host.set(self, expr.text!, v) };
    }
    if (expr.kind === 'member') {
      const obj = await this.expressionAsync(expr.left!, scope, self, method);
      return { get: () => this.host.getAsync!(obj, expr.text!), set: v => this.host.set(obj, expr.text!, v) };
    }
    if (expr.kind === 'index') {
      const array = await this.expressionAsync(expr.left!, scope, self, method);
      const index = Number((await this.expressionAsync(expr.right!, scope, self, method)).value);
      if (!Array.isArray(array.value) || !Number.isInteger(index) || index < 0 || index >= array.value.length) throw new Error('Invalid Java array index');
      const values = array.value as unknown[];
      const elementType = array.type.endsWith('[]') ? array.type.slice(0, -2) : 'int';
      return { get: async () => this.arrayElement(values, index, elementType),
        set: v => this.setArrayElement(values, index, elementType, v) };
    }
    throw new Error(`Unsupported Java assignment target ${expr.kind}`);
  }
  private async expressionAsync(expr: Expr, scope: Scope, self: JavaValue, method: SourceMethod): Promise<JavaValue> {
    this.step(); const ev = (e: Expr) => this.expressionAsync(e, scope, self, method);
    const args = async (items: Expr[] = []) => { const result: JavaValue[] = []; for (const item of items) result.push(await ev(item)); return result; };
    try {
      switch (expr.kind) {
        case 'literal': return expr.value!;
        case 'name': {
          if (expr.text === 'this') return self;
          if (expr.text === 'super') return jv('super', { receiver: self, owner: method.owner });
          const local = scope.owner(expr.text!); if (local) return local.values.get(expr.text!)!;
          try { return await this.host.getAsync!(self, expr.text!); }
          catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith('Missing Java field ')) throw error;
            return await this.host.globalAsync!(expr.text!);
          }
        }
        case 'member': return await this.host.getAsync!(await ev(expr.left!), expr.text!);
        case 'new': return await this.host.constructAsync!(expr.text!, await args(expr.items));
        case 'arrayNew': {
          const length = Number((await ev(expr.right!)).value);
          if (!Number.isInteger(length) || length < 0 || length > 100_000) throw new Error('Invalid Java array length');
          return jv(`${expr.text}[]`, Array(length).fill(['int', 'float', 'double'].includes(expr.text!) ? 0 : null));
        }
        case 'index': return await (await this.referenceAsync(expr, scope, self, method)).get();
        case 'cast': return coerce(expr.text!, await ev(expr.left!));
        case 'call': {
          const callee = expr.left!;
          if (callee.kind === 'name' && (callee.text === 'super' || callee.text === 'this'))
            return await this.host.constructorCallAsync!(self, method.owner, callee.text, await args(expr.items));
          if (callee.kind === 'name') return await this.host.callAsync!(self, callee.text!, await args(expr.items));
          if (callee.kind !== 'member') throw new Error('Only named Java calls supported');
          const receiver = await ev(callee.left!), values = await args(expr.items);
          if (receiver.type === 'super') {
            const s = receiver.value as { receiver: JavaValue; owner: string }, parent = this.host.parent(s.owner);
            if (!parent) throw new Error('Missing superclass');
            return await this.host.callAsync!(s.receiver, callee.text!, values, parent);
          }
          return await this.host.callAsync!(receiver, callee.text!, values);
        }
        case 'assign': {
          const ref = await this.referenceAsync(expr.left!, scope, self, method), value = await ev(expr.right!);
          ref.set(expr.text === '=' ? value : this.binary(expr.text!.slice(0, -1), await ref.get(), value));
          return await ref.get();
        }
        case 'postfix': case 'unary': {
          if (expr.text === '++' || expr.text === '--') {
            const ref = await this.referenceAsync(expr.left!, scope, self, method), before = await ref.get();
            ref.set(this.binary(expr.text === '++' ? '+' : '-', before, jv('int', 1)));
            return expr.kind === 'postfix' ? before : await ref.get();
          }
          const v = await ev(expr.left!);
          if (expr.text === '!') return jv('int', truth(v) ? 0 : 1);
          if (expr.text === '~') return jv('int', ~Number(v.value));
          const result = coerce(v.type, jv(v.type, expr.text === '-' ? -Number(v.value) : Number(v.value)));
          if (v.numericLiteral) result.numericLiteral = true;
          return result;
        }
        case 'binary': {
          const a = await ev(expr.left!);
          if (expr.text === '&&') return jv('int', truth(a) && truth(await ev(expr.right!)) ? 1 : 0);
          if (expr.text === '||') return jv('int', truth(a) || truth(await ev(expr.right!)) ? 1 : 0);
          return this.binary(expr.text!, a, await ev(expr.right!));
        }
        case 'ternary': return await (truth(await ev(expr.left!)) ? ev(expr.right!) : ev(expr.extra!));
        case 'instanceof': return jv('int', this.host.isInstance(await ev(expr.left!), expr.right!.text!) ? 1 : 0);
        default: throw new Error(`Unsupported Java expression ${expr.kind}`);
      }
    } catch (error) {
      if (error instanceof JavaSourceLocationError) throw error;
      throw new JavaSourceLocationError(expr.line, error instanceof Error ? error.message : String(error));
    }
  }
  private binary(op: string, a: JavaValue, b: JavaValue): JavaValue {
    if (op === '+' && (a.type === 'String' || b.type === 'String')) return jv('String', String(a.value) + String(b.value));
    if (op === '==' || op === '!=') return jv('int', (a.value === b.value) === (op === '==') ? 1 : 0);
    const x = Number(a.value), y = Number(b.value), type = a.type === 'float' || b.type === 'float' ? 'float' : 'int';
    const comparisons: Record<string, boolean> = { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y };
    if (op in comparisons) return jv('int', comparisons[op] ? 1 : 0);
    if ((op === '/' || op === '%') && y === 0 && type === 'int') throw new Error('Java integer division by zero');
    const operations: Record<string, () => number> = { '+': () => x + y, '-': () => x - y, '*': () => x * y, '/': () => x / y, '%': () => x % y, '&': () => x & y, '|': () => x | y, '^': () => x ^ y, '<<': () => x << y, '>>': () => x >> y, '>>>': () => x >>> y };
    if (!operations[op]) throw new Error(`Unsupported Java operator ${op}`);
    return coerce(type, jv(type, operations[op]()));
  }
  private statement(stmt: Stmt, scope: Scope, self: JavaValue, method: SourceMethod): Flow {
    this.step(); const ev = (e: Expr) => this.expression(e, scope, self, method), run = (s: Stmt, sc = scope) => this.statement(s, sc, self, method);
    switch (stmt.kind) {
      case 'block': { const inner = new Scope(scope); for (const s of stmt.statements!) { const flow = run(s, inner); if (flow) return flow; } return; }
      case 'exprs': for (const s of stmt.statements!) { const flow = run(s); if (flow) return flow; } return;
      case 'var': for (const d of stmt.declarations!) { if (scope.values.has(d.name)) throw new Error(`Duplicate local ${d.name}`); scope.values.set(d.name, d.expr ? coerce(d.type, ev(d.expr)) : jv(d.type, ['int', 'float', 'double'].includes(d.type) ? 0 : null)); } return;
      case 'expr': ev(stmt.expr!); return;
      case 'if': if (truth(ev(stmt.condition!))) return run(stmt.body!); else if (stmt.otherwise) return run(stmt.otherwise); return;
      case 'switch': {
        const key = ev(stmt.condition!).value;
        const cases = stmt.cases!;
        let start = cases.findIndex(entry => entry.value && ev(entry.value).value === key);
        if (start < 0) start = cases.findIndex(entry => !entry.value);
        if (start < 0) return;
        const inner = new Scope(scope);
        for (let i = start; i < cases.length; i++) for (const part of cases[i].statements) {
          const flow = run(part, inner);
          if (flow?.kind === 'break') return;
          if (flow) return flow;
        }
        return;
      }
      case 'return': return { kind: 'return', value: stmt.expr ? ev(stmt.expr) : jv('void', undefined) };
      case 'break': return { kind: 'break' };
      case 'continue': return { kind: 'continue' };
      case 'do': {
        let iterations = 0;
        do {
          this.step();
          const flow = run(stmt.body!);
          if (flow?.kind === 'return') return flow;
          if (flow?.kind === 'break') break;
          if (this.singleIteration && ++iterations >= 1) break;
        } while (truth(ev(stmt.condition!)));
        return;
      }
      case 'while': case 'for': {
        const inner = new Scope(scope); if (stmt.init) run(stmt.init, inner);
        let iterations = 0;
        while (!stmt.condition || truth(this.expression(stmt.condition, inner, self, method))) {
          this.step(); const flow = run(stmt.body!, inner); if (flow?.kind === 'return') return flow; if (flow?.kind === 'break') break;
          if (stmt.update) this.expression(stmt.update, inner, self, method);
          for (const update of stmt.updates ?? []) this.expression(update, inner, self, method);
          if (this.singleIteration && ++iterations >= 1) break;
        } return;
      }
      default: throw new Error(`Unsupported Java statement ${stmt.kind}`);
    }
  }
  private async statementAsync(stmt: Stmt, scope: Scope, self: JavaValue, method: SourceMethod): Promise<Flow> {
    this.step(); const ev = (e: Expr) => this.expressionAsync(e, scope, self, method);
    const run = (s: Stmt, sc = scope) => this.statementAsync(s, sc, self, method);
    switch (stmt.kind) {
      case 'block': {
        const inner = new Scope(scope);
        for (const part of stmt.statements!) { const flow = await run(part, inner); if (flow) return flow; }
        return;
      }
      case 'exprs': for (const part of stmt.statements!) { const flow = await run(part); if (flow) return flow; } return;
      case 'var': for (const item of stmt.declarations!) {
        if (scope.values.has(item.name)) throw new Error(`Duplicate local ${item.name}`);
        scope.values.set(item.name, item.expr ? coerce(item.type, await ev(item.expr))
          : jv(item.type, ['int', 'float', 'double'].includes(item.type) ? 0 : null));
      } return;
      case 'expr': await ev(stmt.expr!); return;
      case 'if': if (truth(await ev(stmt.condition!))) return run(stmt.body!); else if (stmt.otherwise) return run(stmt.otherwise); return;
      case 'switch': {
        const key = (await ev(stmt.condition!)).value, cases = stmt.cases!;
        let start = -1;
        for (let i = 0; i < cases.length; i++) if (cases[i].value && (await ev(cases[i].value!)).value === key) { start = i; break; }
        if (start < 0) start = cases.findIndex(entry => !entry.value);
        if (start < 0) return;
        const inner = new Scope(scope);
        for (let i = start; i < cases.length; i++) for (const part of cases[i].statements) {
          const flow = await run(part, inner);
          if (flow?.kind === 'break') return;
          if (flow) return flow;
        }
        return;
      }
      case 'return': return { kind: 'return', value: stmt.expr ? await ev(stmt.expr) : jv('void', undefined) };
      case 'break': return { kind: 'break' };
      case 'continue': return { kind: 'continue' };
      case 'do': {
        let iterations = 0;
        do {
          this.step(); const flow = await run(stmt.body!);
          if (flow?.kind === 'return') return flow;
          if (flow?.kind === 'break') break;
          if (this.singleIteration && ++iterations >= 1) break;
        } while (truth(await ev(stmt.condition!)));
        return;
      }
      case 'while': case 'for': {
        const inner = new Scope(scope);
        if (stmt.init) await run(stmt.init, inner);
        let iterations = 0;
        while (!stmt.condition || truth(await this.expressionAsync(stmt.condition, inner, self, method))) {
          this.step(); const flow = await run(stmt.body!, inner);
          if (flow?.kind === 'return') return flow;
          if (flow?.kind === 'break') break;
          if (stmt.update) await this.expressionAsync(stmt.update, inner, self, method);
          for (const update of stmt.updates ?? []) await this.expressionAsync(update, inner, self, method);
          if (this.singleIteration && ++iterations >= 1) break;
        }
        return;
      }
      default: throw new Error(`Unsupported Java statement ${stmt.kind}`);
    }
  }
}
