import {jv,type JavaObject,type JavaValue,type SlrrJvm} from 'slrr-jvm';
import type {GameTypeNative} from './game-type-native';
import type {ViewportNative} from './viewport-native';
import type {CameraNative} from './camera-native';
import type {RenderObject} from './render-object';
export type NavigatorMode='java'|'north'|'heading';
export interface NavigatorMarker {symbol:RenderObject;x:number;z:number;yaw:number;dynamic:boolean}
export interface NavigatorFrame {id:JavaObject;viewport:{left:number;top:number;width:number;height:number;priority:number};x:number;z:number;yaw:number;height:number;fov:number;tiles:RenderObject[];markers:NavigatorMarker[];route:[number,number,number][]}
function object(value:unknown):JavaObject|undefined{const raw=value&&typeof value==='object'&&'value'in value?(value as JavaValue).value:value;return raw&&typeof raw==='object'&&'fields'in raw?raw as JavaObject:undefined;}
function field(owner:JavaObject|undefined,name:string){return owner?.fields.get(name);}
function number(owner:JavaObject|undefined,name:string,fallback=0){const n=Number(field(owner,name)?.value);return Number.isFinite(n)?n:fallback;}
function array(value:JavaValue|undefined):JavaValue[]{return Array.isArray(value?.value)?value!.value.map(item=>item&&typeof item==='object'&&'fields'in item?jv((item as JavaObject).className,item):item) as JavaValue[]:[];}
function vector(owner:JavaObject,name:string){const list=object(field(owner,name));return array(field(list,'elementData')).slice(0,Math.max(0,number(list,'elementCount')));}
/** Clamp in authored smallmap space, using the live grid instead of assuming an 8x8 city. */
export function navigatorCenter(x:number,z:number,height:number,aspect:number,bounds:{minX:number;maxX:number;minZ:number;maxZ:number},fov=90){
 const halfZ=height*Math.tan(fov*Math.PI/360),halfX=halfZ*aspect;
 const clamp=(v:number,min:number,max:number,margin:number)=>max-min<=margin*2?(min+max)/2:Math.max(min+margin,Math.min(max-margin,v));
 return {x:clamp(x,bounds.minX,bounds.maxX,halfX),z:clamp(z,bounds.minZ,bounds.maxZ,halfZ)};
}
/** Java still owns Navigator construction, resources, marker lists and viewport lifetime. */
export class NavigatorNative {
 private states=new Map<JavaObject,{receiver:JavaValue;followed:JavaValue;mode:number}>();
 mode:NavigatorMode='java';
 /** Larger values show a closer view without overwriting Java's own zoom. */
 zoomScale=1;
 constructor(jvm:SlrrJvm,private resources:GameTypeNative,private viewports:ViewportNative,private cameras:CameraNative){
  jvm.natives.register('java.game.Navigator','updateNavigator',['GameRef','int'],({receiver,args})=>{
   const key=object(receiver);if(key)this.states.set(key,{receiver,followed:args[0],mode:Number(args[1].value)});return jv('void',undefined);
  });
 }
 private pose(value:JavaValue|undefined){
  if(value?.value==null)return;const node=this.resources.getResource(value);if(!node||!('position'in node)||!('orientation'in node))return;
  const pose=node as RenderObject;return {x:pose.position.x,z:pose.position.z,yaw:pose.orientation.y};
 }
 frames(aspect:number):NavigatorFrame[]{
  const frames:NavigatorFrame[]=[];
  for(const [key,state]of this.states){
   const camRef=field(key,'cam'),vpRef=field(key,'vp');if(!camRef?.value||!vpRef?.value){this.states.delete(key);continue;}
   const cam=this.resources.getRender(camRef),camera=this.cameras.get(camRef),viewport=this.viewports.get(vpRef);if(!cam?.resourceType||!camera||!viewport?.active)continue;
   const mode=this.mode==='java'?state.mode:this.mode==='heading'?1:0,pose=this.pose(state.followed);if(!pose)continue;
   const tiles=array(field(key,'tiles')).map(ref=>ref?.value?this.resources.getRender(ref):undefined).filter((node):node is RenderObject=>!!node&&!!node.resourceType);
   const height=Math.max(.01,(cam.position.y||number(key,'zoom',4.5))/this.zoomScale),fov=Math.max(1,Math.min(170,camera.halfAov*2||90));
   let x=(pose.x+number(key,'offsetX'))*.01,z=(pose.z+number(key,'offsetZ'))*.01,yaw=mode===1?pose.yaw:cam.orientation.y;
   if(mode===0&&tiles.length){const size=number(key,'size');if(size>0){const bounds={minX:Math.min(...tiles.map(t=>t.position.x)),maxX:Math.max(...tiles.map(t=>t.position.x))+size,minZ:Math.min(...tiles.map(t=>t.position.z)),maxZ:Math.max(...tiles.map(t=>t.position.z))+size};const center=navigatorCenter(x,z,height,aspect*viewport.width/viewport.height,bounds,fov);x=center.x;z=center.z;}}
   if(number(key,'type')===4&&this.mode==='java'){x=cam.position.x;z=cam.position.z;yaw=cam.orientation.y;}
   const markers:NavigatorMarker[]=[];
   for(const dynamic of [false,true])for(const entry of vector(key,dynamic?'dynamarker':'marker')){
    const owner=object(entry),symbolRef=field(owner,'symbol');if(!symbolRef?.value)continue;const symbol=this.resources.getRender(symbolRef);if(!symbol?.resourceType)continue;
    const point=dynamic?this.pose(field(owner,'mover')):(()=>{const p=object(field(owner,'pos'));return p?{x:number(p,'x'),z:number(p,'z'),yaw:0}:undefined;})();
    if(point)markers.push({symbol,...point,dynamic});
   }
   const route=array(field(key,'routeData')).map(v=>object(v)).filter((v):v is JavaObject=>!!v).map(v=>[number(v,'x')*.01,.002,number(v,'z')*.01] as [number,number,number]);
   frames.push({id:key,viewport,x,z,yaw,height,fov,tiles,markers,route});
  }
  return frames.sort((a,b)=>a.viewport.priority-b.viewport.priority);
 }
 dispose(){this.states.clear();}
}
