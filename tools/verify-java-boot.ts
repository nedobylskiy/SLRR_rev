import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Assets } from '../src/assets';
import { entryProperties } from '../src/formats/rpk';
import { jv } from 'slrr-jvm';
import { bootGame } from '../src/runtime/game-boot';
import { activeJavaTrack, javaDrivingControls } from '../src/runtime/java-scene';
import { packedResourceId } from '../src/runtime/resource-ids';
import type { OsdLayer } from '../src/osd/osd-layer';

const root = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
const classOnly = process.argv.includes('--class-only');
const names = (await readdir(join(root, 'sl/Scripts/game/src')))
  .filter(name => name.toLowerCase().endsWith('.java')).map(name => `sl/Scripts/game/src/${name}`);
const systemNames = (await readdir(join(root, 'system/scripts'), { recursive: true }))
  .filter(name => (classOnly ? /\.class$/i : /\.(java|class)$/i).test(name))
  .map(name => `system/scripts/${name.replaceAll('\\', '/')}`);
const carNames = ['cars.rpk', ...(await readdir(join(root, 'cars'), { recursive: true }))
  .filter(name => /\.(rpk|java|cfg)$/i.test(name)).map(name => `cars/${name.replaceAll('\\', '/')}`)];
const eventNames = (await readdir(join(root, 'sl/Scripts/game/CareerEvents'), { recursive: true }))
  .filter(name => /\.(rpk|java)$/i.test(name))
  .map(name => `sl/Scripts/game/CareerEvents/${name.replaceAll('\\', '/')}`);
const trackNames = (await readdir(join(root, 'multibot/maps'), { recursive: true }))
  .filter(name => /(?:^|[\\/])t_data\.rpk$|[\\/]data[\\/]src[\\/][^\\/]+\.java$/i.test(name))
  .map(name => `multibot/maps/${name.replaceAll('\\', '/')}`);
const gamemodeNames = (await readdir(join(root, 'sl/Scripts/game/Gamemodes'), { recursive: true }))
  .filter(name => /\.(rpk|java)$/i.test(name))
  .map(name => `sl/Scripts/game/Gamemodes/${name.replaceAll('\\', '/')}`);
const partNames = ['parts.rpk', ...(await readdir(join(root, 'parts'), { recursive: true }))
  .filter(name => /\.(rpk|java|cfg)$/i.test(name)).map(name => `parts/${name.replaceAll('\\', '/')}`)];
const skyNames = ['maps/skydome.rpk', ...(await readdir(join(root, 'maps/skydome'), { recursive: true }))
  .map(name => `maps/skydome/${name.replaceAll('\\', '/')}`)];
const files = await Promise.all([...names, ...systemNames, ...carNames, ...eventNames, ...trackNames, ...gamemodeNames, ...partNames, ...skyNames,
  'system.rpk', 'frontend.rpk', 'frontend/textures/interface/icons/event_list/gamemode_freeride.png',
  'frontend/sounds/mnuselect.wav'].map(async path => {
  return { path, size: (await stat(join(root, path))).size };
}));
const assets = new Assets(files, async path => new Uint8Array(await readFile(join(root, path))));
let osdRectangles = 0;
const rectangleViews: { resource: unknown; bounds: number[]; removed: boolean }[] = [];
const element = () => ({ node: { style: {}, classList: { add() {}, remove() {} }, remove() {} },
  setText() {}, setResource() {}, setBounds() {}, show() {}, hide() {} });
const osd = {
  createText: element,
  createHitTarget: element,
  createRectangle: (x: number, y: number, w: number, h: number, depth: number, resource: unknown) => {
    osdRectangles++;
    const view = { resource, bounds: [x, y, w, h, depth], removed: false };
    rectangleViews.push(view);
    return { ...element(), node: { ...element().node, remove() { view.removed = true; } },
      setBounds(a: number, b: number, c: number, d: number, e: number) { view.bounds = [a, b, c, d, e]; } };
  },
} as unknown as OsdLayer;
const runtimeErrors: string[] = [];
const result = await bootGame(assets, event => {
  if (event.level === 'error') runtimeErrors.push(event.message);
  process.stdout.write(`${event.level}: ${event.message}\n`);
},
  undefined, undefined, osd, undefined, undefined, undefined, undefined, undefined, undefined,
  flare => {
    if (!flare.bytes.length) throw new Error(`Flare asset is empty: ${flare.path}`);
    process.stdout.write(`flare: ${flare.path} (${flare.bytes.length} bytes)\n`);
  });
if (process.argv.includes('--diagnose')) {
  if (process.argv.includes('--scene-debug')) {
    const roots = result.gameTypes.roots();
    const nodes = roots.flatMap(function visit(node: (typeof roots)[number]): typeof roots {
      return [node, ...[...node.children].flatMap(visit)];
    });
    for (const node of nodes.filter(node => /GroundRef|Vehicle|TestTrack/.test(node.className)))
      process.stdout.write(`scene: ${node.className} ${node.resourcePack ?? '-'} ${node.resourceId} parent=${node.parentId ?? '-'}\n`);
    const player = result.jvm.get(jv('class', 'java.game.GameLogic'), 'player');
    const car = player.value == null ? null : result.jvm.get(player, 'car');
    const chassis = car?.value == null ? null : result.jvm.get(car, 'chassis');
    const chassisNode = chassis?.value == null ? null : result.gameTypes.getResource(chassis);
    process.stdout.write(`scene car: ${car?.type ?? '-'} chassis=${chassisNode?.resourcePack ?? '-'}:${chassisNode?.typeId ?? '-'}\n`);
    const state = result.jvm.get(jv('class', 'java.game.GameLogic'), 'actualState');
    const start = state.value == null ? null : result.jvm.get(state, 'posStart');
    const startNode = start?.value == null ? null : { x: result.jvm.get(start, 'x').value, y: result.jvm.get(start, 'y').value, z: result.jvm.get(start, 'z').value };
    process.stdout.write(`scene start: ${state.type} ${JSON.stringify(startNode)}\n`);
    process.stdout.write(`scene selection: ${JSON.stringify(activeJavaTrack(result))}\n`);
  }
  result.dispose();
  process.exit(result.error ? 1 : 0);
}
if (result.error) {
  process.stderr.write(`Java boot stopped: ${result.error.message}\n`);
  process.exitCode = 1;
}
if (process.argv.includes('--animate-smoke') && !result.error) {
  try {
    const state = result.jvm.get(jv('class', 'java.game.GameLogic'), 'actualState');
    process.stdout.write(`animate callback: ${result.gameTypes.hasCallback(state, 28)}\n`);
    const player = result.jvm.get(jv('class', 'java.game.GameLogic'), 'player');
    const controller = result.jvm.get(player, 'controller');
    process.stdout.write(`driver bindings: ${result.controllers.bindings(controller).length}; sample: ${JSON.stringify(javaDrivingControls(result).sample())}\n`);
    result.input.setKeyboardCode('ArrowUp', true);
    result.input.setKeyboardCode('ArrowLeft', true);
    const pressed = javaDrivingControls(result).sample();
    if (pressed.throttle <= 0 || pressed.steer <= 0) throw new Error(`Java driver bindings did not respond: ${JSON.stringify(pressed)}`);
    result.input.setKeyboardCode('ArrowUp', false);
    result.input.setKeyboardCode('ArrowLeft', false);
    await result.jvm.invokeAsync(state, 'animate');
    process.stdout.write('Track.animate completed\n');
  } catch (reason) {
    process.stderr.write(`Track.animate failed: ${reason instanceof Error ? reason.message : String(reason)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--sfx-smoke') && !result.error) {
  try {
    const { entry } = await assets.resource('frontend.rpk', 0x7a);
    const source = entryProperties(entry).find(prop => prop.key === 'sourcefile')?.value;
    if (!source || !(await assets.read(source)).length) throw new Error('Menu selection sound resource is missing');
    await result.jvm.loadClass('java.util.resource.SfxRef');
    const resourceId = result.jvm.get(jv('class', 'java.render.Frontend'), 'SFX_MENU_SELECT');
    const ref = await result.jvm.constructAsync('java.util.resource.SfxRef', [resourceId]);
    const handle = await result.jvm.invokeAsync(ref, 'play');
    if (handle.type !== 'int' || Number(handle.value) <= 0) throw new Error('SfxRef.play returned no voice handle');
    process.stdout.write('Original menu sound resource and SfxRef.play verified\n');
  } catch (error) {
    process.stderr.write(`Menu sound stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--event-list-smoke') && !result.error) {
  try {
    const events = result.jvm.get(jv('class', 'java.game.GameLogic'), 'freerideEvents').value;
    if (!Array.isArray(events) || !events.length) throw new Error('Freeride events unavailable');
    const event = jv('CareerEvent', events[0]);
    const trackId = result.jvm.get(event, 'track_data_id');
    if (!trackId.resource) throw new Error('Freeride track ID lost its resource pack');
    await result.jvm.invokeAsync(event, 'init');
    process.stdout.write('First freeride event initialized\n');
  } catch (error) {
    process.stderr.write(`Freeride event init stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--event-list-screen-smoke') && !result.error) {
  try {
    await result.jvm.loadClass('java.game.EventList');
    const section = await result.jvm.constructAsync('java.game.EventList', [jv('int', 4)]);
    await result.jvm.invokeAsync(section, 'enter', [jv('GameState', null)]);
    const generator = result.jvm.get(section, 'eGen');
    const inspect = () => {
      const event = result.jvm.get(generator, 'cEvent');
      const picture = result.jvm.get(generator, 'trackPic');
      const texture = result.jvm.get(event, 'e_bck');
      const instance = result.jvm.get(picture, 'ins');
      const render = result.gameTypes.getRender(instance);
      return { texture: result.gameTypes.getResource(texture),
        texId: Number(result.jvm.get(result.jvm.get(picture, 'rt'), 'texID').value), render: render?.id };
    };
    const first = inspect();
    await new Promise(resolve => setTimeout(resolve, 180));
    const event = result.jvm.get(generator, 'cEvent');
    const gamemode = result.jvm.get(event, 'careerGM');
    const shieldIcon = result.jvm.get(gamemode, 'shieldIcon');
    const shield = result.gameTypes.getResource(shieldIcon);
    if (!shield?.resourcePack) throw new Error('Freeride mode icon has no resource pack');
    const iconEntry = await assets.resource(shield.resourcePack, shield.resourceId);
    const iconSource = entryProperties(iconEntry.entry).find(prop => prop.key === 'sourcefile')?.value;
    if (!iconSource || !(await assets.read(iconSource)).length)
      throw new Error('Freeride mode icon image could not be loaded');
    if (!rectangleViews.some(v => !v.removed && typeof v.resource === 'object' && v.resource
      && 'id' in v.resource && Number(v.resource.id) === shield.resourceId))
      throw new Error('Freeride mode icon did not reach the OSD layer');
    const lowerFrame = rectangleViews.find(v => !v.removed && typeof v.resource === 'object' && v.resource
      && 'id' in v.resource && Number(v.resource.id) === 0xc0a0);
    if (!lowerFrame || Math.abs(lowerFrame.bounds[2] - 2) > 0.001 || lowerFrame.bounds[4] % 1_000_000 !== 2)
      throw new Error(`Event lower frame has incorrect bounds or depth: ${JSON.stringify(lowerFrame?.bounds)}`);
    await result.jvm.invokeAsync(generator, 'nextEvent');
    const second = inspect();
    if (first.texture?.resourcePack === second.texture?.resourcePack || first.texId === second.texId || first.render === second.render)
      throw new Error('Next event did not replace the track image from its own resource pack');
    if (!rectangleViews.some(v => !v.removed && typeof v.resource === 'object' && v.resource
      && 'pack' in v.resource && String(v.resource.pack) === second.texture?.resourcePack))
      throw new Error('Next track image did not reach the OSD layer');
    process.stdout.write('Event list frame and next-track image verified\n');
  } catch (error) {
    process.stderr.write(`Event screen stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if ((process.argv.includes('--options-smoke') || process.argv.includes('--options-show-smoke')) && !result.error) {
  try {
    await result.jvm.loadClass('java.game.OptionsDialog');
    const dialog = await result.jvm.constructAsync('java.game.OptionsDialog', [jv('int', 0)]);
    if (process.argv.includes('--options-show-smoke')) await result.jvm.invokeAsync(dialog, 'show');
    process.stdout.write(process.argv.includes('--options-show-smoke')
      ? 'OptionsDialog.show completed\n' : 'OptionsDialog constructor completed\n');
  } catch (error) {
    process.stderr.write(`OptionsDialog constructor stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--credits-smoke') && !result.error) {
  try {
    await result.jvm.loadClass('java.game.CreditsDialog');
    const dialog = await result.jvm.constructAsync('java.game.CreditsDialog', []);
    await result.jvm.invokeAsync(dialog, 'show');
    await new Promise(resolve => setTimeout(resolve, 3_000));
    if (runtimeErrors.length) throw new Error(runtimeErrors.join('; '));
    process.stdout.write('CreditsDialog.show completed\n');
  } catch (error) {
    process.stderr.write(`CreditsDialog.show stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--name-request-smoke') && !result.error) {
  try {
    await result.jvm.loadClass('java.render.osd.dialog.StringRequesterDialog');
    const player = result.jvm.get(jv('class', 'java.game.GameLogic'), 'player');
    const controller = result.jvm.get(player, 'controller');
    const dialog = await result.jvm.constructAsync('java.render.osd.dialog.StringRequesterDialog',
      [controller, jv('int', 0), jv('String', 'Enter player name'), jv('String', '')]);
    await result.jvm.invokeAsync(dialog, 'show');
    process.stdout.write('StringRequesterDialog.show completed\n');
  } catch (error) {
    process.stderr.write(`StringRequesterDialog constructor stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--text-dialog-smoke') && !result.error) {
  try {
    await result.jvm.loadClass('java.render.osd.dialog.TextDialog');
    const player = result.jvm.get(jv('class', 'java.game.GameLogic'), 'player');
    const controller = result.jvm.get(player, 'controller');
    const dialog = await result.jvm.constructAsync('java.render.osd.dialog.TextDialog',
      [controller, jv('int', 0), jv('String', 'Information'), jv('String', 'OK'),
        jv('String', 'This paragraph exercises the original Java TextBox line wrapping.')]);
    await result.jvm.invokeAsync(dialog, 'show');
    process.stdout.write('TextDialog.show completed\n');
  } catch (error) {
    process.stderr.write(`TextDialog.show stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--extras-enter-smoke') && !result.error) {
  try {
    await result.jvm.loadClass('java.game.Gates');
    const gates = await result.jvm.constructAsync('java.game.Gates', []);
    const command = result.jvm.invokeAsync(gates, 'osdCommand', [jv('int', 0xb002)]);
    let commandError: unknown;
    void command.catch(error => { commandError = error; });
    await new Promise(resolve => setTimeout(resolve, 1_000));
    if (commandError) throw commandError;
    if (runtimeErrors.length) throw new Error(runtimeErrors.join('; '));
    const dialog = result.gameTypes.roots().find(node => node.className === 'java.game.ExtrasDialog');
    if (!dialog) throw new Error('Enter did not open ExtrasDialog');
    await result.jvm.invokeAsync(result.gameTypes.reference(dialog), 'osdCommand', [jv('int', 0)]);
    await command;
    process.stdout.write('Gates Enter opened and closed ExtrasDialog\n');
  } catch (error) {
    process.stderr.write(`Gates Enter stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  result.dispose();
  process.exit(process.exitCode ?? 0);
}
if (osdRectangles < 10) {
  process.stderr.write(`Java OSD emitted only ${osdRectangles} visible rectangle resources\n`);
  process.exitCode = 1;
} else process.stdout.write(`Java OSD rectangles: ${osdRectangles}\n`);
const colors = result.jvm.get(jv('class', 'java.game.GameLogic'), 'CARCOLORS').value;
const expectedColor = packedResourceId(await assets.pack('frontend.rpk'), { pack: 'cars', id: 0x2a });
if (!Array.isArray(colors) || colors[0] !== expectedColor) {
  process.stderr.write(`GameLogic.CARCOLORS[0] did not match the frontend RPK's cars:0x2A ID: ${Array.isArray(colors) ? colors[0] : colors}\n`);
  process.exitCode = 1;
}
if (result.input.registeredHotkeys() < 5) {
  process.stderr.write('GameLogic did not register its global hotkeys\n');
  process.exitCode = 1;
}
const timeRefresher = result.jvm.get(jv('class', 'java.game.GameLogic'), 'timeRefresher');
if (!timeRefresher.value || Number((await result.jvm.invokeAsync(timeRefresher, 'isAlive')).value) !== 1) {
  process.stderr.write('GameLogic did not start its Java time refresher thread\n');
  process.exitCode = 1;
}
const mounted = result.gameTypes.roots();
const vehicles = mounted.filter(node => /_VT\.class$/i.test(node.resourceScript ?? '')).length;
const events = mounted.filter(node => /CareerEvents[\\/]\w+\.class$/i.test(node.resourceScript ?? '')).length;
if (vehicles < 25 || events < 59) {
  process.stderr.write(`Scripted resource factories incomplete: ${vehicles} vehicle types, ${events} career events\n`);
  process.exitCode = 1;
}
const trackData = mounted.filter(node => /[\\/]track_data\.class$/i.test(node.resourceScript ?? ''));
if (trackData.length < 5 || new Set(trackData.map(node => node.className)).size < 5) {
  process.stderr.write(`Pack-scoped track scripts incomplete: ${trackData.length} instances, ${new Set(trackData.map(node => node.className)).size} classes\n`);
  process.exitCode = 1;
}
const nodes = mounted.flatMap(function visit(node: (typeof mounted)[number]): typeof mounted {
  return [node, ...[...node.children].flatMap(visit)];
});
const whisper = nodes.find(node => node.className === 'java.game.cars.Whisper_Q1000XL');
const engine = whisper && result.jvm.natives.invoke('java.game.parts.Part', 'partOnSlot',
  result.gameTypes.reference(whisper), [jv('int', 401)]);
if (!engine?.value || !/LP_V12_engine_block_racing/.test(result.gameTypes.getResource(engine)?.className ?? '')) {
  process.stderr.write('Java stock installation did not attach the racing V12 to CFG slot 401\n');
  process.exitCode = 1;
}
if (whisper && result.chassis.scriptSfx(result.gameTypes.reference(whisper), 0).length === 0) {
  process.stderr.write('Java engine script did not populate its native SfxTable\n');
  process.exitCode = 1;
}
if (engine?.value) {
  const dynodata = result.jvm.get(engine, 'dynodata');
  const curve = dynodata.value == null ? undefined : result.dyno.curve(dynodata);
  if (!curve || curve.torque.length < 2 || !curve.torque.some(torque => torque > 0)) {
    process.stderr.write('Java DynoData did not produce a usable torque curve\n');
    process.exitCode = 1;
  }
}
if (whisper) {
  const mass = Number(result.jvm.natives.invoke('java.game.parts.bodypart.Chassis', 'getMass',
    result.gameTypes.reference(whisper), [])?.value);
  if (!Number.isFinite(mass) || mass < 1200) {
    process.stderr.write(`Installed Whisper mass is invalid: ${mass}\n`);
    process.exitCode = 1;
  }
}
if (!nodes.some(node => /[\\/]seat_Torino\.class$/i.test(node.resourceScript ?? '')
  && node.className === 'java.game.parts.interior.seat_Torino')) {
  process.stderr.write('Prize part did not resolve to its Java class\n');
  process.exitCode = 1;
}
const tracks = result.jvm.get(jv('class', 'java.game.GameLogic'), 'mapStack').value;
if (!Array.isArray(tracks) || tracks.length < 19) {
  process.stderr.write(`Track metadata catalog incomplete: ${Array.isArray(tracks) ? tracks.length : 0} tracks\n`);
  process.exitCode = 1;
}
result.input.poll();
if (process.argv.includes('--hotkey-smoke')) {
  result.input.setPhysicalAxis(0, 88, 1);
  try { result.input.poll(); process.stdout.write('Hotkey smoke: no Java callback\n'); }
  catch (error) { process.stdout.write(`Hotkey smoke: ${String(error)}\n`); }
}
if (process.argv.includes('--timer-smoke')) {
  const gameLogic = jv('class', 'java.game.GameLogic');
  const before = Number(result.jvm.get(gameLogic, 'time').value);
  result.jvm.set(gameLogic, 'timeRefreshRate', jv('int', 1));
  let heartbeats = 0;
  const heartbeat = setInterval(() => { heartbeats++; }, 100);
  await new Promise(resolve => setTimeout(resolve, 12_500));
  clearInterval(heartbeat);
  const after = Number(result.jvm.get(gameLogic, 'time').value);
  if (after - before < 8 || heartbeats < 110) {
    process.stderr.write(`Java timer did not advance while the host remained responsive: ${before} -> ${after}, ${heartbeats} heartbeats\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Java timer smoke: ${before} -> ${after}, ${heartbeats} host heartbeats\n`);
}
result.dispose();
