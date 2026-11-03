import * as THREE from 'three';
import { PartFactory, type EngineWorld } from '../engine/world';
import type { Assets } from '../assets';
import type { BootResult } from '../runtime/game-boot';
import { javaPartPreviewCameras, javaPartPreviewSelection } from '../runtime/java-part-preview';
import { osdDepth } from '../runtime/osd-depth';
import type { RenderObject } from '../runtime/render-object';
import type { Viewer } from './viewer';

interface Preview { signature: string; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  world?: EngineWorld; mesh?: THREE.Group; failed?: boolean }
const PREVIEW_ZOOM = 2.25;

/** One transparent, unlit WebGL surface, scissored into the viewports created by Java. */
export class JavaPartPreviews {
  private renderer?: THREE.WebGLRenderer;
  private readonly views = new Map<RenderObject, Preview>();
  private readonly factory: PartFactory;
  private frame = 0;
  private disposed = false;
  private stamp = '';
  private revision = 0;
  constructor(private readonly stage: HTMLElement, private readonly result: BootResult,
    private readonly assets: Assets, private readonly viewer: Pick<Viewer, 'createPreviewWorld' | 'disposePreviewWorld'>,
    private readonly report: (message: string) => void) {
    this.factory = new PartFactory(assets);
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    if (this.disposed) return;
    try { this.render(); } catch (error) { this.report(`Java part previews: ${String(error)}`); this.dispose(); return; }
    this.frame = requestAnimationFrame(this.tick);
  };

  private render() {
    const cameras = javaPartPreviewCameras(this.result), wanted = new Set(cameras.map(view => view.render));
    for (const [node, preview] of this.views) if (!wanted.has(node)) {
      this.release(preview); this.views.delete(node); this.revision++;
    }
    if (!cameras.length) { if (this.renderer) this.renderer.domElement.hidden = true; this.stamp = ''; return; }
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.setClearColor(0, 0); this.renderer.autoClear = false;
      this.renderer.domElement.className = 'java-part-previews';
      this.stage.append(this.renderer.domElement);
    }
    const renderer = this.renderer, width = this.stage.clientWidth, height = this.stage.clientHeight;
    renderer.domElement.hidden = false;
    renderer.domElement.style.zIndex = String(osdDepth(Math.max(...cameras.map(view => view.viewport.priority)), -1000) + 10);
    const stamps = [`${width}:${height}:${this.revision}`];
    for (const view of cameras) {
      const ref = this.result.gameTypes.reference(view.part);
      const tree = (nodes: ReturnType<BootResult['parts']['installedTree']>): string => nodes.map(part =>
        `${part.node.resourceId}:${part.parentSlot}:${part.ownSlot}:${part.renderType}[${tree(part.children)}]`).join(',');
      const signature = `${view.part.resourceId}:${this.result.parts.renderTypeFor(ref)}[${tree(this.result.parts.installedTree(ref))}]`;
      let preview = this.views.get(view.render);
      if (preview?.signature !== signature) {
        if (preview) this.release(preview);
        preview = { signature, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
        this.views.set(view.render, preview);
        this.revision++; // Clear the old thumbnail immediately, including while its replacement loads.
        void this.load(view.render, preview, ref);
      }
      const { position: p, orientation: o } = view.render, vp = view.viewport;
      preview.camera.position.set(p.x, p.y, p.z);
      preview.camera.rotation.set(o.p, o.y, o.r, 'YXZ');
      preview.camera.aspect = vp.width * width / Math.max(1, vp.height * height);
      preview.camera.fov = view.camera.halfAov * 2;
      preview.camera.zoom = PREVIEW_ZOOM;
      preview.camera.near = Math.max(0.0001, view.camera.near); preview.camera.far = view.camera.far;
      preview.camera.updateProjectionMatrix();
      stamps.push(`${view.render.id}:${p.x}:${p.y}:${p.z}:${o.y}:${o.p}:${o.r}:${vp.left}:${vp.top}:${vp.width}:${vp.height}:${view.camera.halfAov}`);
    }
    const stamp = `${this.revision}|${stamps.join('|')}`;
    if (this.stamp === stamp || width <= 0 || height <= 0) return;
    this.stamp = stamp;
    renderer.setSize(width, height, false);
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    for (const view of cameras) {
      const preview = this.views.get(view.render);
      if (!preview?.mesh) continue;
      const vp = view.viewport, x = vp.left * width, y = (1 - vp.top - vp.height) * height;
      renderer.setViewport(x, y, vp.width * width, vp.height * height);
      renderer.setScissor(x, y, vp.width * width, vp.height * height);
      renderer.clear(true, true, true); renderer.render(preview.scene, preview.camera);
    }
    renderer.setScissorTest(false);
  }

  private async load(node: RenderObject, preview: Preview, ref: import('slrr-jvm').JavaValue) {
    try {
      const { key, selection } = await javaPartPreviewSelection(this.result, this.assets, ref);
      const built = await this.factory.stock(key, { javaSelection: selection });
      preview.world = built.world;
      if (this.disposed || this.views.get(node) !== preview) { built.world.dispose(); return; }
      const mesh = await this.viewer.createPreviewWorld(built.world, this.assets);
      if (this.disposed || this.views.get(node) !== preview) { this.viewer.disposePreviewWorld(mesh); built.world.dispose(); return; }
      preview.mesh = mesh; preview.scene.add(mesh); this.revision++;
    } catch (error) {
      this.release(preview); preview.failed = true;
      if (!this.disposed && this.views.get(node) === preview) this.report(`Java preview part: ${String(error)}`);
    }
  }

  private release(preview: Preview) {
    if (preview.mesh) { preview.scene.remove(preview.mesh); this.viewer.disposePreviewWorld(preview.mesh); preview.mesh = undefined; }
    preview.world?.dispose();
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame);
    for (const preview of this.views.values()) this.release(preview);
    this.views.clear(); this.renderer?.dispose(); this.renderer?.domElement.remove();
  }
}
