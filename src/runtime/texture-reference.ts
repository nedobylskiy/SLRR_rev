import { normalizePath } from '../assets';
import type { ResourceIdentity } from 'slrr-jvm';

export type SavedTextureIdentity = ResourceIdentity & { source?: string };
const PREFIX = 'SLRR_TEXTURE_1\n';
export function encodeTextureReference(source: string): Uint8Array {
  return new TextEncoder().encode(PREFIX + JSON.stringify(normalizePath(source)));
}
export function decodeTextureReference(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith(PREFIX)) return;
  const path = JSON.parse(text.slice(PREFIX.length));
  if (typeof path !== 'string' || !path) throw Error('Invalid saved texture path');
  return normalizePath(path);
}
