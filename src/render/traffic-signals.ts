import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Group, Points, PointsMaterial, SRGBColorSpace, Vector3 } from 'three';
import type { Assets } from '../assets';
import { poseMatrix } from '../engine/world';
import { entryProperties } from '../formats/rpk';
import type { TrafficControl } from '../engine/traffic-control';
import { ptxTexture } from './ptx-texture';

/** CFG `light` points to a billboard render here (type 14), not a type-13 light source. */
export async function trafficSignalGlowTexture(assets:Assets){
  const render=await assets.resource('objects.rpk',0x30006);
  if(render.entry.type!==14)throw Error('Traffic signal glow is not a render resource');
  const id=entryProperties(render.entry).find(property=>property.key==='texture')?.value;
  if(!id)throw Error('Traffic signal glow texture reference missing');
  const texture=await assets.resource(render.packPath,Number(id));
  const path=entryProperties(texture.entry).find(property=>property.key==='sourcefile')?.value;
  if(!path)throw Error('Traffic signal glow texture file missing');
  return path;
}

/** All signal glows share one draw; state and position uploads occur only on phase changes. */
export async function createTrafficSignals(assets:Assets,control:TrafficControl){
  const root=new Group();root.name='Traffic signal glows';
  const path=await trafficSignalGlowTexture(assets),map=await ptxTexture(await assets.read(path));map.colorSpace=SRGBColorSpace;
  const geometry=new BufferGeometry(),positions=new Float32Array(control.signals.length*3),colors=new Float32Array(positions.length);
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  const material=new PointsMaterial({map,color:0xffffff,vertexColors:true,size:1.4,sizeAttenuation:true,transparent:true,alphaTest:.02,depthTest:true,depthWrite:false,blending:AdditiveBlending,toneMapped:false,fog:true});
  const points=new Points(geometry,material);points.raycast=()=>{};root.add(points);
  let previous=-1;
  const update=()=>{
    const stamp=control.phaseRevision;if(stamp===previous)return;previous=stamp;
    const position=geometry.getAttribute('position'),color=geometry.getAttribute('color'),point=new Vector3(),tint=new Color();
    control.signals.forEach((signal,i)=>{
      // Lens centres measured on the installed trafficlamp_body SCX. Native class defaults
      // (.2, -.1, -.4) place this build's glow between lenses rather than on their faces.
      const state=control.state(signal.crossing,signal.branch),y=state==='red'?.32:state==='yellow'?-.005:-.335;
      point.set(1,y,.16);if(signal.fixture.pose)point.applyMatrix4(poseMatrix(signal.fixture.pose));else point.add(signal.fixture.position);
      position.setXYZ(i,point.x,point.y,point.z);tint.setHex(state==='red'?0xd10000:state==='yellow'?0xdca80a:0x2dc51d);color.setXYZ(i,tint.r*3,tint.g*3,tint.b*3);
    });
    position.needsUpdate=color.needsUpdate=true;geometry.computeBoundingSphere();
  };
  update();return {root,update,dispose:()=>{root.removeFromParent();geometry.dispose();material.dispose();map?.dispose();}};
}
