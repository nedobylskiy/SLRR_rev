import { normalizePath } from '../assets';

/** Restore values lost by decompiling the shipped system String.class. Game and mod Java sources pass through unchanged. */
export function repairDecompiledSource(path: string, source: string): string {
  if (normalizePath(path) !== 'system/scripts/lang/decompiled/string.java') return source;
  const start = source.indexOf('public static String timeToString(float arg0, int arg1)');
  const end = source.indexOf('public static String timeToAlphaString', start);
  if (start < 0 || end < 0) return source;
  const method = source.slice(start, end)
    .replace('String local2;', 'String local2 = "";')
    .replace('int local3;', 'int local3 = 0;')
    .replace('int local4;', 'int local4 = 0;')
    .replace(/\+ arg0\b/g, '+ Float.toString(arg0, "%0.3f")');
  return source.slice(0, start) + method + source.slice(end);
}
