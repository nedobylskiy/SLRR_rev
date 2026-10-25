/** Restricted, parsed Java source interpreter. No eval/Function or ambient JS access. */
export interface JavaValue { type: string; value: unknown }
export const jv = (type: string, value: unknown): JavaValue => ({ type, value });
export const nil = () => jv('Object', null);
interface Token { text: string; line: number; value?: JavaValue }
type Expr = { kind: string; text?: string; value?: JavaValue; items?: Expr[]; left?: Expr; right?: Expr; extra?: Expr };
type Stmt = { kind: string; statements?: Stmt[]; expr?: Expr; condition?: Expr; body?: Stmt; otherwise?: Stmt; init?: Stmt; update?: Expr; declarations?: { type: string; name: string; expr?: Expr }[] };
export interface SourceMethod { owner: string; name: string; parameters: { type: string; name: string }[]; result: string; isStatic: boolean; body: Stmt; line: number }
export interface SourceClass { name: string; parent: string | null; methods: SourceMethod[]; constants: Map<string, JavaValue> }
export interface JavaHost {
  global(name: string): JavaValue;
  get(receiver: JavaValue, name: string): JavaValue;
  set(receiver: JavaValue, name: string, value: JavaValue): void;
  call(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): JavaValue;
  construct(name: string, args: JavaValue[]): JavaValue;
  parent(name: string): string | null;
}

function lex(source: string): Token[] {
  const tokens: Token[] = []; let offset = 0, line = 1;
  while (offset < source.length) {
    const tail = source.slice(offset);
    const skip = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(tail);
    if (skip) { line += (skip[0].match(/\n/g) ?? []).length; offset += skip[0].length; continue; }
    const str = /^"(?:\\.|[^"\\])*"/.exec(tail);
    if (str) {
      const decoded = str[0].slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|[nrtbf"'\\])/g, (_m, c: string) => c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c));
      tokens.push({ text: str[0], line, value: jv('String', decoded) }); offset += str[0].length; continue;
    }
    const resource = /^([A-Za-z_$][\w$]*):(0[xX][\da-fA-F]+)r\b/.exec(tail);
    if (resource) { tokens.push({ text: resource[0], line, value: jv('ResourceRef', { pack: resource[1], id: Number(resource[2]) }) }); offset += resource[0].length; continue; }
    const number = /^(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?)/.exec(tail);
    if (number) { const s = number[0], floating = !/^0x/i.test(s) && /[.eEfFdD]/.test(s); tokens.push({ text: s, line, value: jv(floating ? 'float' : 'int', floating ? Math.fround(Number(s.replace(/[fFdD]$/, ''))) : Number(s) | 0) }); offset += s.length; continue; }
    const word = /^[A-Za-z_$][\w$]*/.exec(tail);
    if (word) { tokens.push({ text: word[0], line }); offset += word[0].length; continue; }
    const op = /^(?:>>>|<<|>>|\+\+|--|==|!=|<=|>=|&&|\|\||\+=|-=|\*=|\/=|[{}()[\];,.?:+\-*/%<>=!&|^~])/.exec(tail);
    if (!op) {
      // Non-selected methods can contain character literals; tokenize them without interpreting.
      const char = /^'(?:\\.|[^'\\])'/.exec(tail);
      if (char) { tokens.push({ text: char[0], line }); offset += char[0].length; continue; }
      throw new Error(`Java lexer: unsupported character ${JSON.stringify(tail[0])} at line ${line}`);
    }
    tokens.push({ text: op[0], line }); offset += op[0].length;
  }
  return tokens;
}

const precedence: Record<string, number> = { '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '||': 3, '&&': 4, '|': 5, '^': 6, '&': 7, '==': 8, '!=': 8, '<': 9, '>': 9, '<=': 9, '>=': 9, '<<': 10, '>>': 10, '>>>': 10, '+': 11, '-': 11, '*': 12, '/': 12, '%': 12 };
class Parser {
  at = 0;
  constructor(readonly tokens: Token[]) {}
  peek(n = 0) { return this.tokens[this.at + n]?.text; }
  eat(s: string) { if (this.peek() === s) { this.at++; return true; } return false; }
  need(s: string) { if (!this.eat(s)) throw new Error(`Java parser line ${this.tokens[this.at]?.line}: expected '${s}', got '${this.peek()}'`); }
  name() { const name = this.tokens[this.at++]?.text; if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`Java parser: expected name, got ${name}`); return name; }
  expression(min = 1): Expr {
    let left = this.prefix();
    for (;;) {
      if (this.eat('.')) { left = { kind: 'member', left, text: this.name() }; continue; }
      if (this.eat('(')) { const items: Expr[] = []; if (!this.eat(')')) { do { items.push(this.expression()); } while (this.eat(',')); this.need(')'); } left = { kind: 'call', left, items }; continue; }
      if (this.eat('[')) { const right = this.expression(); this.need(']'); left = { kind: 'index', left, right }; continue; }
      if (this.peek() === '++' || this.peek() === '--') { left = { kind: 'postfix', left, text: this.tokens[this.at++].text }; continue; }
      if (this.peek() === '?' && min <= 2) { this.at++; const right = this.expression(); this.need(':'); left = { kind: 'ternary', left, right, extra: this.expression(2) }; continue; }
      const op = this.peek(), p = precedence[op ?? '']; if (p === undefined || p < min) break;
      this.at++; left = { kind: p === 1 ? 'assign' : 'binary', text: op, left, right: this.expression(p === 1 ? p : p + 1) };
    }
    return left;
  }
  prefix(): Expr {
    const token = this.tokens[this.at++]; if (!token) throw new Error('Java expression truncated');
    if (token.value) return { kind: 'literal', value: token.value };
    if (['null', 'true', 'false'].includes(token.text)) return { kind: 'literal', value: token.text === 'null' ? nil() : jv('int', token.text === 'true' ? 1 : 0) };
    if (['!', '-', '+', '~', '++', '--'].includes(token.text)) return { kind: 'unary', text: token.text, left: this.expression(13) };
    if (token.text === '(') {
      if (['int', 'float', 'double', 'String'].includes(this.peek() ?? '') && this.peek(1) === ')') { const type = this.tokens[this.at++].text; this.at++; return { kind: 'cast', text: type, left: this.expression(13) }; }
      const expr = this.expression(); this.need(')'); return expr;
    }
    if (token.text === 'new') {
      const name = this.name(); this.need('('); const items: Expr[] = [];
      if (!this.eat(')')) { do { items.push(this.expression()); } while (this.eat(',')); this.need(')'); }
      return { kind: 'new', text: name, items };
    }
    if (/^[A-Za-z_$][\w$]*$/.test(token.text)) return { kind: 'name', text: token.text };
    throw new Error(`Java expression: unsupported ${token.text} at line ${token.line}`);
  }
  declaration(): Stmt | undefined {
    const start = this.at; this.eat('final');
    if (!/^[A-Za-z_$][\w$]*$/.test(this.peek() ?? '')) { this.at = start; return; }
    let type = this.tokens[this.at++].text;
    while (this.eat('[')) { this.need(']'); type += '[]'; }
    if (!/^[A-Za-z_$][\w$]*$/.test(this.peek() ?? '')) { this.at = start; return; }
    const declarations: NonNullable<Stmt['declarations']> = [];
    do { const name = this.name(), expr = this.eat('=') ? this.expression() : undefined; declarations.push({ type, name, expr }); } while (this.eat(','));
    return { kind: 'var', declarations };
  }
  statement(): Stmt {
    if (this.eat('{')) { const statements: Stmt[] = []; while (!this.eat('}')) { if (!this.peek()) throw new Error('Unclosed Java block'); statements.push(this.statement()); } return { kind: 'block', statements }; }
    if (this.eat(';')) return { kind: 'block', statements: [] };
    if (this.eat('if')) { this.need('('); const condition = this.expression(); this.need(')'); const body = this.statement(), otherwise = this.eat('else') ? this.statement() : undefined; return { kind: 'if', condition, body, otherwise }; }
    if (this.eat('while')) { this.need('('); const condition = this.expression(); this.need(')'); return { kind: 'while', condition, body: this.statement() }; }
    if (this.eat('for')) {
      this.need('('); const init = this.peek() === ';' ? undefined : this.declaration() ?? { kind: 'expr', expr: this.expression() }; this.need(';');
      const condition = this.peek() === ';' ? undefined : this.expression(); this.need(';');
      const update = this.peek() === ')' ? undefined : this.expression(); this.need(')'); return { kind: 'for', init, condition, update, body: this.statement() };
    }
    if (this.eat('return')) { const expr = this.peek() === ';' ? undefined : this.expression(); this.need(';'); return { kind: 'return', expr }; }
    if (this.eat('break')) { this.need(';'); return { kind: 'break' }; }
    if (this.eat('continue')) { this.need(';'); return { kind: 'continue' }; }
    const stmt = this.declaration() ?? { kind: 'expr', expr: this.expression() }; this.need(';'); return stmt;
  }
}

export function parseSourceClass(source: string, selected = new Set(['save', 'load', 'createFromFile']), className?: string): SourceClass {
  const tokens = lex(source), ci = tokens.findIndex((t, i) => t.text === 'class' && (!className || tokens[i + 1]?.text === className)); if (ci < 0) throw new Error(`Java class missing: ${className ?? '(first)'}`);
  const name = tokens[ci + 1].text, parent = tokens[ci + 2]?.text === 'extends' ? tokens[ci + 3].text : null;
  const methods: SourceMethod[] = [], constants = new Map<string, JavaValue>(); let depth = 0;
  for (let i = tokens.findIndex((t, at) => at > ci && t.text === '{'); i < tokens.length; i++) {
    const t = tokens[i]; if (t.text === '{') { depth++; continue; } if (t.text === '}') { depth--; if (depth === 0) break; continue; }
    if (depth === 1 && /^[A-Z][A-Z0-9_]*$/.test(t.text) && tokens[i + 1]?.text === '=' && tokens[i + 2]?.value && tokens[i + 3]?.text === ';')
      constants.set(t.text, coerce(tokens[i - 1].text, tokens[i + 2].value!));
    if (depth !== 1 || !selected.has(t.text) || tokens[i + 1]?.text !== '(') continue;
    const parser = new Parser(tokens); parser.at = i + 2;
    const parameters: SourceMethod['parameters'] = [];
    if (!parser.eat(')')) { do { let type = parser.name(); while (parser.eat('[')) { parser.need(']'); type += '[]'; } parameters.push({ type, name: parser.name() }); } while (parser.eat(',')); parser.need(')'); }
    if (parser.peek() !== '{') continue;
    const body = parser.statement();
    let header = i - 1; while (header > 0 && ![';', '{', '}'].includes(tokens[header].text)) header--;
    methods.push({ owner: name, name: t.text, result: tokens[i - 1].text, isStatic: tokens.slice(header + 1, i).some(t => t.text === 'static'), parameters, body, line: t.line });
    i = parser.at - 1;
  }
  return { name, parent, methods, constants };
}

class Scope {
  values = new Map<string, JavaValue>();
  constructor(readonly parent?: Scope) {}
  owner(name: string): Scope | undefined { return this.values.has(name) ? this : this.parent?.owner(name); }
}
export function coerce(type: string, value: JavaValue): JavaValue {
  if (type === 'int') return jv(type, Number(value.value) | 0);
  if (type === 'float') return jv(type, Math.fround(Number(value.value)));
  if (type === 'double') return jv(type, Number(value.value));
  return jv(type, value.value);
}
const truth = (v: JavaValue) => v.value !== null && v.value !== false && v.value !== 0;
type Flow = { kind: 'return' | 'break' | 'continue'; value?: JavaValue } | undefined;

export class JavaSourceMachine {
  private remaining = 0; private depth = 0;
  constructor(readonly host: JavaHost, readonly budget = 1_000_000, readonly maxDepth = 128) {}
  invoke(method: SourceMethod, receiver: JavaValue, args: JavaValue[]): JavaValue {
    if (this.depth === 0) this.remaining = this.budget;
    if (args.length !== method.parameters.length) throw new Error(`Java argument count: ${method.owner}.${method.name}`);
    if (this.depth >= this.maxDepth) throw new Error('Java call depth exceeded');
    this.depth++;
    const scope = new Scope(); method.parameters.forEach((p, i) => scope.values.set(p.name, coerce(p.type, args[i])));
    try { const flow = this.statement(method.body, scope, receiver, method); return flow?.value ?? jv('void', undefined); }
    catch (e) { throw new Error(`${method.owner}.${method.name} (source line ${method.line}): ${e instanceof Error ? e.message : e}`); }
    finally { this.depth--; }
  }
  private step() { if (--this.remaining < 0) throw new Error('Java execution budget exceeded'); }
  private reference(expr: Expr, scope: Scope, self: JavaValue, method: SourceMethod) {
    if (expr.kind === 'name') {
      const owner = scope.owner(expr.text!);
      return owner ? { get: () => owner.values.get(expr.text!)!, set: (v: JavaValue) => owner.values.set(expr.text!, coerce(owner.values.get(expr.text!)!.type, v)) }
        : { get: () => this.host.get(self, expr.text!), set: (v: JavaValue) => this.host.set(self, expr.text!, v) };
    }
    if (expr.kind === 'member') { const obj = this.expression(expr.left!, scope, self, method); return { get: () => this.host.get(obj, expr.text!), set: (v: JavaValue) => this.host.set(obj, expr.text!, v) }; }
    throw new Error(`Unsupported Java assignment target ${expr.kind}`);
  }
  private expression(expr: Expr, scope: Scope, self: JavaValue, method: SourceMethod): JavaValue {
    this.step(); const ev = (e: Expr) => this.expression(e, scope, self, method);
    switch (expr.kind) {
      case 'literal': return expr.value!;
      case 'name': {
        if (expr.text === 'this') return self;
        if (expr.text === 'super') return jv('super', { receiver: self, owner: method.owner });
        const local = scope.owner(expr.text!); if (local) return local.values.get(expr.text!)!;
        try { return this.host.get(self, expr.text!); } catch { return this.host.global(expr.text!); }
      }
      case 'member': return this.host.get(ev(expr.left!), expr.text!);
      case 'new': return this.host.construct(expr.text!, expr.items!.map(ev));
      case 'cast': return coerce(expr.text!, ev(expr.left!));
      case 'call': {
        const callee = expr.left!;
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
        return coerce(v.type, jv(v.type, expr.text === '-' ? -Number(v.value) : Number(v.value)));
      }
      case 'binary': {
        const a = ev(expr.left!);
        if (expr.text === '&&') return jv('int', truth(a) && truth(ev(expr.right!)) ? 1 : 0);
        if (expr.text === '||') return jv('int', truth(a) || truth(ev(expr.right!)) ? 1 : 0);
        return this.binary(expr.text!, a, ev(expr.right!));
      }
      case 'ternary': return truth(ev(expr.left!)) ? ev(expr.right!) : ev(expr.extra!);
      default: throw new Error(`Unsupported Java expression ${expr.kind}`);
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
      case 'var': for (const d of stmt.declarations!) { if (scope.values.has(d.name)) throw new Error(`Duplicate local ${d.name}`); scope.values.set(d.name, d.expr ? coerce(d.type, ev(d.expr)) : jv(d.type, ['int', 'float', 'double'].includes(d.type) ? 0 : null)); } return;
      case 'expr': ev(stmt.expr!); return;
      case 'if': if (truth(ev(stmt.condition!))) return run(stmt.body!); else if (stmt.otherwise) return run(stmt.otherwise); return;
      case 'return': return { kind: 'return', value: stmt.expr ? ev(stmt.expr) : jv('void', undefined) };
      case 'break': return { kind: 'break' };
      case 'continue': return { kind: 'continue' };
      case 'while': case 'for': {
        const inner = new Scope(scope); if (stmt.init) run(stmt.init, inner);
        while (!stmt.condition || truth(this.expression(stmt.condition, inner, self, method))) {
          this.step(); const flow = run(stmt.body!, inner); if (flow?.kind === 'return') return flow; if (flow?.kind === 'break') break;
          if (stmt.update) this.expression(stmt.update, inner, self, method);
        } return;
      }
      default: throw new Error(`Unsupported Java statement ${stmt.kind}`);
    }
  }
}
