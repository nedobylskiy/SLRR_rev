import { normalizePath } from '../assets';

/** Restore values lost by decompiling the shipped system String.class. Game and mod Java sources pass through unchanged. */
export function repairDecompiledSource(path: string, source: string): string {
  if (normalizePath(path) !== 'system/scripts/lang/decompiled/string.java') return source;
  // Recovered String helpers concatenate into uninitialized local accumulators.
  // Seed only these helpers; otherwise the host string backend adds a literal
  // "null" prefix to the ROC token list on every getParams/trim round trip.
  source = source
    .replace(/(public static String getParams\(Vector arg0\)\s*\{\s*)String local1;/, '$1String local1 = "";')
    .replace(/(public String trim\(int arg0\)\s*\{\s*Vector local2 = scanf\(\);\s*)String local3;/, '$1String local3 = "";');
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
