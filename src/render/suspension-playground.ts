import {BufferGeometry,Float32BufferAttribute,Group,Line,LineBasicMaterial,Mesh,MeshBasicMaterial,Quaternion,SphereGeometry,Vector3,type Material,type Texture} from 'three';
import type {Assets} from '../assets';
import {loadSkinnedCharacter,type SkinnedCharacter} from './skinned-character';

export type SuspensionModel='spring'|'shock'|'both';
/** Original two-root BON and SCX weights, compared with an ordinary object scale. */
export class SuspensionSkin {
  readonly scaled=new Group();readonly debug=new Group();
  private readonly line:Line;private readonly markers:Mesh[]=[];
  readonly span:number;private upper:number;private lower:number;
  private readonly scaleMeshes:Mesh[]=[];
  constructor(readonly kind:'spring'|'shock',readonly character:SkinnedCharacter){
    this.lower=character.skeleton.bones.findIndex(b=>b.name==='bone00');this.upper=character.skeleton.bones.findIndex(b=>b.name==='bone01');
    if(this.lower<0||this.upper<0||character.skeleton.bones.length!==2)throw Error('Suspension needs the original two-bone rig');
    this.span=character.restPositions[this.upper].y-character.restPositions[this.lower].y;
    if(this.span<=0)throw Error('Invalid suspension bind span');
    for(const mesh of character.meshes){const copy=new Mesh(mesh.geometry.clone(),(mesh.material as Material).clone());copy.name=`${kind} scale`;copy.castShadow=copy.receiveShadow=true;this.scaled.add(copy);this.scaleMeshes.push(copy);}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,0,this.span,0],3));
    this.line=new Line(geometry,new LineBasicMaterial({color:0x52e8cc,depthTest:false}));this.line.renderOrder=100;this.debug.add(this.line);
    for(const color of [0xffb552,0x52e8cc]){const marker=new Mesh(new SphereGeometry(.006,10,8),new MeshBasicMaterial({color,depthTest:false}));marker.renderOrder=101;this.markers.push(marker);this.debug.add(marker);}
    character.root.add(this.debug);this.setPose(1,0);
  }
  static async create(kind:'spring'|'shock',assets:Assets,texture:(bytes:Uint8Array,path:string)=>Promise<Texture>){
    // These original render descriptors have no skeleton property. The paired
    // BON is explicit here; do not replace declared human SKL bindings globally.
    const stem=kind==='spring'?'spring':'shock_absorber';
    const character=await loadSkinnedCharacter(assets,texture,'parts.rpk',kind==='spring'?0x70:0x1b6,`parts/running_gear/meshes/${stem}.bon`);
    try{return new SuspensionSkin(kind,character);}catch(error){character.dispose();throw error;}
  }
  setPose(ratio:number,tiltDegrees:number,bounds=true){
    if(!Number.isFinite(ratio)||ratio<.1||ratio>3||!Number.isFinite(tiltDegrees)||Math.abs(tiltDegrees)>30)throw Error('Invalid suspension pose');
    const bones=this.character.skeleton.bones;
    bones.forEach((bone,i)=>{bone.position.copy(this.character.restPositions[i]);bone.quaternion.copy(this.character.rest[i]);});
    bones[this.upper].position.y+=this.span*(ratio-1);
    bones[this.upper].quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),tiltDegrees*Math.PI/180));
    this.scaled.scale.y=ratio;
    this.character.refresh(bounds);
    const attribute=this.line.geometry.getAttribute('position');
    for(const [i,id] of [this.lower,this.upper].entries()){
      const point=this.character.root.worldToLocal(bones[id].getWorldPosition(new Vector3()));this.markers[i].position.copy(point);attribute.setXYZ(i,point.x,point.y,point.z);
    }
    attribute.needsUpdate=true;
  }
  difference(){
    this.character.refresh(false);let max=0,sum=0,count=0;const point=new Vector3(),scaled=new Vector3();
    for(const mesh of this.character.meshes){const base=mesh.geometry.getAttribute('position');for(let i=0;i<base.count;i++){
      mesh.getVertexPosition(i,point);scaled.fromBufferAttribute(base,i);scaled.y*=this.scaled.scale.y;const d=point.distanceTo(scaled);max=Math.max(max,d);sum+=d*d;count++;
    }}return {max,rms:Math.sqrt(sum/Math.max(1,count)),vertices:count};
  }
  dispose(){this.character.dispose();for(const mesh of this.scaleMeshes){mesh.geometry.dispose();(mesh.material as Material).dispose();}this.scaled.removeFromParent();this.line.geometry.dispose();(this.line.material as Material).dispose();for(const marker of this.markers){marker.geometry.dispose();(marker.material as Material).dispose();}}
}

export class SuspensionPlayground {
  readonly root=new Group();private ratio=1;private tilt=0;private model:SuspensionModel='shock';
  private playing=false;private start?:number;
  constructor(readonly skins:SuspensionSkin[]){
    for(const skin of skins){const left=new Group(),right=new Group();left.position.x=-.18;right.position.x=.18;left.add(skin.character.root);right.add(skin.scaled);this.root.add(left,right);}this.select('shock');
  }
  static async create(assets:Assets,texture:(bytes:Uint8Array,path:string)=>Promise<Texture>){
    const skins:SuspensionSkin[]=[];try{for(const kind of ['spring','shock'] as const)skins.push(await SuspensionSkin.create(kind,assets,texture));return new SuspensionPlayground(skins);}catch(error){for(const skin of skins)skin.dispose();throw error;}
  }
  get lengthRatio(){return this.ratio;}
  select(model:SuspensionModel){this.model=model;for(const skin of this.skins)skin.character.root.visible=skin.scaled.visible=model==='both'||model===skin.kind;}
  setPose(ratio:number,tilt=this.tilt){this.ratio=ratio;this.tilt=tilt;for(const skin of this.skins)skin.setPose(ratio,tilt);}
  animate(enabled:boolean){this.playing=enabled;this.start=undefined;}
  update(now:number){if(!this.playing)return;this.start??=now;this.setPose(.95+.4*Math.sin((now-this.start)/1000*2));}
  skeleton(enabled:boolean){for(const skin of this.skins)skin.debug.visible=enabled;}
  info(){return `Left: original bone weights · Right: scale Y · span ${(this.skins[0].span*this.ratio*100).toFixed(1)} cm / bind 24.5 cm · `+this.skins.filter(s=>this.model==='both'||s.kind===this.model).map(s=>`${s.kind}: max difference ${(s.difference().max*100).toFixed(2)} cm`).join(' · ');}
  dispose(){for(const skin of this.skins)skin.dispose();this.root.removeFromParent();}
}
