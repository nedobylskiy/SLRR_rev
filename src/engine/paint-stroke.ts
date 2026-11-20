import type {ResourceKey} from './world';
export interface PaintStroke {
  position:[number,number,number];normal:[number,number,number];color:number;
  tangent?:[number,number,number];
  brush:ResourceKey;size:number;rotation:number;flip:boolean;temporary:boolean;
}
export interface PaintTarget {id:number;position:[number,number,number];normal:[number,number,number];tangent?:[number,number,number]}
