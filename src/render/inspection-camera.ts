import {CameraHelper,Group,LineLoop,LineBasicMaterial,BufferGeometry,PerspectiveCamera,Vector3} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

/** An observer only: never supplies residency, culling, shadow or reflection focus. */
export class InspectionCamera {
  readonly camera=new PerspectiveCamera();
  readonly helpers=new Group();
  private helper:CameraHelper;
  private ring:LineLoop;
  private controls:OrbitControls;
  private surface:HTMLDivElement;
  enabled=false;
  replay=false;
  constructor(container:HTMLElement,private primary:PerspectiveCamera) {
    this.surface=document.createElement('div');this.surface.className='graphics-inspection-surface';
    Object.assign(this.surface.style,{position:'absolute',inset:'0',display:'none',zIndex:'2'});
    this.surface.tabIndex=0;this.surface.setAttribute('aria-label','Graphics inspection camera');
    container.append(this.surface);
    this.controls=new OrbitControls(this.camera,this.surface);this.controls.enableDamping=true;
    this.controls.listenToKeyEvents(this.surface);
    // Keep observation input out of Java driving/mechanic/camera handlers.
    for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown','contextmenu'])
      this.surface.addEventListener(type,event=>{event.stopPropagation();if(type==='pointerdown')this.surface.focus();});
    this.helper=new CameraHelper(primary);this.helpers.add(this.helper);
    const points=Array.from({length:128},(_,i)=>new Vector3(Math.cos(i*Math.PI/64),0,Math.sin(i*Math.PI/64)));
    this.ring=new LineLoop(new BufferGeometry().setFromPoints(points),new LineBasicMaterial({color:0x62e6c2}));
    this.helpers.add(this.ring);this.helpers.visible=false;this.helpers.name='Graphics inspection helpers';
  }
  setEnabled(enabled:boolean,target:Vector3) {
    if(enabled&&!this.enabled){this.camera.copy(this.primary);this.controls.target.copy(target);this.controls.update();}
    this.enabled=enabled;this.surface.style.display=enabled?'block':'none';this.helpers.visible=enabled;
  }
  reset(target:Vector3){this.camera.copy(this.primary);this.controls.target.copy(target);this.controls.update();}
  update(width:number,height:number,focus:Vector3,range:number) {
    if(!this.enabled)return;
    this.camera.aspect=width/Math.max(1,height);this.camera.updateProjectionMatrix();if(!this.replay)this.controls.update();
    this.primary.updateMatrixWorld();this.helper.update();this.ring.position.copy(focus);this.ring.scale.set(range,1,range);
  }
}
