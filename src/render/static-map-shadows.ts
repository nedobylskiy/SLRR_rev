import { Color, Group, Matrix4, Material, Mesh, MeshDepthMaterial, MeshStandardMaterial, NearestFilter,
  OrthographicCamera, RGBADepthPacking, Scene, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget } from 'three';

/** Cached static-scene projection for ground without authored lightmap textures. */
export class StaticMapShadows {
  readonly enabled = {value:0};
  readonly hard = {value:0};
  readonly texel = {value:1/2048};
  private nightResolution=false;

  setNightQuality(night:boolean){
    if(night===this.nightResolution)return;
    this.nightResolution=night;this.hard.value=night?1:0;
    const radius=night?80:160;
    Object.assign(this.camera,{left:-radius,right:radius,top:radius,bottom:-radius});
    this.camera.updateProjectionMatrix();
    this.texel.value=1/(night?3072:2048);
    // Keep the previous projection until a new capture succeeds.
    this.revision=-1;
  }
  readonly available = {value:0};
  readonly matrix = {value:new Matrix4()};
  readonly texture = {value:null as WebGLRenderTarget['texture'] | null};
  private target?: WebGLRenderTarget;
  private camera = new OrthographicCamera(-160,160,160,-160,1,701);
  private scene = new Scene();
  private focus?: Vector3;
  private direction = new Vector3();
  private revision = -1;
  private updated = -Infinity;
  private depths = new Map<Material,{material:MeshDepthMaterial;release:()=>void}>();

  configure(material: MeshStandardMaterial) {
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader,renderer) => {
      previous.call(material,shader,renderer);
      shader.uniforms.slrrStaticEnabled = this.enabled;
      shader.uniforms.slrrStaticAvailable = this.available;
      shader.uniforms.slrrStaticHard = this.hard;
      shader.uniforms.slrrStaticTexel = this.texel;
      shader.uniforms.slrrStaticMap = this.texture;
      shader.uniforms.slrrStaticMatrix = this.matrix;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>','#include <common>\nuniform mat4 slrrStaticMatrix;\nvarying vec4 vSlrrStaticCoord;')
        .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
vec4 slrrStaticWorld = vec4(transformed,1.0);
#ifdef USE_INSTANCING
slrrStaticWorld = instanceMatrix * slrrStaticWorld;
#endif
vSlrrStaticCoord = slrrStaticMatrix * modelMatrix * slrrStaticWorld;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',`#include <common>
uniform float slrrStaticEnabled;
uniform float slrrStaticAvailable;
uniform float slrrStaticHard;
uniform float slrrStaticTexel;
uniform sampler2D slrrStaticMap;
varying vec4 vSlrrStaticCoord;`)
        .replace('#include <opaque_fragment>',`
if (slrrStaticEnabled > 0.5 && slrrStaticAvailable > 0.5) {
  vec3 p = vSlrrStaticCoord.xyz / vSlrrStaticCoord.w;
  if (all(greaterThan(p,vec3(0.001))) && all(lessThan(p,vec3(0.999)))) {
    float lit = 0.0;
    if (slrrStaticHard > 0.5) {
      lit = step(p.z-0.0006, unpackRGBAToDepth(texture2D(slrrStaticMap,p.xy)));
    } else {
    for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) {
      float depth = unpackRGBAToDepth(texture2D(slrrStaticMap,p.xy+vec2(float(x),float(y))*slrrStaticTexel));
      lit += step(p.z-0.0006,depth);
    }
    lit /= 9.0;
    }
    outgoingLight = (outgoingLight-totalEmissiveRadiance) * mix(0.55,1.0,lit) + totalEmissiveRadiance;
  }
}
#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => `${key}|slrr-static-shadow-v2`;
  }

  private depth(source: Material) {
    let entry = this.depths.get(source);
    if (!entry) {
      const surface = source as MeshStandardMaterial;
      const material = new MeshDepthMaterial({depthPacking:RGBADepthPacking,side:source.shadowSide??source.side,
        map:surface.map,alphaMap:surface.alphaMap,alphaTest:source.alphaTest});
      const release = () => { material.dispose();source.removeEventListener('dispose',release);this.depths.delete(source); };
      source.addEventListener('dispose',release);
      entry = {material,release};this.depths.set(source,entry);
    }
    return entry.material;
  }

  update(renderer: WebGLRenderer, root: Group | undefined, focus: Vector3, direction: Vector3, revision: number, now: number) {
    if (!this.enabled.value || !root || !root.children.length) return;
    const moved = !this.focus || this.focus.distanceToSquared(focus)>40*40;
    const resized = !!this.target && this.target.width !== (this.nightResolution?3072:2048);
    const turned = this.direction.distanceToSquared(direction)>1e-5;
    if (!moved && !turned && !resized && this.revision===revision) return;
    if (this.available.value && now-this.updated<1000 && !moved && !turned && !resized) return;
    const resolution=this.nightResolution?3072:2048;
    this.target ??= new WebGLRenderTarget(resolution,resolution,{minFilter:NearestFilter,magFilter:NearestFilter});
    if(resized){this.target.setSize(resolution,resolution);this.available.value=0;}
    this.camera.position.copy(focus).addScaledVector(direction,350);
    this.camera.lookAt(focus);this.camera.updateMatrixWorld(true);
    const projection = new Matrix4().set(0.5,0,0,0.5, 0,0.5,0,0.5, 0,0,0.5,0.5, 0,0,0,1)
      .multiply(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    const parent = root.parent, target = renderer.getRenderTarget(), clear = renderer.getClearColor(new Color());
    const alpha = renderer.getClearAlpha(), viewport = renderer.getViewport(new Vector4());
    const autoClear = renderer.autoClear, shadowUpdate = renderer.shadowMap.autoUpdate;
    const originals: {mesh:Mesh;material:Material|Material[];visible:boolean}[] = [];
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      originals.push({mesh:object,material:object.material,visible:object.visible});
      object.visible &&= object.userData.staticMapCaster??object.castShadow;
      object.material = Array.isArray(object.material) ? object.material.map(material=>this.depth(material)) : this.depth(object.material);
    });
    try {
      this.scene.add(root);renderer.shadowMap.autoUpdate=false;renderer.autoClear=true;
      renderer.setClearColor(0xffffff,1);renderer.setRenderTarget(this.target);renderer.clear();
      renderer.render(this.scene,this.camera);
      this.matrix.value.copy(projection);
      this.texture.value=this.target.texture;this.available.value=1;
      this.focus=focus.clone();this.direction.copy(direction);this.revision=revision;this.updated=now;
    } finally {
      root.removeFromParent();parent?.add(root);
      for (const original of originals) {original.mesh.material=original.material;original.mesh.visible=original.visible;}
      renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=shadowUpdate;
      renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setClearColor(clear,alpha);
    }
  }

  reset() {
    this.available.value=0;this.texture.value=null;this.focus=undefined;this.revision=-1;this.updated=-Infinity;
    this.target?.dispose();this.target=undefined;
    for (const entry of [...this.depths.values()]) entry.release();
  }
}
