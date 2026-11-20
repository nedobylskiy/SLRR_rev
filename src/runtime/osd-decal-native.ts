import type {Assets} from '../assets';
import {parseScxAsync} from '../formats/scx-worker-client';
import type {JavaObject,JavaValue} from 'slrr-jvm';
import type {OsdElement,OsdLayer} from '../osd/osd-layer';
import type {GameTypeNative} from './game-type-native';
import {GameObject} from './game-object';
import type {RenderObject} from './render-object';
import {FULL_OSD_VIEWPORT,osdDepth,projectOsdBounds,type OsdViewport} from './osd-depth';

interface View {key:string;group:JavaObject;render:RenderObject;element?:OsdElement;hit?:OsdElement}
/** Legacy Painter buttons own a render model beneath a GameRef icon, not a Rectangle. */
export class OsdDecalNative {
  private views=new Map<RenderObject,View>();
  private sizes=new Map<string,Promise<{width:number;height:number}>>();
  private disposed=false;
  constructor(private assets:Assets,private resources:GameTypeNative,
    private layer?:Pick<OsdLayer,'createRectangle'> & Partial<Pick<OsdLayer,'createHitTarget'>>,
    private viewport:(group:JavaValue)=>OsdViewport=()=>FULL_OSD_VIEWPORT,
    private report:(error:Error)=>void=()=>{},
    private activate?:(icon:GameObject,osd:JavaObject)=>Promise<void>){}
  sync(render:RenderObject):boolean {
    const icon=render.parent,root=icon?.parent;
    if(render.alias!=='decal button'||!(icon instanceof GameObject)||root?.className!=='java.render.Group')return false;
    if(!this.layer||!render.renderType||!render.renderResource||this.disposed)return true;
    const groupRef=this.resources.reference(root),group=groupRef.value as JavaObject;
    const type=render.renderType;
    const replacement=[...type.resourceReplacements].find(([slot])=>type.resourceReplacementPacks.has(slot));
    if(!replacement)return true;
    const [slot,id]=replacement,texture={pack:type.resourceReplacementPacks.get(slot)!,id:id&0xffff};
    if(texture.pack==='__runtime/legacy-textures.rpk'){
      this.remove(render);return true;
    }
    const osd=group.fields.get('osd')?.value as JavaObject|undefined;
    if(!osd)return true;
    const vp=this.viewport(groupRef),aspect=Number(osd.fields.get('vpAspect')?.value??1);
    const vpWidth=Number(osd.fields.get('vpWidth')?.value??1),vpHeight=Number(osd.fields.get('vpHeight')?.value??1);
    // The old createIcon overload stores its creation pose in the native params.
    const initial=icon.params?.trim().split(/[\s,]+/).slice(0,3).map(Number);
    const p=icon.poseRevision===0&&initial?.length===3&&initial.every(Number.isFinite)?{x:initial[0],y:initial[1],z:initial[2]}:icon.position;
    const key=JSON.stringify([texture,render.renderResource,p,render.position,vp,aspect,vpWidth,vpHeight]);
    const existing=this.views.get(render);if(existing?.key===key){this.visible(existing);return true;}
    existing?.element?.node.remove();existing?.hit?.node.remove();
    const view:View={key,group,render};this.views.set(render,view);
    const identity=render.renderResource,modelKey=`${identity.pack}:${identity.id}`;
    let size=this.sizes.get(modelKey);
    if(!size){size=(async()=>{
      const model=await this.assets.modelForResource(identity.pack,identity.id),parsed=await parseScxAsync(await this.assets.read(model.path));
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const mesh of parsed.meshes)for(let i=0;i<mesh.positions.length;i+=3){minX=Math.min(minX,mesh.positions[i]);maxX=Math.max(maxX,mesh.positions[i]);minY=Math.min(minY,mesh.positions[i+1]);maxY=Math.max(maxY,mesh.positions[i+1]);}
      return {width:(maxX-minX)*.01,height:(maxY-minY)*.01};
    })();this.sizes.set(modelKey,size);void size.catch(()=>this.sizes.delete(modelKey));}
    void size.then(({width,height})=>{
      if(this.disposed||render.destroyed||this.views.get(render)!==view)return;
      const bounds=projectOsdBounds(vp,(p.x+render.position.x)/(1.469*aspect*vpWidth),-(p.y+render.position.y)/(1.469*vpHeight),width/(1.469*aspect*vpWidth),height/(1.469*vpHeight));
      if(!Object.values(bounds).every(Number.isFinite))return;
      view.element=this.layer!.createRectangle(bounds.x,bounds.y,bounds.width,bounds.height,osdDepth(vp.priority,1),texture);
      view.hit=this.layer!.createHitTarget?.('Select decal',bounds.x,bounds.y,bounds.width,bounds.height,osdDepth(vp.priority,2),()=>{
        if(this.disposed||this.views.get(render)!==view||!this.shown(view))return;
        void this.activate?.(icon,osd).catch(this.report);
      });
      view.element.node.classList?.add('osd-decal-preview');this.visible(view);
    }).catch(reason=>this.report(reason instanceof Error?reason:new Error(String(reason))));
    return true;
  }
  private shown(view:View){
    const osd=view.group.fields.get('osd')?.value as JavaObject|undefined;
    return !view.render.destroyed&&!!Number(view.group.fields.get('active')?.value??0)&&osd?.fields.get('cam')?.value!=null;
  }
  private visible(view:View){for(const element of [view.element,view.hit])if(this.shown(view))element?.show();else element?.hide();}
  syncVisibility(){for(const view of this.views.values())this.sync(view.render);}
  remove(render:RenderObject){const view=this.views.get(render);view?.element?.node.remove();view?.hit?.node.remove();this.views.delete(render);}
  dispose(){this.disposed=true;for(const render of this.views.keys())this.remove(render);this.sizes.clear();}
}
