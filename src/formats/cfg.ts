export type Triple = [number, number, number];
export interface CfgPose { position: Triple; rotation: Triple }
export interface CfgSlot extends CfgPose { id: number; attach: { resource: number; slot: number }[] }
export interface PartConfig {
  slots: CfgSlot[]; stock: number[]; render?: number; mesh?: number; texture?: number;
  bodies: (CfgPose & { mass: number; shape: string[] })[];
  wheels: CfgPose[]; unknown: { line: number; command: string; args: string[] }[];
}

/** Ordered CFG subset. Unknown commands remain visible; attach is compatibility, not an instance. */
export function parsePartConfig(source: string): PartConfig {
  const result: PartConfig = { slots: [], stock: [], bodies: [], wheels: [], unknown: [] };
  let slot: CfgSlot | undefined, deformable: number | undefined, render: number | undefined;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const text = raw.replace(/(?:#|;|\/\/).*$/, '').trim();
    if (!text) continue;
    const [command, ...args] = text.split(/\s+/), line = index + 1;
    const fail = () => new Error(`CFG line ${line}: invalid ${command}`);
    const number = (i: number) => { const value = Number(args[i]); if (args[i] === undefined || !Number.isFinite(value)) throw fail(); return value; };
    const integer = (i: number) => { const value = number(i); if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw fail(); return value; };
    const rid = () => { if (!/^0x[0-9a-f]{1,8}$/i.test(args[0] ?? '')) throw fail(); return integer(0); };
    const pose = (): CfgPose => ({ position: [number(0), number(1), number(2)], rotation: [number(3), number(4), number(5)] });
    switch (command.toLowerCase()) {
      case 'slot':
        slot = { ...pose(), id: integer(6), attach: [] };
        if (result.slots.some(s => s.id === slot!.id)) throw new Error(`CFG line ${line}: duplicate slot ${slot.id}`);
        result.slots.push(slot); break;
      case 'attach':
        if (!slot) throw new Error(`CFG line ${line}: attach before slot`);
        slot.attach.push({ resource: rid(), slot: integer(1) }); break;
      case 'stockpart': result.stock.push(rid()); break;
      case 'render': render ??= rid(); break;
      case 'deformable': deformable = rid(); break;
      case 'mesh': result.mesh = rid(); break;
      case 'texture': result.texture = rid(); break;
      case 'body': {
        const body = { ...pose(), mass: number(6), shape: args.slice(7) };
        if (body.mass < 0 || !body.shape.length) throw fail();
        result.bodies.push(body); break;
      }
      case 'wheel': result.wheels.push(pose()); break;
      default: result.unknown.push({ line, command, args });
    }
  }
  // Chassis render can describe the steering subcompound. Its shell is deformable.
  result.render = deformable ?? render;
  return result;
}
