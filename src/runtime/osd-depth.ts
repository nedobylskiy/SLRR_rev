import type { JavaObject, JavaValue } from 'slrr-jvm';
import type { ViewportNative } from './viewport-native';

const VIEWPORT_DEPTH_STRIDE = 1_000_000;

export interface OsdViewport { priority: number; left: number; top: number; width: number; height: number }
export const FULL_OSD_VIEWPORT: OsdViewport = { priority: 0, left: 0, top: 0, width: 1, height: 1 };

export function projectOsdBounds(viewport: OsdViewport, x: number, y: number, width = 0, height = 0) {
  return { x: viewport.left * 2 + viewport.width - 1 + x * viewport.width,
    y: viewport.top * 2 + viewport.height - 1 + y * viewport.height,
    width: width * viewport.width, height: height * viewport.height };
}

/** Java viewport priority orders whole OSD surfaces; Z orders objects inside one surface. */
export function osdDepth(priority: number, localDepth: number): number {
  return Math.round(priority) * VIEWPORT_DEPTH_STRIDE + localDepth;
}

export function osdViewport(group: JavaValue, viewports: ViewportNative): OsdViewport {
  const groupObject = group.value as JavaObject | null;
  const osd = groupObject?.fields?.get('osd')?.value as JavaObject | null | undefined;
  const viewport = osd?.fields?.get('vp');
  const state = viewport ? viewports.get(viewport) : undefined;
  return state ? { priority: state.priority, left: state.left, top: state.top,
    width: state.width, height: state.height } : FULL_OSD_VIEWPORT;
}

export function osdViewportPriority(group: JavaValue, viewports: ViewportNative): number {
  return osdViewport(group, viewports).priority;
}
