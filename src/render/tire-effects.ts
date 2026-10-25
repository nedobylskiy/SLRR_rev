import * as THREE from 'three';
import type { TireContactState } from '../engine/suspension-3d';
import type { TireSurface } from '../engine/map-terrain';

const MAX_MARKS = 1400;
const MAX_SMOKE = 160;
const surfaces: TireSurface[] = ['road', 'grass', 'dirt'];

/** Visual threshold in metres per second of longitudinal or sideways scrub. */
export function tireScrub(contact: TireContactState): number {
  if (!contact.contact || contact.force < 120) return 0;
  return Math.max(0, Math.min(1, (Math.hypot(contact.slipSpeed, contact.lateralSpeed) - 1.15) / 4));
}

class MarkBuffer {
  readonly geometry = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  private positions = new Float32Array(MAX_MARKS * 12);
  private uvs = new Float32Array(MAX_MARKS * 8);
  private cursor = 0;
  private count = 0;
  constructor(color: number, opacity: number) {
    const indices = new Uint16Array(MAX_MARKS * 6);
    for (let i = 0; i < MAX_MARKS; i++) { const v = i * 4, j = i * 6; indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], j); }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  setTexture(texture: THREE.Texture) { const material = this.mesh.material as THREE.MeshBasicMaterial; material.map = texture; material.color.set(0xffffff); material.needsUpdate = true; }
  add(a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3, forward: THREE.Vector3, width: number, u0: number, u1: number) {
    const direction = b.clone().sub(a).addScaledVector(normal, -b.clone().sub(a).dot(normal));
    if (direction.lengthSq() < 1e-5) direction.copy(forward);
    direction.normalize();
    const across = new THREE.Vector3().crossVectors(direction, normal).normalize().multiplyScalar(width * 0.5);
    if (across.lengthSq() < 1e-8) return;
    const lift = normal.clone().multiplyScalar(0.008), vertices = [a.clone().sub(across).add(lift), a.clone().add(across).add(lift), b.clone().sub(across).add(lift), b.clone().add(across).add(lift)];
    for (let i = 0; i < 4; i++) vertices[i].toArray(this.positions, this.cursor * 12 + i * 3);
    this.uvs.set([u0, 0, u0, 1, u1, 0, u1, 1], this.cursor * 8);
    this.cursor = (this.cursor + 1) % MAX_MARKS;
    this.count = Math.min(MAX_MARKS, this.count + 1);
    this.geometry.setDrawRange(0, this.count * 6);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
  }
  clear() { this.cursor = this.count = 0; this.geometry.setDrawRange(0, 0); }
  dispose() { this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

interface SmokeParticle { position: THREE.Vector3; velocity: THREE.Vector3; age: number; life: number; size: number }

/** Bounded GPU marks and point smoke; neither changes tyre forces or collision surfaces. */
export class TireEffects {
  readonly group = new THREE.Group();
  private marks = new Map<TireSurface, MarkBuffer>();
  private previous: (THREE.Vector3 | undefined)[] = [undefined, undefined, undefined, undefined];
  private markU = [0, 0, 0, 0];
  private ownedTextures = new Set<THREE.Texture>();
  private smokeTimer = [0, 0, 0, 0];
  private smoke: SmokeParticle[] = [];
  private positions = new Float32Array(MAX_SMOKE * 3);
  private alphas = new Float32Array(MAX_SMOKE);
  private sizes = new Float32Array(MAX_SMOKE);
  private smokeGeometry = new THREE.BufferGeometry();
  private smokePoints: THREE.Points;
  constructor() {
    for (const [surface, color, opacity] of [['road', 0x17191a, 0.62], ['grass', 0x171915, 0.7], ['dirt', 0x312b25, 0.53]] as const) {
      const buffer = new MarkBuffer(color, opacity); this.marks.set(surface, buffer); this.group.add(buffer.mesh);
    }
    this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: 'attribute float aAlpha; attribute float aSize; varying float vAlpha; void main() { vAlpha = aAlpha; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_PointSize = clamp(aSize * 155.0 / max(1.0, -p.z), 1.0, 64.0); }',
      fragmentShader: 'varying float vAlpha; void main() { float r = length(gl_PointCoord - vec2(0.5)); float edge = 1.0 - smoothstep(0.12, 0.5, r); gl_FragColor = vec4(vec3(0.48), vAlpha * edge); }',
    });
    this.smokePoints = new THREE.Points(this.smokeGeometry, material);
    this.smokePoints.frustumCulled = false;
    this.smokePoints.renderOrder = 3;
    this.group.add(this.smokePoints);
  }
  /** The game's grass skid image is reserved for identifiable loose ground; mixed grass atlases retain black marks. */
  setTextures(asphalt: THREE.Texture, looseGround: THREE.Texture) {
    this.ownedTextures.forEach(texture => texture.dispose()); this.ownedTextures = new Set([asphalt, looseGround]);
    for (const texture of this.ownedTextures) { texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping; }
    this.marks.get('road')!.setTexture(asphalt); this.marks.get('grass')!.setTexture(asphalt); this.marks.get('dirt')!.setTexture(looseGround);
  }
  update(dt: number, wheels: readonly TireContactState[]) {
    if (dt <= 0) return;
    for (const particle of this.smoke) {
      particle.age += dt;
      particle.position.addScaledVector(particle.velocity, dt);
      particle.velocity.multiplyScalar(Math.exp(-1.3 * dt));
      particle.velocity.y += 0.42 * dt;
    }
    this.smoke = this.smoke.filter(particle => particle.age < particle.life);
    for (let i = 0; i < wheels.length; i++) {
      const wheel = wheels[i], strength = tireScrub(wheel);
      if (!strength) { this.previous[i] = undefined; this.smokeTimer[i] = this.markU[i] = 0; continue; }
      const point = wheel.contactPoint, prior = this.previous[i];
      if (prior && prior.distanceTo(point) < 2.5) {
        const distance = prior.distanceTo(point), steps = Math.max(1, Math.ceil(distance / 0.28));
        if (distance > 0.075) for (let j = 1; j <= steps; j++) {
          const a = prior.clone().lerp(point, (j - 1) / steps), b = prior.clone().lerp(point, j / steps);
          const u0 = this.markU[i], u1 = u0 + a.distanceTo(b) / 0.8;
          this.marks.get(wheel.surface)!.add(a, b, wheel.contactNormal, wheel.forward, 0.15 + strength * 0.055, u0, u1);
          this.markU[i] = u1;
        }
      } else if (prior && prior.distanceTo(point) < 0.075 && this.smokeTimer[i] <= 0) {
        const half = wheel.forward.clone().multiplyScalar(0.07);
        this.marks.get(wheel.surface)!.add(point.clone().sub(half), point.clone().add(half), wheel.contactNormal, wheel.forward, 0.15, this.markU[i], this.markU[i] + 0.175);
      }
      this.previous[i] = point.clone();
      this.smokeTimer[i] -= dt;
      if (this.smokeTimer[i] <= 0) {
        this.smokeTimer[i] = 0.09 - strength * 0.055;
        if (this.smoke.length < MAX_SMOKE) {
          const drift = wheel.forward.clone().multiplyScalar(-Math.sign(wheel.slipSpeed || 1) * (0.3 + strength * 0.7));
          this.smoke.push({ position: point.clone().addScaledVector(wheel.contactNormal, 0.08), velocity: drift.add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.55 + Math.random() * 0.35, (Math.random() - 0.5) * 0.7)), age: 0, life: 0.75 + Math.random() * 0.65, size: 0.27 + strength * 0.5 });
        }
      }
    }
    for (let i = 0; i < this.smoke.length; i++) {
      const p = this.smoke[i]; p.position.toArray(this.positions, i * 3);
      this.alphas[i] = Math.min(1, p.age * 8) * (1 - p.age / p.life) * 0.28;
      this.sizes[i] = p.size * (1 + p.age * 1.7);
    }
    this.smokeGeometry.setDrawRange(0, this.smoke.length);
    for (const name of ['position', 'aAlpha', 'aSize']) this.smokeGeometry.attributes[name].needsUpdate = true;
  }
  reset() { this.previous.fill(undefined); this.smokeTimer.fill(0); this.markU.fill(0); this.smoke = []; this.marks.forEach(mark => mark.clear()); this.smokeGeometry.setDrawRange(0, 0); }
  dispose() { this.group.removeFromParent(); this.marks.forEach(mark => mark.dispose()); this.ownedTextures.forEach(texture => texture.dispose()); this.smokeGeometry.dispose(); (this.smokePoints.material as THREE.Material).dispose(); }
}
