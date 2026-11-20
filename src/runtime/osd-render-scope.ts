import type {ResourceObject} from './resource-object';

/** Legacy OSD icons can nest RenderRefs beneath GameRefs. Their local origin
 * is screen space, never the garage's world origin. */
export function isOsdRender(node:ResourceObject){
  for(let parent=node.parent;parent;parent=parent.parent)
    if(parent.className==='java.render.Group'||parent.className==='java.io.MouseCursor')return true;
  return false;
}
