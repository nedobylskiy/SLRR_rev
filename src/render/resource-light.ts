import { AmbientLight, Color, DirectionalLight, Group, Vector3 } from 'three';
import { entryProperties, type RpkEntry } from '../formats/rpk';

export interface ResourceLight {
  type: 'directional'; position: number[]; direction: number[];
  diffuse: number[]; ambient: number[]; specular: number[];
}

/** RPK light colors are A,R,G,B; alpha is not a brightness multiplier. */
export function parseResourceLight(entry: RpkEntry): ResourceLight | null {
  if (entry.type !== 13) return null;
  const properties = entryProperties(entry);
  const type = properties.find(property => property.key === 'type')?.value.toLowerCase();
  if (type !== 'directional') throw new Error(`Unsupported RPK light type: ${type ?? 'missing'}`);
  const values = (key: string, fallback: number[]) => {
    const raw = properties.find(property => property.key === key)?.value;
    if (raw === undefined) return fallback;
    const parsed = raw.split(/\s+/).map(Number);
    if (parsed.length !== fallback.length || !parsed.every(Number.isFinite)) throw new Error(`Invalid RPK light ${key}`);
    return parsed;
  };
  const direction = values('direction', [0, -1, 0]);
  if (new Vector3(...direction).lengthSq() < 1e-12) throw new Error('RPK light direction is zero');
  return { type, position: values('position', [0, 0, 0]), direction,
    diffuse: values('diffuse', [1, 1, 1, 1]), ambient: values('ambient', [0, 0, 0, 0]),
    specular: values('specular', [0, 0, 0, 0]) };
}

/** No centimetre scaling: light poses are already in engine metres. */
export function createResourceLight(definition: ResourceLight): Group {
  const group = new Group(); group.name = 'RPK directional light';
  const rgb = (color: number[]) => new Color().setRGB(color[1], color[2], color[3]);
  const light = new DirectionalLight(rgb(definition.diffuse), 1);
  light.position.fromArray(definition.position);
  light.target.position.copy(light.position).add(new Vector3(...definition.direction).normalize());
  // Standard materials cannot reproduce an independent D3D per-light specular color.
  light.userData.specularColor = [...definition.specular];
  const ambient = new AmbientLight(rgb(definition.ambient), 1);
  group.add(light, light.target, ambient);
  return group;
}
