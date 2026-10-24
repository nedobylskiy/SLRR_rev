import { Matrix3, Matrix4, Vector3 } from 'three';
import { DeformablePanel, type PanelBinding } from './deformable-panel';

/** Four material probes carry a CFG frame with a dented cage, including points outside its bounds. */
export class DeformedFrame {
  private probes: { binding: PanelBinding; correction: Vector3 }[];
  constructor(readonly panel: DeformablePanel, parent: Matrix4, readonly original: Matrix4) {
    const inverse = parent.clone().invert(), out = [0, 0, 0];
    this.probes = [new Vector3(), new Vector3(0.1, 0, 0), new Vector3(0, 0.1, 0), new Vector3(0, 0, 0.1)].map(point => {
      point.applyMatrix4(original); const binding = panel.bind(point.toArray()); panel.skin(binding, out);
      return { binding, correction: point.sub(new Vector3(...out).applyMatrix4(inverse)) };
    });
  }
  world(parent: Matrix4) {
    const out = [0, 0, 0], rotation = new Matrix3().setFromMatrix4(parent), points = this.probes.map(p => {
      this.panel.skin(p.binding, out);
      return new Vector3(...out).add(p.correction.clone().applyMatrix3(rotation));
    });
    return this.frame(points, parent);
  }
  private frame(points: Vector3[], parent: Matrix4) {
    const x = points[1].clone().sub(points[0]), y = points[2].clone().sub(points[0]), z = points[3].clone().sub(points[0]);
    if (x.lengthSq() < 1e-10 || y.lengthSq() < 1e-10 || z.lengthSq() < 1e-10) return parent.clone().multiply(this.original);
    x.normalize(); y.addScaledVector(x, -y.dot(x)).normalize();
    if (y.lengthSq() < 0.5) return parent.clone().multiply(this.original);
    z.crossVectors(x, y).normalize();
    return new Matrix4().makeBasis(x, y, z).setPosition(points[0]);
  }
  local(parent: Matrix4) { return parent.clone().invert().multiply(this.world(parent)); }
}
