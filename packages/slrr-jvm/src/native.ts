import type { JavaValue } from './java-source.js';

export interface NativeCall {
  receiver: JavaValue;
  args: readonly JavaValue[];
}

export type NativeFunction = (call: NativeCall) => JavaValue;

/** Explicit host capabilities; Java source cannot access ambient JavaScript. */
export class JavaNativeRegistry {
  private readonly entries = new Map<string, NativeFunction>();
  private readonly classes = new Set<string>();

  register(className: string, method: string, parameters: readonly string[], implementation: NativeFunction): void {
    const key = this.key(className, method, parameters);
    if (this.entries.has(key)) throw new Error(`Native already registered: ${key}`);
    this.entries.set(key, implementation);
    this.classes.add(className);
  }

  hasClass(name: string): boolean { return this.classes.has(name); }

  invoke(className: string, method: string, receiver: JavaValue, args: readonly JavaValue[]): JavaValue | undefined {
    const key = this.key(className, method, args.map(arg => arg.type));
    return this.entries.get(key)?.({ receiver, args });
  }

  has(className: string, method: string, parameters: readonly string[]): boolean {
    return this.entries.has(this.key(className, method, parameters));
  }

  private key(className: string, method: string, parameters: readonly string[]): string {
    if (!className || !method || parameters.some(type => !type)) throw new Error('Invalid native signature');
    return `${className}#${method}(${parameters.join(',')})`;
  }
}
