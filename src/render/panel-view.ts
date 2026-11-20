import {fullGeometry} from './lod-library';
import {deformationNormals} from './deformation-normals';
import * as THREE from 'three';
import type { DeformablePanel, PanelBinding } from '../engine/deformable-panel';
import { PanelPaintSkin } from './panel-paint-skin';

/** World-space skin owns the hood draw transform while physics is active. */
export class PanelView {
  private skins: { geometry: THREE.BufferGeometry; original: Float32Array; normals: Float32Array; bindings: PanelBinding[] }[] = [];
  private cage: THREE.LineSegments;
  private skinFrame?: THREE.Matrix4;
  private rigidLast = false;
  private lastReset = -1;
  private lastTick = -1;
  private lastShape = -1;
  private readonly previousOwner:unknown;
  private readonly previousMatrixAutoUpdate:boolean;
  private readonly originalDrawFrame:THREE.Matrix4;
  private attachmentFrame?:THREE.Matrix4;
  private paintSkin: PanelPaintSkin;
  private attachments:{group:THREE.Group;matrix:THREE.Matrix4;matrixAutoUpdate:boolean}[]=[];
  constructor(private group: THREE.Group, readonly panel: DeformablePanel, localPositions: number[][],
    drawFrame: THREE.Matrix4 = group.matrix, partFrame?: THREE.Matrix4) {
    this.previousOwner=group.userData.panelViewOwnsTransform;
    this.previousMatrixAutoUpdate=group.matrixAutoUpdate;
    // Placement/settling can move the physical part after the garage proxy was
    // built. The caller supplies its current draw frame, not the stale proxy.
    this.originalDrawFrame=drawFrame.clone();
    if(partFrame)this.attachmentFrame=partFrame.clone().invert().multiply(this.originalDrawFrame);
    this.attachments=group.children.filter((child):child is THREE.Group=>child instanceof THREE.Group)
      .map(group=>{
        const matrixAutoUpdate=group.matrixAutoUpdate;
        if(matrixAutoUpdate)group.updateMatrix();
        // Physics writes the attachment matrix explicitly. Three's automatic
        // position/rotation update otherwise resets paint overlays to identity.
        group.matrixAutoUpdate=false;
        return {group,matrix:group.matrix.clone(),matrixAutoUpdate};
      });
    group.matrixAutoUpdate=false;
    group.userData.panelViewOwnsTransform=true;
    const meshes = group.children.filter((o): o is THREE.Mesh<THREE.BufferGeometry> => o instanceof THREE.Mesh);
    this.paintSkin=new PanelPaintSkin(group,meshes);
    meshes.forEach((mesh, index) => {
      const full = fullGeometry(mesh), position = full.getAttribute('position'), normals = full.getAttribute('normal');
      const samples = localPositions[index];
      deformationNormals(full);
      this.skins.push({ geometry: full, original: new Float32Array(position.array), normals: new Float32Array(normals.array), bindings: Array.from({ length: position.count }, (_, i) => panel.bind(samples.slice(i * 3, i * 3 + 3))) });
      mesh.frustumCulled = false;
    });
    this.group.matrix.identity(); this.group.matrixWorldNeedsUpdate = true;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(panel.beams.length * 6), 3));
    this.cage = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x5eeacb, transparent: true, opacity: 0.3, depthTest: false }));
    this.cage.frustumCulled = false; this.cage.visible = false; group.add(this.cage); this.update();
  }
  wireframe(value: boolean) { this.cage.visible = value; if (value) this.update(); }
  private updateAttachments(frame?:THREE.Matrix4){
    if(!this.attachments.length)return;
    // The skin vertices become world-space, but lamps/extra renders are still
    // authored in the original centimetre draw frame. Keep them on the part.
    if(frame&&!this.attachmentFrame)this.attachmentFrame=frame.clone().invert().multiply(this.originalDrawFrame);
    const desired=frame&&this.attachmentFrame?frame.clone().multiply(this.attachmentFrame):this.originalDrawFrame;
    const local=this.group.matrix.clone().invert().multiply(desired);
    for(const attachment of this.attachments){attachment.group.matrix.copy(local).multiply(attachment.matrix);attachment.group.matrixWorldNeedsUpdate=true;}
  }
  private paintDrawFrame(frame?:THREE.Matrix4){
    return frame&&this.attachmentFrame?frame.clone().multiply(this.attachmentFrame):this.originalDrawFrame.clone();
  }
  update(frame?: THREE.Matrix4, rigid = false) {
    if (rigid && this.rigidLast && frame && this.skinFrame && this.lastReset === this.panel.resetVersion && this.lastShape === this.panel.shapeVersion) {
      // Keep the dented skin on the GPU; carrying it only changes one draw transform.
      this.group.matrix.copy(frame).multiply(this.skinFrame.clone().invert()); this.group.matrixWorldNeedsUpdate = true; this.updateAttachments(frame); return;
    }
    if (frame && this.skinFrame && !rigid && this.lastTick === this.panel.clock.tick && this.lastReset === this.panel.resetVersion && this.lastShape === this.panel.shapeVersion) {
      // No new physical shape: keep the last complete skin and carry it with
      // the part. Never leave a stale world-space skin behind its draw frame.
      if(this.skinFrame)this.group.matrix.copy(frame).multiply(this.skinFrame.clone().invert());
      else this.group.matrix.identity();
      this.group.matrixWorldNeedsUpdate=true;this.updateAttachments(frame);return;
    }
    this.group.matrix.identity(); this.group.matrixWorldNeedsUpdate = true;
    for (const { geometry, bindings } of this.skins) {
      const position = geometry.getAttribute('position'); bindings.forEach((b, i) => this.panel.skin(b, position.array, i * 3));
      position.needsUpdate = true; deformationNormals(geometry).update();
    }
    if (this.cage.visible) {
      const attribute = this.cage.geometry.getAttribute('position'), p = this.panel.positions;
      this.panel.beams.forEach((b, i) => { for (let axis = 0; axis < 3; axis++) { attribute.array[i * 6 + axis] = p[b.a * 3 + axis]; attribute.array[i * 6 + axis + 3] = p[b.b * 3 + axis]; } }); attribute.needsUpdate = true;
    }
    this.skinFrame = frame?.clone(); this.rigidLast = rigid; this.lastReset = this.panel.resetVersion; this.lastTick = this.panel.clock.tick;this.lastShape=this.panel.shapeVersion;
    this.updateAttachments(frame);
    if(this.paintSkin.active)this.paintSkin.update(this.paintDrawFrame(frame).invert());
  }
  dispose() {
    this.paintSkin.dispose();
    this.group.matrixAutoUpdate=this.previousMatrixAutoUpdate;
    if(this.previousOwner===undefined)delete this.group.userData.panelViewOwnsTransform;else this.group.userData.panelViewOwnsTransform=this.previousOwner;
    this.cage.removeFromParent(); this.cage.geometry.dispose(); (this.cage.material as THREE.Material).dispose();
    for(const attachment of this.attachments){attachment.group.matrix.copy(attachment.matrix);attachment.group.matrixAutoUpdate=attachment.matrixAutoUpdate;attachment.group.matrixWorldNeedsUpdate=true;}
    for (const { geometry, original, normals } of this.skins) { geometry.getAttribute('position').array.set(original); geometry.getAttribute('position').needsUpdate = true; geometry.getAttribute('normal').array.set(normals); geometry.getAttribute('normal').needsUpdate = true; geometry.computeBoundingSphere(); geometry.computeBoundingBox(); }
  }
}
