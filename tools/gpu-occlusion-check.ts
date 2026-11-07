import {AmbientLight,BoxGeometry,Color,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,RawShaderMaterial,GLSL3,NoBlending,DoubleSide,Scene,Vector3,WebGLRenderer} from 'three';
import {MapGpuOcclusion} from '../src/render/map-gpu-occlusion';

const renderer=new WebGLRenderer({antialias:false});renderer.setSize(900,450);renderer.setClearColor(0x243747);document.body.append(renderer.domElement);
const rows=document.querySelector('#results')!,status=document.querySelector('#status')!;
let failures=0,total=0;
async function check(near:number,offset:Vector3,gap=false,transparent=false){
  const scene=new Scene(),root=new Group();scene.add(root,new AmbientLight(0xffffff,2));
  const camera=new PerspectiveCamera(60,2,near,5000);camera.position.copy(offset);camera.updateMatrixWorld();
  const wall=new InstancedMesh(new PlaneGeometry(gap?48.8:100,100),new MeshStandardMaterial({color:0x9ca1ac}),gap?2:1);wall.setMatrixAt(0,new Matrix4().makeTranslation(offset.x+(gap?-25.6:0),offset.y,offset.z-100));if(gap)wall.setMatrixAt(1,new Matrix4().makeTranslation(offset.x+25.6,offset.y,offset.z-100));wall.instanceMatrix.needsUpdate=true;wall.userData.mapOcclusionRole='structure';root.add(wall);
  const ground=new InstancedMesh(new PlaneGeometry(1000,1000).rotateX(-Math.PI/2),new MeshStandardMaterial({color:0x444444}),1);ground.setMatrixAt(0,new Matrix4().makeTranslation(offset.x,offset.y-2,offset.z-100));ground.instanceMatrix.needsUpdate=true;ground.userData.mapOcclusionRole='terrain';root.add(ground);
  const cases:[string,number,number,number,boolean][]=[['front of wall',0,0,-30,true],['near-ground front object',4,-1.4,-30,true],['behind wall',-12,0,-140,false],['center of wall / opening',0,0,-140,gap],['partially exposed in opening',1.7,0,-140,gap],['outside wall silhouette',100,0,-140,true],['near-plane crossing',0,0,-.01,true]];
  const shared=new MeshStandardMaterial({color:new Color(0x55ee88),transparent,opacity:transparent?.6:1,side:DoubleSide,depthWrite:!transparent});
  const observations=cases.map(()=>new Set<boolean>());
  const targets=cases.map(([name,x,y,z])=>{const mesh=new InstancedMesh(new BoxGeometry(.3,.3,.3),shared,1);mesh.name=name;mesh.setMatrixAt(0,new Matrix4().makeTranslation(offset.x+x,offset.y+y,offset.z+z));mesh.instanceMatrix.needsUpdate=true;mesh.userData.mapOcclusionRole='prop';root.add(mesh);return mesh;});
  const cull=new MapGpuOcclusion(renderer);cull.enabled=true;cull.intervalFrames=12;
  await new Promise<void>(resolve=>{
    let frames=0;const tick=()=>{
      frames++;cull.prepare(camera,root,false,0);
      cull.renderMain(()=>{
        renderer.render(scene,camera);
        if(frames>=24)targets.forEach((target,i)=>observations[i].add(target.visible));
        if(frames===60){for(let i=0;i<targets.length;i++){
          const [name,,,,expected]=cases[i],actual=observations[i].size>1?'varies':observations[i].has(true)?'visible':'hidden',ok=actual===(expected?'visible':'hidden');total++;if(!ok)failures++;
          const row=document.createElement('tr');row.className=ok?'pass':'fail';
          for(const text of [`near ${near}, ${gap?'opening':'solid wall'}, ${transparent?'blend double-side':'opaque'}`,name,expected?'visible':'hidden',actual,ok?'PASS':'FAIL']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}rows.append(row);
        }}
      });
      if(frames<60)requestAnimationFrame(tick);else resolve();
    };requestAnimationFrame(tick);
  });
  const internals=cull as any,probe=new RawShaderMaterial({glslVersion:GLSL3,vertexShader:internals.test.vertexShader,fragmentShader:internals.test.fragmentShader,depthTest:false,depthWrite:false,blending:NoBlending});
  probe.fragmentShader=probe.fragmentShader.replace('out vec4 result;', 'uniform int debugPart; out vec4 result;').replace('result=vec4(nearDepth>farDepth+0.000002?0.:1.);','result=packDepth(debugPart==0?nearDepth:farDepth);');
  probe.uniforms={...internals.test.uniforms,debugPart:{value:0}};internals.quad.material=probe;
  const decode=(v:Uint8Array,i:number)=>new DataView(v.buffer,v.byteOffset+i,4).getFloat32(0,true);
  const caseRows=Array.from(rows.querySelectorAll('tr')).slice(-cases.length);
  for(let mode=0;mode<2;mode++){
    probe.uniforms.debugPart.value=mode;renderer.setRenderTarget(internals.result);renderer.render(internals.quadScene,internals.quadCamera);
    const bytes=new Uint8Array(internals.result.width*internals.result.height*4);renderer.readRenderTargetPixels(internals.result,0,0,internals.result.width,internals.result.height,bytes);
    for(let i=0;i<cases.length;i++){const cell=document.createElement('td');cell.textContent=Number.isFinite(decode(bytes,(i+wall.count+1)*4))?decode(bytes,(i+wall.count+1)*4).toFixed(9):'— (near plane)';caseRows[i].append(cell);}
  }
  renderer.setRenderTarget(null);probe.dispose();
  cull.dispose();for(const mesh of [wall,ground,...targets]){mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();}
}
try{
  for(const transparent of [false,true])for(const gap of [false,true])for(const near of [.01,.1,1])await check(near,new Vector3(-850,15,660),gap,transparent);
  status.textContent=`${total-failures}/${total} passed · ${failures} failed`;status.className=failures?'fail':'pass';
}catch(error){status.textContent=String(error);status.className='fail';}
