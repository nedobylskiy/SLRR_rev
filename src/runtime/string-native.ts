import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';

function value(receiver: JavaValue): string {
  if (typeof receiver.value !== 'string') throw new Error('Java String receiver is not text');
  return receiver.value;
}

function tokens(input: string, delimiters: string): string[] {
  const result: string[] = [];
  let token = '';
  for (const character of input) {
    if (delimiters.includes(character)) {
      if (token) result.push(token);
      token = '';
    } else token += character;
  }
  if (token) result.push(token);
  return result;
}

/** Native operations on primitive strings; Java-defined methods such as chop still run from String.java. */
export class StringNative {
  constructor(jvm: SlrrJvm) {
    const owner = 'java.lang.String';
    jvm.natives.register(owner, 'length', [], ({ receiver }) => jv('int', value(receiver).length));
    jvm.natives.register(owner, 'append', ['int'], ({ receiver, args }) => {
      const text = value(receiver), code = Number(args[0].value);
      if (!Number.isInteger(code) || code < 0 || code > 0xffff) throw new Error('Invalid String character code');
      return jv('String', code === 8 ? text.slice(0, -1) : text + String.fromCharCode(code));
    });
    jvm.natives.register(owner, 'token', ['int', 'String'], ({ receiver, args }) => {
      const index = Number(args[0].value);
      const parts = tokens(value(receiver), String(args[1].value ?? ''));
      return jv('String', Number.isInteger(index) && index >= 0 ? parts[index] ?? null : null);
    });
    jvm.natives.register(owner, 'intValue', [], ({ receiver }) =>
      jv('int', Number.parseInt(value(receiver).trim(), 0) || 0));
    jvm.natives.register(owner, 'floatValue', [], ({ receiver }) =>
      jv('float', Math.fround(Number.parseFloat(value(receiver).trim()) || 0)));
    jvm.natives.register(owner, 'getASCII', [], ({ receiver }) => {
      const text = value(receiver);
      return jv('int[]', Array.from({ length: text.length }, (_, index) => text.charCodeAt(index) & 0xff));
    });
    jvm.natives.register(owner, 'finalize', [], () => jv('void', undefined));
  }
}
