import {BufferGeometryLoader,type BufferGeometry} from 'three';
import {simplifyPlaygroundGeometry} from './playground-simplify';
self.onmessage=(event:MessageEvent<{ratio:number;geometries:ReturnType<BufferGeometry['toJSON']>[]}>)=>{
  try{
    const loader=new BufferGeometryLoader();let kept=0;
    const geometries=event.data.geometries.map(json=>{
      const source=loader.parse(json),result=simplifyPlaygroundGeometry(source,event.data.ratio);
      if((result.index?.count??result.getAttribute('position').count)===(source.index?.count??source.getAttribute('position').count))kept++;
      const output=result.toJSON();result.dispose();source.dispose();return output;
    });
    self.postMessage({geometries,kept});
  }catch(error){self.postMessage({error:String(error)});}
};
