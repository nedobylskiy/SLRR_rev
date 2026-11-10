import {jv,type JavaObject,type JavaValue,type SlrrJvm} from 'slrr-jvm';
import type {GameTypeNative} from './game-type-native';
import type {RenderAnimationState,RenderObject} from './render-object';
/** Java controls playback on the RenderRef it actually created; no duplicate crowds. */
export class AnimationNative {
  private states=new Map<JavaObject,{node:RenderObject;state:RenderAnimationState}>();
  constructor(jvm:SlrrJvm,private resources:GameTypeNative){
    const owner='java.util.resource.Animation',nil=()=>jv('void',undefined);
    jvm.natives.register(owner,'<init>',['RenderRef','ResourceRef'],({receiver,args})=>{
      for(const [key,binding] of this.states)if(binding.node.resourceType!==3)this.states.delete(key);
      const node=resources.getRender(args[0]),resource=resources.getResource(args[1]);
      const identity=resource&&resources.resolveRenderResource(resource);
      if(!node||!identity)throw Error('Animation needs a live RenderRef and animation resource');
      const state:RenderAnimationState={pack:identity.pack,id:identity.id,speed:1,fade:0,playing:false,loop:false,position:0,revision:0};
      const old=this.states.get(this.object(receiver));if(old&&old.node.animation===old.state){old.node.animation=null;resources.notifyRenderChanged(old.node);}
      this.states.set(this.object(receiver),{node,state});node.animation=state;resources.notifyRenderChanged(node);return nil();
    });
    const change=(receiver:JavaValue,fn:(state:RenderAnimationState)=>void)=>{const value=this.require(receiver);if(value.node.resourceType!==3)return nil();fn(value.state);value.state.revision++;resources.notifyRenderChanged(value.node);return nil();};
    for(const name of ['setSpeed','setFade','seek'] as const)jvm.natives.register(owner,name,['float'],({receiver,args})=>change(receiver,state=>{
      const value=Number(args[0].value);if(!Number.isFinite(value)||(name!=='setSpeed'&&value<0))throw Error(`Invalid Animation.${name}`);
      if(name==='setSpeed')state.speed=value;else if(name==='setFade')state.fade=value;else state.position=value;
    }));
    jvm.natives.register(owner,'play',[],({receiver})=>change(receiver,state=>{state.loop=false;state.playing=true;}));
    jvm.natives.register(owner,'loopPlay',[],({receiver})=>change(receiver,state=>{state.loop=true;state.playing=true;}));
    jvm.natives.register(owner,'pause',[],({receiver})=>change(receiver,state=>{state.playing=false;}));
    jvm.natives.register(owner,'getPos',[],({receiver})=>jv('float',this.require(receiver).state.position));
    jvm.natives.register(owner,'finalize',[],({receiver})=>{const key=this.object(receiver),value=this.states.get(key);if(value&&value.node.animation===value.state){value.node.animation=null;resources.notifyRenderChanged(value.node);}this.states.delete(key);return nil();});
  }
  private object(value:JavaValue){if(!value.value||typeof value.value!=='object'||!('fields' in value.value))throw Error('Invalid Animation receiver');return value.value as JavaObject;}
  private require(receiver:JavaValue){const state=this.states.get(this.object(receiver));if(!state)throw Error('Animation has not been initialized');return state;}
  dispose(){for(const {node,state} of this.states.values())if(node.animation===state){node.animation=null;this.resources.notifyRenderChanged(node);}this.states.clear();}
}
