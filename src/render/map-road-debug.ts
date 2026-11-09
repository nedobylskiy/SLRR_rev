import { BufferGeometry, Color, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Points, PointsMaterial, Vector3, type PerspectiveCamera, type Object3D } from 'three';
import { roadWordFloat, sampleRoadSegment, type RoadNetwork, type RoadSegment } from '../formats/trc';
import {trafficConnections} from '../engine/road-traffic';
import type {TrafficControl} from '../engine/traffic-control';

export type RoadDebugLayer = 'graph' | 'crossings' | 'metadata';
interface Label { position: Vector3; text: string; detail: string; crossing: boolean }
const number = (value: number) => Number.isFinite(value) ? value.toFixed(2) : 'unset';

/** Debug-only geometry, outside the streamed scenery and occlusion/shadow passes. */
export class MapRoadDebug {
  readonly root = new Group();
  private graph = new Group();
  private crossings = new Group();
  private labels: Label[] = [];
  private overlay: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private metadata = false;
  private nextLabels = -Infinity;
  private projected = new Vector3();
  private crossingLines:LineSegments;
  private laneRanges:{road?:number;start:number;count:number}[]=[];
  private colorControl?:TrafficControl;
  private colorPhase=-2;
  constructor(parent: Object3D, container: HTMLElement, network: RoadNetwork) {
    this.root.name = 'Road graph debug'; this.root.add(this.graph, this.crossings); parent.add(this.root);
    this.graph.visible = this.crossings.visible = false;
    this.overlay = document.createElement('div'); this.overlay.className = 'road-debug-labels';
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '3' });
    container.append(this.overlay);
    const line = (splines: RoadSegment[][], color: number, target: Group, gradient = false) => {
      const positions: number[] = [], colors: number[] = [];
      const start = new Color(0x36ff65), end = new Color(0xff3838), tint = new Color();
      for (const segments of splines) {
      const weights = segments.map(segment => segment.length || Math.hypot(...segment.end.map((value, i) => value - segment.start[i])) || 1);
      const total = weights.reduce((sum, value) => sum + value, 0); let travelled = 0;
      for (const [index, segment] of segments.entries()) {
        const steps = Math.max(2, Math.min(32, Math.ceil(segment.length / 8)));
        let previous = segment.start;
        for (let i = 1; i <= steps; i++) {
          const current = sampleRoadSegment(segment, i / steps);
          positions.push(previous[0], previous[1] + .25, previous[2], current[0], current[1] + .25, current[2]); previous = current;
          if (gradient) for (const t of [(i - 1) / steps, i / steps]) {
            tint.copy(start).lerp(end, (travelled + weights[index] * t) / total); colors.push(tint.r, tint.g, tint.b);
          }
        }
        travelled += weights[index];
      }
      }
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      if (gradient) geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      const mesh = new LineSegments(geometry, new LineBasicMaterial({ color: gradient ? 0xffffff : color, vertexColors: gradient, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      mesh.renderOrder = 20; target.add(mesh);return mesh;
    };
    line(network.paths.map(record => record.segments), 0x54eaff, this.graph);
    line(network.others.map(record => record.segments), 0x67a0ff, this.graph, true);
    const lanes=network.nodes.flatMap(node=>node.lanes),owners=new Map<RoadSegment,number|undefined>();
    for(const [road,connections] of trafficConnections(network))for(const turn of connections){
      if(!owners.has(turn.segment))owners.set(turn.segment,road);else if(owners.get(turn.segment)!==road)owners.set(turn.segment,undefined);
    }
    let vertex=0;for(const lane of lanes){const count=Math.max(2,Math.min(32,Math.ceil(lane.segment.length/8)))*2;this.laneRanges.push({road:owners.get(lane.segment),start:vertex,count});vertex+=count;}
    this.crossingLines=line(lanes.map(lane=>[lane.segment]),0xffffff,this.graph);
    this.crossingLines.geometry.setAttribute('color',new Float32BufferAttribute(new Float32Array(vertex*3),3));
    (this.crossingLines.material as LineBasicMaterial).vertexColors=true;
    this.updateTraffic();
    for (const group of [0, 1]) {
      const nodes = network.nodes.filter(node => node.group === group);
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(nodes.flatMap(node => [node.position[0], node.position[1] + .6, node.position[2]]), 3));
      const points = new Points(geometry, new PointsMaterial({ color: group ? 0xff94dd : 0xffd15c, size: 9, sizeAttenuation: false, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      points.renderOrder = 21; this.crossings.add(points);
    }
    for (const node of network.nodes) this.labels.push({ position: new Vector3(...node.position), crossing: true,
      text: `Cross #${node.id} · ${node.group ? 'B' : 'A'} · ${node.links.length} links · ${node.lanes.length} lanes`,
      detail: `XYZ ${node.position.map(number).join(', ')} · links ${node.links.map(link => `${link.target}:${link.flag}`).join(', ')} · group A/B is a file group, not a proven signal type` });
    for (const [kind, records] of [['Path', network.paths], ['Road', network.others]] as const) for (const record of records) {
      const segment = record.segments[Math.floor(record.segments.length / 2)], length = record.segments.reduce((sum, s) => sum + s.length, 0);
      const tail = 'tail' in record ? ` · raw tail ${Array.from(record.tail, roadWordFloat).map(number).join('/')}` : '';
      this.labels.push({ position: new Vector3(...sampleRoadSegment(segment, .5)), crossing: false,
        text: `${kind} #${record.id} · ${length.toFixed(1)} m · ${record.segments.length} seg${tail}`,
        detail: `Refs ${record.refs.join('/')} · raw words ${Array.from(record.raw, word => `0x${word.toString(16).padStart(8, '0')}`).join(' ')} · raw fields have unverified units/meaning` });
    }
  }
  show(layer: RoadDebugLayer, visible: boolean) {
    if (layer === 'metadata') this.metadata = visible;
    else this[layer].visible = visible;
    this.nextLabels = -Infinity;
    if (!this.metadata) this.pool.forEach(label => label.hidden = true);
  }
  /** Update only vertex colors when the shared signal phase changes; keep every spline buffer. */
  updateTraffic(control?:TrafficControl){
    const phase=control?.phaseRevision??-1;if(control===this.colorControl&&phase===this.colorPhase)return;
    this.colorControl=control;this.colorPhase=phase;
    const colors=this.crossingLines.geometry.getAttribute('color'),tint=new Color();
    for(const lane of this.laneRanges){
      const rule=lane.road===undefined?undefined:control?.rule(lane.road);
      const known=control&&lane.road!==undefined&&(!rule||rule.kind==='signal');
      tint.setHex(!known?0x9dbeaa:!rule||control!.state(rule.crossing,rule.branch)==='green'?0x36ff65:0xff3838);
      for(let i=lane.start;i<lane.start+lane.count;i++)colors.setXYZ(i,tint.r,tint.g,tint.b);
    }
    colors.needsUpdate=true;
  }
  update(camera: PerspectiveCamera, width: number, height: number, now: number) {
    if (!this.metadata || now < this.nextLabels) return;
    this.nextLabels = now + 120;
    camera.updateMatrixWorld();
    const candidates = this.labels.filter(label => label.crossing ? this.crossings.visible : this.graph.visible)
      .map(label => ({ label, distance: label.position.distanceToSquared(camera.position) }))
      .filter(item => item.distance < 1000 * 1000).sort((a, b) => a.distance - b.distance);
    const occupied: { x: number; y: number; width: number; height: number }[] = []; let used = 0;
    for (const { label } of candidates) {
      this.projected.copy(label.position); this.projected.y += 1; this.projected.project(camera);
      if (this.projected.z < -1 || this.projected.z > 1 || Math.abs(this.projected.x) > .95 || Math.abs(this.projected.y) > .9) continue;
      const x = (this.projected.x + 1) * width / 2, y = (1 - this.projected.y) * height / 2;
      const labelWidth = Math.min(290, width, label.text.length * 6.7 + 10), labelHeight = Math.ceil((label.text.length * 6.7 + 10) / labelWidth) * 14 + 6;
      const rect = { x: Math.max(0, Math.min(width - labelWidth, x + 8)), y: Math.max(0, Math.min(height - labelHeight, y + 5)), width: labelWidth, height: labelHeight };
      if (occupied.some(other => rect.x < other.x + other.width + 8 && rect.x + rect.width + 8 > other.x && rect.y < other.y + other.height + 8 && rect.y + rect.height + 8 > other.y)) continue;
      occupied.push(rect);
      let element = this.pool[used];
      if (!element) {
        element = document.createElement('div'); element.className = 'road-debug-label';
        Object.assign(element.style, { position: 'absolute', padding: '3px 5px', font: '11px monospace', lineHeight: '14px', color: '#d5f7ff', background: '#071820df', borderRadius: '3px', boxSizing: 'border-box', pointerEvents: 'auto' });
        for (const event of ['pointerdown', 'pointerup', 'click', 'wheel']) element.addEventListener(event, event => event.stopPropagation());
        this.overlay.append(element); this.pool.push(element);
      }
      element.hidden = false; element.textContent = label.text; element.title = label.detail;
      element.style.left = `${rect.x}px`; element.style.top = `${rect.y}px`; element.style.width = `${rect.width}px`;
      if (++used >= 28) break;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].hidden = true;
  }
  dispose() {
    this.root.removeFromParent(); this.root.traverse(object => {
      if (object instanceof LineSegments || object instanceof Points) { object.geometry.dispose(); (object.material as LineBasicMaterial | PointsMaterial).dispose(); }
    });
    this.overlay.remove(); this.labels.length = this.pool.length = 0;
  }
}
