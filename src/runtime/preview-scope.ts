import { GameObject } from './game-object';
import type { ResourceObject } from './resource-object';

/** Dummy world-tree roots are isolated render worlds, not children of the garage scene. */
export function previewScope(node: ResourceObject): GameObject | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent instanceof GameObject && parent.worldTreeRoot)
      return parent.className === 'java.util.resource.Dummy' ? parent : undefined;
  }
  return undefined;
}
