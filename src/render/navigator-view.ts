import {BufferAttribute,BufferGeometry,Color,DoubleSide,Group,Line,LineBasicMaterial,Mesh,MeshBasicMaterial,PerspectiveCamera,RepeatWrapping,Scene,SRGBColorSpace,Vector2,Vector3,WebGLRenderer,type Texture} from 'three';
import type {Assets,ResourceOverrides} from '../assets';
import {parseScxAsync} from '../formats/scx-worker-client';
import type {RenderObject} from '../runtime/render-object';
import type {NavigatorFrame} from '../runtime/navigator-native';
import {DDSLoader} from 'three/addons/loaders/DDSLoader.js';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';
import {TextureLoader} from 'three';
import {ptxTexture} from './ptx-texture';
/** Projected symbol clamp preserves its direction instead of independently clamping X/Y. */
export function clampNavigatorMarker(x:number,y:number){const scale=Math.min(1,.9/Math.max(Math.abs(x),1e-12),.85/Math.max(Math.abs(y),1e-12));return {x:x*scale,y:y*scale};}
/** A tiny unlit pass in the Java OSD stage; never touches the world streamer, lights or Hi-Z. */
export class NavigatorView {
 readonly canvas=document.createElement('canvas');
 private renderer?:WebGLRenderer;private scene=new Scene();private camera=new PerspectiveCamera();
 private templates=new Map<string,Promise<Group>>();private textures=new Map<string,Promise<Texture>>();
 private instances=new Map<number,{key:string;group?:Group}>();private disposed=false;private pending=0;private tasks:(()=>Promise<void>)[]=[];
 private route?:Line;private routeKey='';private raf=0;private last=0;private current?:object;
 constructor(private stage:HTMLElement,private assets:Assets,private source:()=>NavigatorFrame[],private report:(message:string)=>void,private resolveRid:(id:number)=>{pack:string;id:number}|undefined=()=>undefined){
  this.canvas.className='navigator-canvas';this.canvas.setAttribute('aria-label','Java minimap');this.canvas.style.cssText='position:absolute;pointer-events:none;z-index:1;display:none;';stage.append(this.canvas);this.canvas.hidden=true;
  const tick=(now:number)=>{if(this.disposed)return;this.raf=requestAnimationFrame(tick);if(now-this.last<33)return;this.last=now;try{this.draw();}catch(error){this.report(`Minimap: ${String(error)}`);this.source=()=>[];this.canvas.hidden=true;}};this.raf=requestAnimationFrame(tick);
 }
 private enqueue(work:()=>Promise<void>){this.tasks.push(work);this.pump();}
 private pump(){while(this.pending<3&&this.tasks.length&&!this.disposed){this.pending++;void this.tasks.shift()!().catch(error=>{if(!this.disposed)this.report(`Minimap resource: ${String(error)}`);}).finally(()=>{this.pending--;this.pump();});}}
 private texture(path:string){let pending=this.textures.get(path.toLowerCase());if(!pending){pending=(async()=>{const bytes=await this.assets.read(path);let texture:Texture;if(/\.ptx$/i.test(path))texture=await ptxTexture(bytes);else{const url=URL.createObjectURL(new Blob([bytes.slice().buffer]));try{texture=await (/\.dds$/i.test(path)?new DDSLoader():/\.tga$/i.test(path)?new TGALoader():new TextureLoader()).loadAsync(url);}finally{URL.revokeObjectURL(url);}}texture.flipY=false;texture.wrapS=texture.wrapT=RepeatWrapping;texture.colorSpace=SRGBColorSpace;return texture;})();this.textures.set(path.toLowerCase(),pending);}return pending;}
 private key(node:RenderObject){return `${node.renderResource?.pack}:${node.renderResource?.id}|${[...node.renderType?.resourceReplacements??[]].map(([a,b])=>`${a}:${b}:${node.renderType?.resourceReplacementPacks.get(a)}`).join(',')}`;}
 private model(node:RenderObject,key:string){let template=this.templates.get(key);if(!template){const identity=node.renderResource;if(!identity)return Promise.resolve(new Group());const type=node.renderType;
  const overrides:ResourceOverrides|undefined=type?{replacements:new Map(),replacementPacks:new Map(type.resourceReplacementPacks),sourcePacks:type.resourceReplacementSourcePacks}:undefined;
  if(type&&overrides)for(const [before,after]of type.resourceReplacements){const resolved=this.resolveRid(after);(overrides.replacements as Map<number,number>).set(before,resolved?.id??after);if(resolved)(overrides.replacementPacks as Map<number,string>).set(before,resolved.pack);}
  template=(async()=>{const model=await this.assets.modelForResource(identity.pack,identity.id,new Set(),overrides),parsed=await parseScxAsync(await this.assets.read(model.path)),group=new Group();
   for(const mesh of parsed.meshes){const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(Float32Array.from(mesh.positions,v=>v*.01),3));geometry.setAttribute('uv',new BufferAttribute(mesh.uv,2));geometry.setIndex(new BufferAttribute(mesh.indices,1));geometry.computeBoundingSphere();
    const path=model.textures[mesh.textureIndex],map=path?await this.texture(path):undefined,material=new MeshBasicMaterial({map,color:map?0xffffff:new Color(mesh.diffuse[0]??1,mesh.diffuse[1]??1,mesh.diffuse[2]??1),side:DoubleSide,transparent:node.alias==='marker',alphaTest:node.alias==='marker'?.02:0,depthWrite:node.alias!=='marker',toneMapped:false});group.add(new Mesh(geometry,material));
   }return group;})();this.templates.set(key,template);
 }return template;}
 private instance(node:RenderObject,used:Set<number>){used.add(node.id);const key=this.key(node);let entry=this.instances.get(node.id);if(entry?.key===key)return entry.group;
  entry?.group?.removeFromParent();entry={key};this.instances.set(node.id,entry);const adopted=entry;
  this.enqueue(async()=>{const template=await this.model(node,key);if(this.disposed||this.instances.get(node.id)!==adopted)return;adopted.group=template.clone(true);this.scene.add(adopted.group);});return;
 }
 private draw(){
  const stageW=this.stage.clientWidth,stageH=this.stage.clientHeight;if(!stageW||!stageH)return;
  const frame=this.source().at(-1);this.canvas.hidden=!frame;this.canvas.style.display=frame?'block':'none';if(!frame){if(this.current){this.instances.forEach(v=>v.group?.removeFromParent());this.instances.clear();this.current=undefined;}return;}
  if(!this.renderer){this.renderer=new WebGLRenderer({canvas:this.canvas,alpha:true,antialias:false,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0x233024,1);}
  const {viewport:vp}=frame,w=Math.max(1,Math.round(stageW*vp.width)),h=Math.max(1,Math.round(stageH*vp.height));
  this.canvas.style.left=`${vp.left*100}%`;this.canvas.style.top=`${vp.top*100}%`;this.canvas.style.width=`${vp.width*100}%`;this.canvas.style.height=`${vp.height*100}%`;
  if(this.renderer.getSize(new Vector2()).x!==w||this.renderer.getSize(new Vector2()).y!==h)this.renderer.setSize(w,h,false);
  this.canvas.dataset.map=frame.tiles[0]?.renderResource?.pack??'route';this.canvas.dataset.tiles=String(frame.tiles.length);this.canvas.dataset.markers=String(frame.markers.length);
  this.current=frame.id;this.camera.aspect=w/h;this.camera.fov=frame.fov;this.camera.near=.1;this.camera.far=Math.max(100,frame.height*4);this.camera.position.set(frame.x,frame.height,frame.z);this.camera.up.set(-Math.sin(frame.yaw),0,-Math.cos(frame.yaw));this.camera.lookAt(frame.x,0,frame.z);this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);
  const used=new Set<number>();
  for(const tile of frame.tiles){const group=this.instance(tile,used);if(group){group.position.set(tile.position.x,tile.position.y,tile.position.z);group.rotation.set(tile.orientation.p,tile.orientation.y,tile.orientation.r,'YXZ');group.scale.set(tile.meshScale.x,tile.meshScale.y,tile.meshScale.z);}}
  for(const marker of frame.markers){const group=this.instance(marker.symbol,used);if(!group)continue;const point=new Vector3(marker.x*.01,0,marker.z*.01),projected=point.clone().project(this.camera),clamped=clampNavigatorMarker(projected.x,projected.y);point.set(clamped.x,clamped.y,projected.z).unproject(this.camera);group.position.copy(point);group.position.y=.031;group.rotation.set(0,marker.yaw,0);group.renderOrder=10;group.traverse(o=>{o.renderOrder=10;});}
  for(const [id,entry]of this.instances)if(!used.has(id)){entry.group?.removeFromParent();this.instances.delete(id);}
  const routeKey=frame.route.map(p=>p.join(',')).join(';');if(routeKey!==this.routeKey){this.route?.removeFromParent();this.route?.geometry.dispose();if(this.route)(this.route.material as LineBasicMaterial).dispose();this.route=undefined;this.routeKey=routeKey;if(frame.route.length>1){this.route=new Line(new BufferGeometry().setFromPoints(frame.route.map(p=>new Vector3(...p))),new LineBasicMaterial({color:0xff4a31,depthTest:false}));this.route.renderOrder=5;this.scene.add(this.route);}}
  this.renderer.render(this.scene,this.camera);
 }
 private disposeTemplate(group:Group){group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();(o.material as MeshBasicMaterial).dispose();}});}
 dispose(){this.disposed=true;cancelAnimationFrame(this.raf);this.tasks=[];this.instances.clear();for(const pending of this.templates.values())void pending.then(g=>this.disposeTemplate(g)).catch(()=>{});for(const pending of this.textures.values())void pending.then(t=>t.dispose()).catch(()=>{});this.templates.clear();this.textures.clear();this.route?.geometry.dispose();if(this.route)(this.route.material as LineBasicMaterial).dispose();this.renderer?.dispose();this.renderer?.forceContextLoss();this.canvas.remove();}
}
