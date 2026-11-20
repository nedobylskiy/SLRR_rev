import { BinaryReader } from '../binary';

/** Read the declared identity before decoding methods or obsolete constant kinds.
 * Legacy installations retain stale .class files whose paths do not match their class names. */
export function tufaClassName(bytes: Uint8Array): string {
  const reader = new BinaryReader(bytes,'TUFA class identity');
  if (reader.text(4) !== 'TUFA' || reader.u32() !== 4) throw new Error('Invalid TUFA header');
  reader.u32();
  let pool: Uint8Array | undefined, classIndex: number | undefined;
  while (reader.remaining) {
    const tag = reader.text(4), data = reader.take(reader.u32());
    if (tag === 'CONS') pool = data;
    if (tag === 'CLSS') {
      const cls = new BinaryReader(data,'CLSS'); cls.skip(8); classIndex = cls.u32();
    }
    if (tag === 'TREE') break;
  }
  if (!pool || classIndex === undefined) throw new Error('TUFA missing CONS/CLSS');
  const constants = new BinaryReader(pool,'TUFA identity constants'), count = constants.u32();
  const strings = new Map<number,string>(), classes = new Map<number,number>();
  for (let index=0;index<count;index++) {
    const kind = constants.u32();
    if (kind === 0) {
      const text = constants.text(constants.u32());
      if (constants.u8() !== 0) throw new Error('TUFA constant missing NUL');
      strings.set(index,text);
    } else if (kind === 4) classes.set(index,constants.u32());
    else if ([1,2].includes(kind)) constants.skip(4);
    else if ([3,5,6,7].includes(kind)) constants.skip(8);
    else throw new Error(`Unsupported TUFA identity constant ${kind}`);
    const nameIndex = classes.get(classIndex);
    const name = nameIndex === undefined ? undefined : strings.get(nameIndex);
    if (name !== undefined) return name;
  }
  throw new Error('TUFA class name missing');
}
