import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { PanelActivity } from '../src/engine/panel-activity';

test('isolated small vibration spikes do not keep an otherwise quiet installed panel awake forever',()=>{
  const panel=new DeformablePanel([-1,1,-1,1,1,-1,-1,1,1,1,1,1],{mass:10,mount:[0,1,0]});
  const activity=new PanelActivity(panel),frame=new Matrix4();activity.reset(frame);activity.wake();
  const velocities=(amplitude:number)=>{panel.velocities.fill(0);for(let i=0;i<panel.velocities.length;i+=3)panel.velocities[i]=(i/3%2?1:-1)*amplitude;};
  for(let i=0;i<60;i++){velocities(.01);activity.settle(1/120,frame,true);}
  for(let i=0;i<60&&activity.deforming;i++){velocities(i%10===9?.1:.01);activity.settle(1/120,frame,true);}
  assert.equal(activity.deforming,false,'quiet time survives brief small vibrations');
  activity.wake();
  for(let i=0;i<120;i++){velocities(.1);activity.settle(1/120,frame,true);}
  assert.equal(activity.deforming,true,'continuous internal motion still requires solving');
  velocities(.01);for(let i=0;i<12;i++)activity.settle(1/120,frame,true);
  velocities(1);activity.settle(1/120,frame,true);
  velocities(.01);for(let i=0;i<12;i++)activity.settle(1/120,frame,true);
  assert.equal(activity.deforming,true,'large motion clears the accumulated quiet credit');
});

test('sleeping panel broad phase skips clear ground without hiding obstacles or terrain contacts', () => {
  const panel = new DeformablePanel([-1, 1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1], { mass: 10, mount: [0, 1, 0] });
  const activity = new PanelActivity(panel), frame = new Matrix4(); activity.reset(frame);
  const distant = new Box3(new Vector3(100, 100, 100), new Vector3(101, 101, 101));
  let queries = 0;
  panel.groundHeight = () => { queries++; return 1; };
  assert.equal(activity.threatened(frame, distant, () => false), false);
  assert.equal(queries, 0);
  assert.equal(activity.threatened(frame, distant, () => true), true);
  assert.ok(queries > 0);
  queries = 0;
  const obstacle = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 2, 2));
  assert.equal(activity.threatened(frame, obstacle, () => false), true);
  assert.equal(queries, 0);
  let swept: Box3 | undefined;
  activity.threatened(new Matrix4().makeTranslation(10, -2, 0), distant, bounds => { swept = bounds.clone(); return false; });
  assert.ok(swept!.containsPoint(new Vector3(-1, 1, -1)));
  assert.ok(swept!.containsPoint(new Vector3(11, -1, 1)), 'both ends of the sweep enter the broad phase');
});


test('settled ground-contact clearance does not wake XPBD again, but penetration and rising terrain do',()=>{
  // A settled bottom layer is exactly 15 mm above ground, as in the solver.
  const panel=new DeformablePanel([-1,.055,-1,1,.055,-1,-1,.055,1,1,.055,1],{mass:10,mount:[0,.055,0]});
  const activity=new PanelActivity(panel),frame=new Matrix4(),far=new Box3(new Vector3(100,100,100),new Vector3(101,101,101));activity.reset(frame);
  assert.equal(activity.threatened(frame,far),false,'persistent resting contact must not wake a quiet panel');
  assert.equal(activity.threatened(new Matrix4().makeTranslation(0,-.0005,0),far),false,'submillimetre support jitter stays rigid');
  assert.equal(activity.threatened(new Matrix4().makeTranslation(0,-.003,0),far),true,'new penetration wakes exact contacts');
  panel.groundHeight=x=>x>2?.2:0;
  assert.equal(activity.threatened(new Matrix4().makeTranslation(5,0,0),far),true,'moving onto higher ground still wakes XPBD');
  const wall=new Box3(new Vector3(-2,0,-2),new Vector3(2,.2,2));
  assert.equal(activity.threatened(frame,wall),true,'obstacles remain independent of ground hysteresis');
});
