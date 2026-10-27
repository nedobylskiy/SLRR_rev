import type { JavaValue } from './java-source.js';

export interface NativeCall {
  receiver: JavaValue;
  args: readonly JavaValue[];
}

export type NativeFunction = (call: NativeCall) => JavaValue;

/** Explicit host capabilities; Java source cannot access ambient JavaScript. */
export class JavaNativeRegistry {
  private readonly entries = new Map<string, NativeFunction>();
  private readonly signatures = new Map<string, readonly string[]>();
  private readonly classes = new Set<string>();
  private readonly fields = new Map<string, JavaValue>();

  registerField(className: string, name: string, value: JavaValue): void {
    const key = `${className}#${name}`;
    if (this.fields.has(key)) throw new Error(`Native field already registered: ${key}`);
    this.fields.set(key, value);
    this.classes.add(className);
  }

  getField(className: string, name: string): JavaValue | undefined {
    return this.fields.get(`${className}#${name}`);
  }

  setField(className: string, name: string, value: JavaValue): boolean {
    const key = `${className}#${name}`;
    if (!this.fields.has(key)) return false;
    this.fields.set(key, value);
    return true;
  }

  register(className: string, method: string, parameters: readonly string[], implementation: NativeFunction): void {
    const key = this.key(className, method, parameters);
    if (this.entries.has(key)) throw new Error(`Native already registered: ${key}`);
    this.entries.set(key, implementation);
    this.signatures.set(key, parameters);
    this.classes.add(className);
  }

  hasClass(name: string): boolean { return this.classes.has(name); }

  invoke(className: string, method: string, receiver: JavaValue, args: readonly JavaValue[],
    score?: (parameter: string, argument: JavaValue) => number): JavaValue | undefined {
    const key = this.key(className, method, args.map(arg => arg.type));
    const exact = this.entries.get(key);
    if (exact) return exact({ receiver, args });
    if (!score && !args.some(arg => arg.value === null)) return undefined;
    const prefix = `${className}#${method}(`;
    const primitives = new Set(['int', 'float', 'double', 'boolean', 'byte', 'short', 'char', 'long']);
    const matches = [...this.signatures].filter(([signature, parameters]) => signature.startsWith(prefix)
      && parameters.length === args.length).map(([signature, parameters]) => ({ signature,
        rank: parameters.reduce((total, parameter, index) => total + (score
          ? score(parameter, args[index]) : args[index].value === null && !primitives.has(parameter) ? 5
            : parameter === args[index].type ? 0 : Infinity), 0),
      })).filter(match => Number.isFinite(match.rank)).sort((left, right) => left.rank - right.rank);
    if (matches.length > 1 && matches[0].rank === matches[1].rank)
      throw new Error(`Ambiguous Java native overload: ${className}.${method}`);
    return matches.length ? this.entries.get(matches[0].signature)!({ receiver, args }) : undefined;
  }

  has(className: string, method: string, parameters: readonly string[]): boolean {
    return this.entries.has(this.key(className, method, parameters));
  }

  private key(className: string, method: string, parameters: readonly string[]): string {
    if (!className || !method || parameters.some(type => !type)) throw new Error('Invalid native signature');
    return `${className}#${method}(${parameters.join(',')})`;
  }
}
