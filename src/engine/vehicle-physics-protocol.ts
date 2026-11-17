import type {WorkerTelemetryPacket} from './drive-telemetry';
import type {MapTerrain} from './map-terrain';
import type {MapCollision} from './map-collision';
import type {SoftBodyBackend} from './soft-body-wasm';
import type {PhysicsControl,PhysicsCarSnapshot,PhysicsVehicleSeed} from './vehicle-physics-transfer';
export interface PhysicsScene {terrain?:ReturnType<MapTerrain['physicsSnapshot']>;walls:number[];boxes:ReturnType<MapCollision['physicsBoxes']>}
export type PhysicsRequest=
  |{kind:'add';id:number;seed:PhysicsVehicleSeed;scene?:PhysicsScene}
  |{kind:'remove';id:number}
  |{kind:'step';sequence:number;seconds:number;controls:PhysicsControl[];boxes?:PhysicsScene['boxes'];backend?:SoftBodyBackend};
export interface PhysicsResponse {
  sequence:number;workMs:number;pending:number;backend:string;
  cars:{id:number;version:number;state:PhysicsCarSnapshot;telemetry?:{id:number;packet:WorkerTelemetryPacket}}[];
  impacts:{id:number;speed:number;time:number}[];
  interactions:{id:number;box:number;hit:any}[];
  error?:string;
}
