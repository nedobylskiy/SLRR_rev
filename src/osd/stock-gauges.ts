import type { Assets } from '../assets';
import { parseScx, type ScxMesh } from '../formats/scx';
import type { OsdLayer } from './osd-layer';

interface Picture { meshes: ScxMesh[]; image: HTMLImageElement | HTMLCanvasElement }

/** The original 2.2.1 HUD has native defaults rather than CFG osd_* directives.
 * Its SCX owns the panel outline and atlas coordinates, including the needle. */
export class StockGauges {
  private readonly canvas = document.createElement('canvas');
  private pictures: Picture[] = [];
  private disposed = false;
  private state = [0, 0, 0, 0, 1];
  private stamp = '';
  private background?: HTMLCanvasElement;
  constructor(osd: OsdLayer, assets: Assets) {
    this.canvas.width = 1600; this.canvas.height = 900;
    this.canvas.style.pointerEvents = 'none';
    this.canvas.setAttribute('aria-label', 'Vehicle instruments');
    osd.createNativeElement(this.canvas, 0, 0, 2, 2, 20);
    void Promise.all([0x55, 0x56, 0x58, 0x57].map(async id => {
      const resource = await assets.modelForResource('cars.rpk', id);
      const model = parseScx(await assets.read(resource.path));
      const image = new Image();
      image.src = await osd.imageUrl(assets.registerTexture(resource.textures[0]));
      await image.decode();
      if (id === 0x58 || id === 0x57) {
        const tinted = document.createElement('canvas'); tinted.width=image.width; tinted.height=image.height;
        const context=tinted.getContext('2d')!; context.drawImage(image,0,0);
        context.globalCompositeOperation='source-in';context.fillStyle='#4fe015';context.fillRect(0,0,tinted.width,tinted.height);
        return {meshes:model.meshes,image:tinted};
      }
      return { meshes: model.meshes, image };
    })).then(pictures => { if (!this.disposed) { this.pictures = pictures; this.draw(); } })
      .catch(error => { this.canvas.dataset.gaugeError = String(error); });
  }
  update(speed: number, rpm: number, gear: number, mileage: number, condition: number) {
    const stamp = `${Math.round(speed)}:${Math.round(rpm/10)}:${gear}:${Math.floor(mileage)}:${Math.round(condition*100)}`;
    this.state = [speed, rpm, gear, mileage, condition];
    if (this.stamp === stamp) return;
    this.stamp = stamp; this.draw();
  }
  private draw() {
    const context = this.canvas.getContext('2d');
    if (!context || !this.pictures.length) return;
    context.clearRect(0, 0, 1600, 900);
    const [speed, rpm, gear, mileage, condition] = this.state;
    const draw = (picture: Picture, mesh: ScxMesh, indices: ArrayLike<number>, x: number, y: number,
      sx: number, sy: number, angle = 0, ox = 0, oy = 0) => {
      const c = Math.cos(angle), s = Math.sin(angle), p = mesh.positions, uv = mesh.uv;
      for (let i = 0; i < indices.length; i += 3) {
        const ids = [indices[i], indices[i + 1], indices[i + 2]];
        const dst = ids.map(v => { const px = p[v * 3] - ox, py = p[v * 3 + 1] - oy;
          return [(1 + x + sx * (c * px - s * py)) * 800, (1 + y + sy * (s * px + c * py)) * 450]; });
        const src = ids.map(v => [uv[v * 2] * picture.image.width, uv[v * 2 + 1] * picture.image.height]);
        const [u, v, w] = src, [a, b, d] = dst;
        const det = (v[0] - u[0]) * (w[1] - u[1]) - (w[0] - u[0]) * (v[1] - u[1]);
        if (Math.abs(det) < 1e-8) continue;
        const xx = ((b[0]-a[0])*(w[1]-u[1])-(d[0]-a[0])*(v[1]-u[1]))/det;
        const xy = ((d[0]-a[0])*(v[0]-u[0])-(b[0]-a[0])*(w[0]-u[0]))/det;
        const yx = ((b[1]-a[1])*(w[1]-u[1])-(d[1]-a[1])*(v[1]-u[1]))/det;
        const yy = ((d[1]-a[1])*(v[0]-u[0])-(b[1]-a[1])*(w[0]-u[0]))/det;
        context.save(); context.beginPath(); context.moveTo(...a as [number,number]);
        context.lineTo(...b as [number,number]); context.lineTo(...d as [number,number]); context.closePath(); context.clip();
        context.setTransform(xx,yx,xy,yy,a[0]-xx*u[0]-xy*u[1],a[1]-yx*u[0]-yy*u[1]);
        context.drawImage(picture.image,0,0); context.restore();
      }
    };
    if (this.background) context.drawImage(this.background,0,0);
    else {
      // Anchor the stock wide strip at the right edge, leaving room for the GPS.
      for (const mesh of this.pictures[0].meshes) draw(this.pictures[0], mesh, mesh.indices, 1, .994, .0031, -.00406);
      this.background=document.createElement('canvas');this.background.width=1600;this.background.height=900;
      this.background.getContext('2d')!.drawImage(this.canvas,0,0);
    }
    for (const mesh of this.pictures[1].meshes) draw(this.pictures[1], mesh, mesh.indices, .326, 1.847,
      .00228375, -.00406, Math.max(-.48, Math.min(.48, .48-rpm*.0001)));
    const glyphs = (picture: Picture, value: string, x: number, y: number, sx: number, sy: number) => {
      const mesh = picture.meshes[0];
      for (const ch of value) {
        const start = ch.charCodeAt(0) * 4, p = mesh.positions;
        if (start * 3 + 11 >= p.length) continue;
        draw(picture,mesh,[start,start+1,start+2,start+1,start+3,start+2],x,y,sx,sy,0,p[start*3],p[start*3+1]);
        x += (p[start*3+3]-p[start*3]+20)*sx;
      }
    };
    glyphs(this.pictures[2],String(Math.max(0,Math.round(speed))).padStart(3,'0'),.298,.865,.0000675,.00012);
    glyphs(this.pictures[2],gear<0?'R':gear===0?'N':String(gear),.548,.865,.0000675,.00012);
    glyphs(this.pictures[2],String(Math.floor(mileage)).padStart(7,'0'),-.50,.755,.0000675,.00012);
    // Condition silhouettes use the font resource's authored glyph A.
    glyphs(this.pictures[3],'A',.914,.735,.00007875,.00014);
    this.canvas.setAttribute('aria-label',`${Math.round(speed)} km/h, ${Math.round(rpm)} rpm, condition ${Math.round(condition*100)}%`);
  }
  dispose() { this.disposed = true; this.canvas.remove(); }
}
