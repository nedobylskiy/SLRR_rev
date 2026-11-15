import type {RoadNetwork} from '../formats/trc';
import type {PedestrianWalk} from '../formats/pedestrian';
import type {TrafficCursor} from './road-traffic';
import type {TrafficControlState} from './traffic-control';
import type {BotMode} from './bot';
import type {DrivingInput} from './driving-demo';
import type {TrafficHalts} from './traffic-models';
export interface BodyState {position:number[];orientation:number[];velocity:number[];omega:number[];min:number[];max:number[];center:number[];mass:number}
export interface TrafficAgentState {id:number;revision:number;body:BodyState;cursor:TrafficCursor;collision:number;physical:boolean;wheelbase:number;maxSteer:number;speed:number;mode:BotMode}
export interface TrafficAgentResult {id:number;revision:number;collision:number;haltsRevision:number;cursor:TrafficCursor;input:DrivingInput;mode:BotMode;rpm:number;speed:number;desired:number;status:string}
export interface WalkerState {id:number;revision:number;zone:number;position:number[];direction:number[];heading?:number[];t:number;sign:1|-1;lateral:number}
export interface WalkerResult {id:number;revision:number;zone:number;position:number[];direction:number[];heading?:number[];speed:number;gait:number;ok:boolean;t:number;sign:1|-1}
export type AgentRequest = {kind:'traffic-init';network:RoadNetwork;control:TrafficControlState}|{kind:'pedestrian-init';rows:PedestrianWalk[]}
 |{kind:'traffic';dt:number;time:number;agents:TrafficAgentState[];peer?:BodyState;halts?:TrafficHalts}
 |{kind:'pedestrian';dt:number;agents:WalkerState[];threats:{position:number[];velocity:number[]}[]};
export type AgentResult={kind:'traffic';agents:TrafficAgentResult[]}|{kind:'pedestrian';agents:WalkerResult[]};
