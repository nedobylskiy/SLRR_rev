import type { JavaObject, JavaValue } from 'slrr-jvm';
import type { ViewportNative } from './viewport-native';

const VIEWPORT_DEPTH_STRIDE = 1_000_000;

/** Java viewport priority orders whole OSD surfaces; Z orders objects inside one surface. */
export function osdDepth(priority: number, localDepth: number): number {
  return Math.round(priority) * VIEWPORT_DEPTH_STRIDE + localDepth;
}

export function osdViewportPriority(group: JavaValue, viewports: ViewportNative): number {
  const groupObject = group.value as JavaObject | null;
  const osd = groupObject?.fields?.get('osd')?.value as JavaObject | null | undefined;
  const viewport = osd?.fields?.get('vp');
  return viewport ? viewports.get(viewport)?.priority ?? 0 : 0;
}
