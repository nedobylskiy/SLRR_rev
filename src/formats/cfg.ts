export type Triple = [number, number, number];
export interface CfgPose { position: Triple; rotation: Triple }
export interface SlotReference { resource: number; slot: number }
export interface CfgSlot extends CfgPose { id: number; attach: SlotReference[]; compatible: SlotReference[]; type?: number; bonePosition?: Triple }
export interface CfgWheel extends CfgPose { radius?: number; parameters: number[]; spring?: Triple }
export interface PartConfig {
  slots: CfgSlot[]; stock: number[]; render?: number; mesh?: number; texture?: number;
  bodies: (CfgPose & { mass: number; shape: string[]; collision?: boolean })[];
  wheels: CfgWheel[]; steering?: CfgPose; renderPose?: CfgPose; renders: { resource: number; pose?: CfgPose }[]; maxSteer?: number; ackermann?: number; links: number[][];
  unknown: { line: number; command: string; args: string[] }[];
}

/** Ordered CFG subset. Unknown commands remain visible; attach is compatibility, not an instance. */
export function parsePartConfig(source: string): PartConfig {
  const result: PartConfig = { slots: [], stock: [], bodies: [], wheels: [], renders: [], links: [], unknown: [] };
  let slot: CfgSlot | undefined, deformable: number | undefined, render: number | undefined;
  let renderPose: CfgPose | undefined, deformablePose: CfgPose | undefined, radius: number | undefined;
  let spring: Triple | undefined;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const text = raw.replace(/(?:#|;|\/\/).*$/, '').trim();
    if (!text) continue;
    const [command, ...args] = text.split(/\s+/), line = index + 1;
    const fail = () => new Error(`CFG line ${line}: invalid ${command}`);
    const number = (i: number) => { const value = Number(args[i]); if (args[i] === undefined || !Number.isFinite(value)) throw fail(); return value; };
    const integer = (i: number) => { const value = number(i); if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw fail(); return value; };
    const rid = () => {
      const match = /^0x([0-9a-f]+)r?$/i.exec(args[0] ?? ''), value = match ? Number.parseInt(match[1], 16) : NaN;
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw fail(); return value;
    };
    const pose = (offset = 0): CfgPose => ({ position: [number(offset), number(offset + 1), number(offset + 2)], rotation: [number(offset + 3), number(offset + 4), number(offset + 5)] });
    switch (command.toLowerCase()) {
      case 'slot':
        slot = { ...pose(), id: integer(6), attach: [], compatible: [] };
        if (result.slots.some(s => s.id === slot!.id)) throw new Error(`CFG line ${line}: duplicate slot ${slot.id}`);
        result.slots.push(slot); break;
      case 'compatible':
      case 'attach':
        if (!slot) throw new Error(`CFG line ${line}: attach before slot`);
        slot[command.toLowerCase() as 'attach' | 'compatible'].push({ resource: rid(), slot: integer(1) }); break;
      case 'slottype':
        if (!slot) throw new Error(`CFG line ${line}: slottype before slot`);
        slot.type = integer(0); break;
      case 'bonepos':
        if (!slot) throw new Error(`CFG line ${line}: bonepos before slot`);
        slot.bonePosition = [number(0), number(1), number(2)]; break;
      case 'linked': result.links.push(args.map((_, i) => integer(i))); break;
      case 'stockpart': result.stock.push(rid()); break;
      case 'render': {
        const resource = rid(), poseValue = args.length === 4 ? { position: [number(1), number(2), number(3)] as Triple, rotation: [0, 0, 0] as Triple } : args.length > 1 ? pose(1) : undefined;
        result.renders.push({ resource, pose: poseValue });
        if (render === undefined) { render = resource; renderPose = poseValue; }
        break;
      }
      case 'deformable': deformable = rid(); deformablePose = args.length > 1 ? pose(1) : undefined; break;
      case 'mesh': result.mesh = rid(); break;
      case 'texture': result.texture = rid(); break;
      case 'body': {
        const body = { ...pose(), mass: number(6), shape: args.slice(7) };
        if (body.mass < 0 || !body.shape.length) throw fail();
        result.bodies.push(body); break;
      }
      case 'nocollision': if (result.bodies.length) result.bodies.at(-1)!.collision = false; result.unknown.push({ line, command, args }); break;
      case 'type':
        spring = undefined;
        radius = args[1]?.toLowerCase() === 'sphere' ? number(2) : undefined;
        if (radius !== undefined && radius <= 0) throw fail();
        result.unknown.push({ line, command, args }); break;
      case 'spring': spring = [number(0), number(1), number(2)]; if (spring.some(v => v <= 0)) throw fail(); break;
      case 'wheel': result.wheels.push({ ...pose(), radius, spring: spring && [...spring], parameters: args.slice(6).map((_, i) => number(i + 6)) }); break;
      case 'steering': result.steering = pose(); break;
      case 'maxsteer':
        result.maxSteer = number(0);
        if (result.maxSteer <= 0) throw fail();
        if (args.length > 1) {
          result.ackermann = number(1);
          if (result.ackermann < 0) throw fail();
        }
        break;
      default: result.unknown.push({ line, command, args });
    }
  }
  // Chassis render can describe the steering subcompound. Its shell is deformable.
  result.render = deformable ?? render;
  result.renderPose = deformable === undefined ? renderPose : deformablePose;
  return result;
}
