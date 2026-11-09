export interface TrafficModel {pack:string;id:number;weight:number;parameters?:readonly number[]}
export const DEFAULT_TRAFFIC_MODELS:readonly TrafficModel[]=[{pack:'cars/traffic/pickup.rpk',id:6,weight:1}];
export const MAX_TRAFFIC_CARS=50;
export function pickTrafficModel(models:readonly TrafficModel[],random=Math.random):TrafficModel|undefined {
  const eligible=models.filter(model=>Number.isFinite(model.weight)&&model.weight>0),total=eligible.reduce((sum,model)=>sum+model.weight,0);
  if(!eligible.length||!Number.isFinite(total))return;
  let at=Math.max(0,Math.min(1,random()))*total;
  for(const model of eligible){at-=model.weight;if(at<0)return model;}
  return eligible.at(-1);
}
