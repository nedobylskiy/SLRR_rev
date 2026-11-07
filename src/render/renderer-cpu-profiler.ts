import type { WebGLRenderer } from 'three';
import type { FrameProfiler } from './frame-profiler';

interface Sample { matrices:number; traversal:number; sorting:number; draws:number; shadows:number; projectStart?:number }

/** Uses the installed Three.js render-list boundaries. Samples one main render in 17. */
export class RendererCpuProfiler {
  private active?:Sample;
  private frames=0;
  private shadowDepth=0;
  private wrapped=new WeakSet<object>();
  constructor(renderer:WebGLRenderer,profiler:FrameProfiler,enabled:()=>boolean) {
    const render=renderer.render.bind(renderer),direct=renderer.renderBufferDirect.bind(renderer);
    const shadow=renderer.shadowMap.render.bind(renderer.shadowMap),get=renderer.renderLists.get.bind(renderer.renderLists);
    renderer.renderLists.get=(...args)=>{
      const list=get(...args);
      if(!this.wrapped.has(list)) {
        this.wrapped.add(list);
        const init=list.init.bind(list),finish=list.finish.bind(list),sort=list.sort.bind(list);
        list.init=()=>{init();if(this.active)this.active.projectStart=performance.now();};
        list.finish=()=>{const state=this.active;try{return finish();}finally{
          if(state?.projectStart!==undefined){state.traversal+=performance.now()-state.projectStart;state.projectStart=undefined;}
        }};
        list.sort=(...args)=>{const state=this.active;if(!state)return sort(...args);const start=performance.now();
          try{return sort(...args);}finally{state.sorting+=performance.now()-start;}};
      }
      return list;
    };
    renderer.renderBufferDirect=(...args)=>{
      const state=this.active;if(!state||this.shadowDepth)return direct(...args);
      const start=performance.now();try{return direct(...args);}finally{state.draws+=performance.now()-start;}
    };
    renderer.shadowMap.render=(...args)=>{
      const state=this.active;if(!state)return shadow(...args);
      const start=performance.now();this.shadowDepth++;
      try{return shadow(...args);}finally{this.shadowDepth--;state.shadows+=performance.now()-start;}
    };
    renderer.render=(scene,camera)=>{
      if(!enabled()||this.active||++this.frames%17!==0)return render(scene,camera);
      const state:Sample={matrices:0,traversal:0,sorting:0,draws:0,shadows:0};this.active=state;
      const sceneUpdate=scene.updateMatrixWorld,cameraUpdate=camera.updateMatrixWorld;
      const start=performance.now();
      scene.updateMatrixWorld=(...args)=>{const at=performance.now();try{return sceneUpdate.apply(scene,args);}finally{state.matrices+=performance.now()-at;}};
      camera.updateMatrixWorld=(...args)=>{const at=performance.now();try{return cameraUpdate.apply(camera,args);}finally{state.matrices+=performance.now()-at;}};
      try{return render(scene,camera);}finally{
        scene.updateMatrixWorld=sceneUpdate;camera.updateMatrixWorld=cameraUpdate;this.active=undefined;
        const total=performance.now()-start;
        for(const [name,value] of Object.entries({matrices:state.matrices,'traversal + list build':state.traversal,
          sorting:state.sorting,'draw submission':state.draws,shadows:state.shadows,
          remaining:Math.max(0,total-state.matrices-state.traversal-state.sorting-state.draws-state.shadows)}))
          profiler.record(`Renderer ${name} CPU (sampled)`,value);
      }
    };
  }
}
