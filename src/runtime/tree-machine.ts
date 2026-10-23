import { type TufaClass, type TufaMethod } from '../formats/tufa';
import { NativeRegistry, type ScriptObject, type ScriptValue } from './native-registry';

/** Deliberately small, fail-closed interpreter for empirically checked leaf TREE expressions.
 * Not a full TUFA VM: calls, fields, allocation, loops and Java source compilation are absent.
 */
export class TreeMachine {
  constructor(readonly natives = new NativeRegistry()) {}
  invoke(cls: TufaClass, name: string, signature: string, receiver: ScriptObject | null, args: ScriptValue[]) {
    const method = cls.methods.find(m => m.name === name && m.signature === signature);
    if (!method) throw new Error(`Method missing: ${cls.name}.${name}${signature}`);
    if (method.flags & 0x40) return this.natives.invoke(cls.name, name, signature, receiver, args);
    const tree = cls.trees[method.tree];
    if (!tree) throw new Error(`Method has no TREE: ${name}`);
    if (!tree.length && (name === '<init>' || signature.endsWith('V'))) return;
    return this.evaluate(cls, method, receiver, args);
  }
  private evaluate(cls: TufaClass, method: TufaMethod, receiver: ScriptObject | null, args: ScriptValue[]) {
    const locals: ScriptValue[] = method.flags & 8 ? args : [receiver, ...args];
    const stack: ScriptValue[] = [];
    const pop = () => { if (!stack.length) throw new Error('TREE stack underflow'); return stack.pop()!; };
    const tree = cls.trees[method.tree];
    if (tree.length > 10_000) throw new Error('TREE instruction budget exceeded');
    // Validate the whole body before execution; unknown semantics never silently no-op.
    const allowed = new Set([0x01, 0x03, 0x07, 0x09, 0x0a, 0x0b, 0x0c, 0x28, 0x2b]);
    for (const node of tree) if (!allowed.has(node.op) || node.op === 7 && node.operand !== 7)
      throw new Error(`Unsupported TREE op 0x${node.op.toString(16)} operand=${node.operand} in ${cls.name}.${method.name} source=${node.source}`);
    let equality = false;
    for (const node of tree) {
      switch (node.op) {
        case 0x01:
          if (node.operand === undefined || node.operand >= locals.length) throw new Error('TREE local out of range');
          stack.push(locals[node.operand]); break;
        case 0x03: break; // Block marker; no heap/locals cleanup needed in supported leaf subset.
        case 0x07: equality = true; break;
        case 0x09: {
          const c = cls.constants[node.operand!]; if (c?.kind !== 0) throw new Error('TREE string constant expected');
          stack.push(c.value); break;
        }
        case 0x0a: {
          const b = new ArrayBuffer(4), v = new DataView(b); v.setUint32(0, node.operand!, true); stack.push(v.getFloat32(0, true)); break;
        }
        case 0x0b: stack.push(node.operand! | 0); break;
        case 0x0c: stack.push(null); break;
        case 0x28: {
          if (!equality) throw new Error('TREE expression operator missing');
          const b = pop(), a = pop(); stack.push(a === b ? 1 : 0); equality = false; break;
        }
        case 0x2b:
          if (equality || stack.length !== 1) throw new Error('TREE invalid return stack');
          return pop();
      }
    }
    throw new Error('TREE missing return');
  }
}
