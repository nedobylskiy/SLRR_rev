import type {ResourceKey} from './world';
export interface PaintStroke {
  position:[number,number,number];normal:[number,number,number];color:number;
  brush:ResourceKey;size:number;rotation:number;flip:boolean;temporary:boolean;
}
