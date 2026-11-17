import {Box3,Matrix4,Vector3} from 'three';
import {MapCollision} from '../engine/map-collision';
import {MapTerrain} from '../engine/map-terrain';
import {TestTerrain} from '../engine/suspension-3d';
import {VehiclePhysicsWorld} from '../engine/vehicle-physics-world';
import {applyFields,buildPhysicsCar,capturePhysicsCar,packPhysics,unpackPhysics} from '../engine/vehicle-physics-transfer';
import {initializeSoftBodyWasm,softBodyRuntime} from '../engine/soft-body-wasm';
import type {PhysicsRequest,PhysicsResponse,PhysicsScene} from '../engine/vehicle-physics-protocol';
import type {ScxModel} from '../formats/scx';

export class VehiclePhysicsWorkerRuntime {
  world=new VehiclePhysicsWorld();
  private collision=new MapCollision();private terrain:MapTerrain|TestTerrain=new TestTerrain();
  private removeBoxes:(()=>void)[]=[];private versions=new Map<number,number>();private recordingIds=new Map<number,number>();
  private interactions:PhysicsResponse['interactions']=[];private impacts:PhysicsResponse['impacts']=[];
  private setBoxes(rows:PhysicsScene['boxes']){
    for(const remove of this.removeBoxes)remove();this.removeBoxes=[];
    for(const row of rows)this.removeBoxes.push(this.collision.addBox(new Matrix4().fromArray(row.matrix),new Vector3().fromArray(row.half),row.interactive?(body,hit)=>{
      const entry=[...this.world.entries].find(([,entry])=>entry.car.body===body);if(entry)this.interactions.push({id:entry[0],box:row.id,hit:packPhysics(hit)});
    }:undefined));
  }
  handle(request:PhysicsRequest):PhysicsResponse|undefined{
    if(request.kind==='add'){
      if(!this.world.entries.size)this.world=new VehiclePhysicsWorld(request.seed.frequency);
      if(request.scene){
        const model={version:3,warnings:[],meshes:[{positions:Float32Array.from(request.scene.walls,v=>v*100),indices:Uint32Array.from({length:request.scene.walls.length/3},(_,i)=>i)}]} as unknown as ScxModel;
        this.collision.add(model);this.setBoxes(request.scene.boxes);
        this.terrain=request.scene.terrain?MapTerrain.fromPhysicsSnapshot(request.scene.terrain,this.collision):new TestTerrain();
      }
      const car=buildPhysicsCar(request.seed,this.terrain,this.collision);
      this.world.add(request.id,{car,input:{throttle:0,steer:0,brake:false},impact:speed=>this.impacts.push({id:request.id,speed,time:car.simulationTime})});return;
    }
    if(request.kind==='remove'){this.world.entries.get(request.id)?.car.dispose();this.world.entries.delete(request.id);this.versions.delete(request.id);return;}
    const start=performance.now();this.impacts=[];this.interactions=[];
    if(request.backend)softBodyRuntime.preference=request.backend;
    if(request.boxes)this.setBoxes(request.boxes);
    for(const control of request.controls){
      const entry=this.world.entries.get(control.id);if(!entry)continue;const car=entry.car;entry.input=control.input;
      for(const command of control.commands){
        const method=(car as any)[command.method];if(typeof method!=='function'||!['reset','placeAt','settleSpawn','jump','applyImpulse','vehicleContact','setChassisCrumple','disableObstacle','rearCrash','roll','dropOnRoof'].includes(command.method))throw Error(`Invalid physics command ${command.method}`);
        method.apply(car,command.args.map(unpackPhysics));
      }
      for(const [id,condition]of control.conditions??[]){const part=car.root.world.parts.get(id);if(part)part.condition=condition;}
      applyFields(car.suspension,control.settings);
      if(control.carSettings)applyFields(car,control.carSettings);
      if(control.ramp!==undefined)car.terrain.ramp=control.ramp;
      const delta=control.bodyDelta;
      if(delta.position)car.body.position.add(new Vector3().fromArray(delta.position));
      if(delta.velocity)car.body.velocity.add(new Vector3().fromArray(delta.velocity));
      if(delta.momentum)car.body.momentum.add(new Vector3().fromArray(delta.momentum));
      if(delta.orientation)car.body.orientation.copy(unpackPhysics(delta.orientation));
      const recordingId=control.recordingId??0;
      if(control.recording&&car.suspension.mechanics&&(!car.telemetry.status.recording||this.recordingIds.get(control.id)!==recordingId)){
        car.telemetry.stop();car.telemetry.start();this.recordingIds.set(control.id,recordingId);
      }
      if(!control.recording&&car.telemetry.status.recording)car.telemetry.stop();
      this.versions.set(control.id,control.version);
    }
    this.world.advance(request.seconds);
    const cars=[...this.world.entries].map(([id,{car}])=>({id,version:this.versions.get(id)??0,state:capturePhysicsCar(car),telemetry:car.telemetry.status.recording?{id:this.recordingIds.get(id)??0,packet:car.telemetry.takeWorkerPacket()}:undefined}));
    return {sequence:request.sequence,workMs:performance.now()-start,pending:this.world.clock.pendingSeconds,backend:softBodyRuntime.available&&softBodyRuntime.preference!=='ts'?'C++/WASM worker':'TypeScript worker',
      cars,impacts:this.impacts,interactions:this.interactions};
  }
}

// Keep initialization and requests ordered even while WASM is being compiled.
if(typeof self!=='undefined'&&typeof document==='undefined'){
  const runtime=new VehiclePhysicsWorkerRuntime();let chain=initializeSoftBodyWasm().then(()=>{});
  self.onmessage=(event:MessageEvent<PhysicsRequest>)=>{const request=event.data;chain=chain.then(()=>{const result=runtime.handle(request);if(result)self.postMessage(result);}).catch(error=>{
    self.postMessage({error:error instanceof Error?error.stack??error.message:String(error)});
  });};
}
