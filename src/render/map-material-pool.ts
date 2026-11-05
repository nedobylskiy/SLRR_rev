import { Material, Mesh, MeshStandardMaterial, Texture } from 'three';

function textures(material: Material): Set<Texture> {
  return new Set([...Object.values(material), ...Object.values(material.userData)].filter((v): v is Texture => v instanceof Texture));
}

function textureKey(texture: Texture) {
  return [texture.source.uuid,texture.mapping,texture.channel,texture.wrapS,texture.wrapT,
    texture.minFilter,texture.magFilter,texture.anisotropy,texture.colorSpace,texture.flipY,
    texture.premultiplyAlpha,texture.unpackAlignment,texture.generateMipmaps,texture.format,texture.type,texture.internalFormat,
    texture.offset.toArray(),texture.repeat.toArray(),texture.center.toArray(),texture.rotation,
    texture.matrixAutoUpdate,texture.matrix.toArray()];
}

/** Only used for immutable map surfaces configured by Viewer.append. */
function key(material: Material): string | undefined {
  if (!(material instanceof MeshStandardMaterial) || material.transparent || material.userData.slrrPaintMask || material.clippingPlanes?.length
    || Object.values(material.userData).some(value=>value instanceof Texture)) return;
  const values: Record<string,unknown> = {shader:material.customProgramCacheKey()};
  for (const [name,value] of Object.entries(material)) {
    if (['id','uuid','name','version','userData'].includes(name)) continue;
    if (value instanceof Texture) values[name]=textureKey(value);
    else if (['number','boolean','string'].includes(typeof value) || value===null) values[name]=value;
    else if (value && typeof value==='object' && ('isColor' in value || 'isVector2' in value)) values[name]=value.toArray();
  }
  values.userData=Object.fromEntries(Object.entries(material.userData).map(([name,value])=>
    [name,value instanceof Texture ? textureKey(value) : value]));
  return JSON.stringify(values);
}

/** Share equal material state so Three can sort draws and reuse uploaded uniforms. */
export class MapMaterialPool {
  private entries = new Map<string,{material:Material;users:number}>();
  private owners = new Map<Material,{key:string;users:number}>();

  acquire(parts: Mesh[]): void {
    const used=new Set<Material>(),discard=new Set<Material>();
    for (const part of parts) {
      const share=(material:Material)=>{
        const signature=key(material);if(!signature)return material;
        let entry=this.entries.get(signature);
        if(!entry){entry={material,users:0};this.entries.set(signature,entry);this.owners.set(material,{key:signature,users:0});}
        if(!used.has(entry.material)) {
          used.add(entry.material);entry.users++;this.owners.get(entry.material)!.users++;
        }
        if(entry.material!==material)discard.add(material);
        return entry.material;
      };
      part.material=Array.isArray(part.material)?part.material.map(share):share(part.material);
    }
    const retained=new Set<Texture>();
    for(const entry of this.entries.values())for(const texture of textures(entry.material))retained.add(texture);
    const orphaned=new Set<Texture>();
    for(const material of discard){for(const texture of textures(material))if(!retained.has(texture))orphaned.add(texture);material.dispose();}
    for(const texture of orphaned)texture.dispose();
  }

  /** One release per distinct material in an evicted model, not per instance. */
  release(material: Material): boolean {
    const owner=this.owners.get(material);if(!owner)return false;
    const entry=this.entries.get(owner.key)!;entry.users--;owner.users--;
    if(!owner.users){
      this.owners.delete(material);this.entries.delete(owner.key);
      for(const texture of textures(material))texture.dispose();material.dispose();
    }
    return true;
  }
}
