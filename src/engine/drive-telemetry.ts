import type { DrivingInput } from './driving-demo';
import type { Vehicle3D } from './vehicle-3d';
import { ackermannSteerAngle } from './suspension-3d';
import type {RouteBenchmark,RoutePose,RouteView,RouteVehicle} from './route-benchmark';

type Fields = Record<string, string | number>;
interface Session { metadata: Fields; engine: Fields; curves: Fields[]; samples: Fields[]; frames:Fields[]; ended: boolean }

/** Opt-in 10-Hz physics capture plus per-render-frame CPU profiling. */
export class DriveTelemetry {
  private session?: Session;
  private elapsed = 0;
  private nextSample = 0.1;
  private reason = '';
  private route?:RouteBenchmark;
  private viewSource?:()=>Omit<RouteView,'t'>;
  private lastInput:DrivingInput={throttle:0,steer:0,brake:false};
  private lastRenderTime?:number;
  private frameTime?:number;
  private lastAdvance=-1;
  private wallStart=0;
  readonly maxFrames=36000;
  recordPerformanceFrame(now:number,cpu:Record<string,number>,hidden=false){
    if(!this.session||this.session.ended||hidden){this.frameTime=undefined;return;}
    const previous=this.frameTime;this.frameTime=now;
    const v=this.vehicle,fresh=v.advanceVersion!==this.lastAdvance;this.lastAdvance=v.advanceVersion;
    const t=fresh?v.timings:Object.fromEntries(Object.keys(v.timings).map(k=>[k,0])) as typeof v.timings;
    const row:Fields={seq:this.session.frames.length,wall_s:(performance.now()-this.wallStart)/1000,raf_timestamp_ms:now,sim_s:this.elapsed,
      frame_interval_ms:previous===undefined?0:Math.max(0,now-previous),physics_dt_s:v.physicsDt,
      physics_ticks:t.ticks,active_panel_steps:t.activePanels,node_steps:t.nodeSteps,beam_constraint_iterations:t.beamIterations,body_refits:t.surfaceUpdates,collision_bvh_builds:t.surfaceBuilds,collision_bvh_refits:t.surfaceRefits,collision_triangles_updated:t.surfaceTriangles,collision_parts_updated:t.surfaceParts,collision_vertices_skinned:t.surfaceVertices,
      pending_physics_ms:v.simulationPendingSeconds*1000,
      constraints_ms:t.panelConstraints,panel_contacts_ms:t.panelContacts,wasm_upload_ms:t.panelUpload,
      integration_finalize_ms:t.panelIntegration,loose_contacts_ms:t.looseContacts,chassis_contacts_ms:t.contacts,
      body_collision_geometry_ms:t.panelSurface,physics_panels_ms:t.panels,physics_other_ms:t.other,physics_suspension_ms:t.suspension};
    for(const [name,value] of Object.entries(cpu))row['cpu_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/_$/,'')+'_ms']=value;
    let sleeping=0,loose=0,wasm=0,ts=0;
    for(const state of v.soft.values()){if(state.panel.backend==='wasm')wasm++;else ts++;if(!state.root&&!state.part.parent){loose++;if(state.activity.resting)sleeping++;}}
    Object.assign(row,{sleeping_debris:sleeping,loose_panels:loose,wasm_panels:wasm,ts_panels:ts});
    this.session.frames.push(row);
    if(this.session.frames.length>=this.maxFrames)this.stop('frame_limit');
  }
  recordRenderFrame(now:number,info:{calls:number;triangles:number;width:number;height:number},hidden=false){
    if(!this.route||!this.status.recording||hidden){this.lastRenderTime=undefined;return;}
    const previous=this.lastRenderTime;this.lastRenderTime=now;
    if(previous===undefined||now<=previous)return;
    const source=this.route.sourceRender!;if(source.frameIntervalsMs.length>=432000)return;
    source.frameIntervalsMs.push(now-previous);source.drawCallsSum+=info.calls;source.trianglesSum+=info.triangles;
    source.width=info.width;source.height=info.height;
  }
  setViewSource(source:()=>Omit<RouteView,'t'>){this.viewSource=source;}
  private pose():RoutePose{
    const v=this.vehicle,m=v.suspension.mechanics!,b=v.body;
    return {t:this.elapsed,position:b.position.toArray(),rotation:b.orientation.toArray(),velocity:b.velocity.toArray(),angularVelocity:b.omega.toArray(),
      rpm:m.rpm,gear:m.gear,running:m.running,manual:m.manual,temperature:m.temperature,steer:v.suspension.steer,
      wheels:v.suspension.wheels.map(w=>({omega:w.omega,spin:w.spin,length:w.length,slip:w.nativeSlip.longitudinal,angle:w.nativeSlip.angle}))};
  }
  recordView(){
    if(!this.route||!this.status.recording||!this.viewSource)return;
    if(this.route.views.length&&this.elapsed-this.route.views.at(-1)!.t<.05-1e-9)return;
    this.route.views.push({t:this.elapsed,...this.viewSource()});
  }
  readonly maxSamples = 18000;
  constructor(private readonly vehicle: Vehicle3D) {}
  get status() { return { available: !!this.vehicle.suspension?.mechanics, recording: !!this.session && !this.session.ended,
    samples: this.session?.samples.length ?? 0, frames:this.session?.frames.length??0, seconds: this.elapsed, reason: this.reason, hasData: !!(this.session?.samples.length||this.session?.frames.length) }; }
  start(context: Fields = {}) {
    if (this.status.recording) throw new Error('Telemetry is already recording');
    const v = this.vehicle, m = v.suspension.mechanics;
    if (!m) throw new Error('No physical engine available');
    const p = v.root.world.javaPowertrain?.state?.parameters ?? {};
    this.elapsed = 0; this.nextSample = 0.1; this.reason = '';this.lastRenderTime=undefined;this.frameTime=undefined;this.wallStart=performance.now();this.lastAdvance=v.advanceVersion;
    const names = (prefix: string, name: string): Fields => ({ [`${prefix}_length`]: name.length,
      ...Object.fromEntries(Array.from({length:name.length},(_,i) => [`${prefix}_code_${i}`,name.charCodeAt(i)])) });
    const values = m.transmission?.definition.mechanics?.values ?? {};
    this.session = { ended: false, metadata: { source: 'redline-rebuilt', recorder_features: 'host_physics_v1 frame_cpu_v1',
      started_utc: new Date().toISOString(), frame_cpu_version:1,frame_limit:this.maxFrames,interval_s: 0.1, physics_dt_s: v.physicsDt,
      ...names('model',v.root.definition.alias), ...names('vehicle',v.root.definition.alias),
      chassis_pack: v.root.definition.key.pack, chassis_type: v.root.definition.key.id,
      mass_kg: v.body.mass, mass_source: 'host_rigid_body_kg', idle_rpm: m.idleRpm, redline_rpm: m.redlineRpm,
      engine_inertia: p.engine_inertia ?? 0, engine_mass: p.engine_mass ?? 0,
      torque_curve_source: v.root.world.javaPowertrain?.curve ? 'java_dyno' : 'fallback_estimate',
      final_drive: p.rearend_ratio ?? values.end_ratio ?? 1, clutch_force: p.ClutchF ?? 0,
      starter_torque: p.starter_torque ?? values.starter_torque ?? 40,
      transmission_mode: m.manual ? 'manual_shift' : 'automatic',
      control_source: 'applied_host_input_not_native_AIparam', boost_source: 'host_estimate_not_measured_pressure',
      tire_model: v.suspension.tireModel.model, tire_settings: JSON.stringify(v.suspension.tireModel),
      experimental_hub_geometry: Number(v.root.world.experimentalHubGeometry),
      ...Object.fromEntries(Array.from({ length: 8 }, (_,i) => [`ratio_${i}`,v.root.world.javaPowertrain?.state?.ratios[i] ?? values[`ratio[${i}]`] ?? 0])), ...context },
      engine: { ...names('engine',m.block?.definition.alias ?? 'unknown'), wear: m.block?.condition ?? 0, displacement_m3: m.displacement },
      curves: Array.from({ length: Math.floor(m.redlineRpm/500)+1 }, (_,i) => ({ rpm: i*500, torque_nm: m.estimateFlywheelTorqueAt(i*500) })), samples: [],frames:[] };
    this.route=undefined;
    if(this.viewSource){
      const world=v.root.world,powertrain=world.javaPowertrain;
      const vehicle:RouteVehicle=structuredClone({root:v.root.id,mechanical:world.mechanical,experimentalHubGeometry:world.experimentalHubGeometry,bodyCenter:v.body.center.toArray(),mass:v.body.mass,
        powertrain:powertrain?{curve:powertrain.curve,state:powertrain.state,cooling:powertrain.cooling}:undefined,wheelRefs:world.wheelRefs,
        parts:[...world.parts.values()].map(part=>({id:part.id,parent:part.parent?.id,parentSlot:part.parentSlot,ownSlot:part.ownSlot,
          definition:part.definition,matrix:(v.assemblyLocal?.(part)??part.local).toArray(),renderAdjustment:part.renderAdjustment.toArray(),renderVisible:part.renderVisible,condition:part.condition,paintTexture:part.paintTexture,
          wheelFrameOffsetY:part.wheelFrameOffsetY,wheelFrameOffsets:part.wheelFrameOffsets.map(v=>[...v]),
          slotPositions:[...part.slotPositions],slotRotations:[...part.slotRotations]}))});
      this.route={format:'slrr-route-benchmark',version:1,metadata:{...this.session.metadata},vehicle,poses:[this.pose()],views:[],
        sourceRender:{frameIntervalsMs:[],drawCallsSum:0,trianglesSum:0,width:0,height:0},
        controls:[{t:0,input:{...this.lastInput}}],limitations:['Physics replay restores a projected assembly and sampled initial state, not solver warm-start/contact caches or pre-existing soft-body deformation. Start recording with a restored, stationary car.']};
      this.recordView();
    }
  }
  tick(dt: number, input: DrivingInput) {
    this.lastInput=input;
    if (!this.session || this.session.ended) return;
    if(this.route){
      const previous=this.route.controls.at(-1)!.input;
      if((['throttle','steer','brake','clutch','gearUp','gearDown','neutral','start','throttleMode'] as const).some(key=>previous[key]!==input[key])){
        const event={t:this.elapsed,input:{...input}};
        if(this.route.controls.at(-1)!.t===this.elapsed)this.route.controls[this.route.controls.length-1]=event;else this.route.controls.push(event);
      }
    }
    this.elapsed += dt;
    if (this.elapsed + 1e-9 < this.nextSample) return;
    this.nextSample += 0.1;
    const v = this.vehicle, m = v.suspension.mechanics!, body = v.body;
    const localVelocity = body.velocity.clone().applyQuaternion(body.orientation.clone().invert());
    const row: Fields = { t: this.elapsed, rpm: m.rpm, speed_mps: body.velocity.length(),
      gear_param6: m.gear, shifting: Number(m.shifting), throttle_param0: Math.abs(input.throttle),
      brake_param1: Number(input.brake), clutch_param4: Number(!!input.clutch), steer_param3: input.steer,
      throttle_signed: input.throttle, throttle_mode: input.throttleMode ?? 'directional', temperature_raw: m.temperature,
      engine_running: Number(m.running), starter_active: Number(m.starting), engine_health: m.power, boost_host_bar: m.boost,
      manual_shift: Number(m.manual), position_x: body.position.x, position_y: body.position.y, position_z: body.position.z,
      longitudinal_mps: -localVelocity.z, lateral_mps: localVelocity.x, vertical_mps: localVelocity.y,
      yaw_rate_rad_s: body.omega.clone().applyQuaternion(body.orientation.clone().invert()).y };
    Object.assign(row,{rotation_x:body.orientation.x,rotation_y:body.orientation.y,rotation_z:body.orientation.z,rotation_w:body.orientation.w,
      velocity_x:body.velocity.x,velocity_y:body.velocity.y,velocity_z:body.velocity.z,
      angular_velocity_x:body.omega.x,angular_velocity_y:body.omega.y,angular_velocity_z:body.omega.z,
      gear_up:Number(!!input.gearUp),gear_down:Number(!!input.gearDown),neutral:Number(!!input.neutral),start:Number(!!input.start)});
    v.suspension.wheels.forEach((w,i) => Object.assign(row, { [`wheel_${i}_omega_rad_s`]: w.omega,
      [`wheel_${i}_radius_m`]: w.radius, [`wheel_${i}_slip`]: w.slip, [`wheel_${i}_slip_speed_mps`]: w.slipSpeed,
      [`wheel_${i}_lateral_mps`]: w.lateralSpeed, [`wheel_${i}_contact`]: Number(w.contact),
      [`wheel_${i}_load_n`]: w.force, [`wheel_${i}_travel_m`]: w.length,
      [`wheel_${i}_steer_rad`]: ackermannSteerAngle(v.suspension.steer, w.center.x, v.root.definition.config.ackermann ?? 2, w.steering) }));
    this.session!.samples.push(row);
    this.route?.poses.push(this.pose());
    if (this.session!.samples.length >= this.maxSamples) this.stop('sample_limit');
  }
  stop(reason = 'button') { if (this.status.recording) { this.session!.ended = true; this.reason = reason; } }
  benchmarkText(){return this.route?JSON.stringify({...this.route,metadata:{...this.route.metadata,stop_reason:this.reason}}):undefined;}
  /** Same short-field protocol as the original recorder; the existing v2 exporter accepts it. */
  text() {
    if (!this.session) return '';
    const lines: string[] = [], encode = (value: string | number) => String(value).replace(/[|\r\n]/g,' ');
    const packet = (kind: string, seq: number, fields: Fields) => {
      const prefix = `SLRR_PHYSICS|v=2|run=1|seq=${seq}|kind=${kind}|`;
      lines.push(prefix+'key=status|value=begin');
      for (const [key,value] of Object.entries(fields)) lines.push(`${prefix}key=${key}|value=${encode(value)}`);
      lines.push(prefix+'key=status|value=end');
    };
    packet('meta',0,{ ...this.session.metadata, stop_reason: this.reason }); packet('engine',0,this.session.engine);
    this.session.curves.forEach((row,i) => packet('curve',i,row));
    this.session.samples.forEach((row,i) => packet('sample',i,row));
    // Separate prefix keeps archived SLRR_PHYSICS v2 parsers compatible.
    for(const row of this.session.frames)lines.push('SLRR_FRAME|v=1|'+JSON.stringify(row));
    if (this.session.ended) lines.push('SLRR_PHYSICS|v=2|run=1|seq=0|kind=end|key=status|value=end');
    return lines.join('\n')+'\n';
  }
}
