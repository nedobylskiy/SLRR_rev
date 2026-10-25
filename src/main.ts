import './style.css';
import { Assets, isSavedVehiclePath, type Asset } from './assets';
import { parseRpk, entryProperties } from './formats/rpk';
import { parseScx } from './formats/scx';
import { parseTufa } from './formats/tufa';
import { inspectSavedVehicle, serializeSdat } from './formats/sdat';
import { Viewer } from './render/viewer';
import { PartFactory, type EnginePart, type EngineWorld } from './engine/world';
import { DEFAULT_CHASSIS_CRUMPLE } from './engine/vehicle-3d';
import { Vector3 } from 'three';
import { mountMainMenu } from './osd/main-menu';
import { MainMenuRuntime } from './runtime/main-menu-runtime';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><div class="brand"><span class="mark">SL / R</span><div>REDLINE <b>REBUILT</b><small>Independent engine · Research build 0.1</small></div></div><div class="header-right"><span id="connection">Connecting…</span><button id="memory-lab">Memory stream</button><label class="button">Open game folder<input id="folder" type="file" webkitdirectory multiple hidden></label></div></header>
<main><aside><div class="eyebrow">ORIGINAL ASSETS</div><h1>Under the hood.</h1><p class="intro">SLRR assets in a new environment. No original EXE required.</p><div id="counts"></div><input id="search" type="search" placeholder="Search: Baiern, chassis, GameLogic…" aria-label="Search assets"><nav id="filters"><button data-kind="scx" class="active">Models</button><button data-kind="rpk">Packages</button><button data-kind="class">Scripts</button><button data-kind="cfg">CFG</button><button data-kind="vehicle">Cars</button></nav><div id="list" role="list"></div><div id="list-count"></div></aside>
<section class="workspace"><div class="toolbar"><div><span class="eyebrow" id="format">WEBGL / RESOURCE LAB</span><div id="filename">Select an asset on the left</div></div><span class="badge" id="state">Idle</span></div><div id="viewport"></div><div id="inspector" hidden></div><div class="scene-help" id="scene-help">Left drag: rotate &nbsp; · &nbsp; Wheel: zoom &nbsp; · &nbsp; Right drag: pan</div><div class="detail"><div class="eyebrow">DIAGNOSTICS</div><div id="details">Loading game catalog…</div></div></section></main><footer><span>TYPE SCRIPT / WEBGL 2</span><span>Geometry and assets: original installation · Game logic is not running yet</span><span id="total"></span></footer>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let assets: Assets, kind = 'scx', viewer: Viewer | undefined, sequence = 0, disposeMemoryLab: (() => void) | undefined;
let localInstallation = false;
let engineWorld: EngineWorld | undefined;
let engineRoot: EnginePart | undefined, disposeDriving: (() => void) | undefined;
let beforeDrivingDetails = '';
let disposeOsdMenu: (() => void) | undefined;
const menuButton = textElement('button', 'Main menu');
el('memory-lab').before(menuButton);
menuButton.onclick = () => openMainMenu();
const worldButton = textElement('button', 'Assemble Baiern');
const mapButton = textElement('button', 'Test Track');
const trackDriveButton = textElement('button', 'Drive Test Track');
const trackWindowButton = textElement('button', 'Minimize view · Esc', 'track-window-button');
trackWindowButton.hidden = true; el('viewport').after(trackWindowButton);
let trackDriving = false;
function setTrackExpanded(expanded: boolean) {
  const active = expanded && trackDriving;
  el('viewport').parentElement?.classList.toggle('track-drive-expanded', active);
  document.body.classList.toggle('track-drive-expanded', active);
  trackWindowButton.hidden = !active;
  trackDriveButton.textContent = trackDriving ? 'Expand drive view' : 'Drive Test Track';
  if (trackDriving) el('viewport').querySelector('canvas')?.focus({ preventScroll: true });
}
trackWindowButton.onclick = () => setTrackExpanded(false);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && trackDriving && !trackWindowButton.hidden) {
    event.preventDefault(); setTrackExpanded(false);
  }
});
const driveButton = textElement('button', 'Test drive') as HTMLButtonElement;
const hoodButton = textElement('button', 'Hood impact test'); hoodButton.className = 'hood-button'; el('counts').before(hoodButton);
const crashButton = textElement('button', 'Car and obstacle'); crashButton.className = 'hood-button'; hoodButton.after(crashButton);
const crashControls = textElement('div', '', 'hood-controls'); crashControls.hidden = true; el('scene-help').before(crashControls);
const mapDebugPanel = document.createElement('details'); mapDebugPanel.className = 'map-debug-panel'; mapDebugPanel.hidden = true;
mapDebugPanel.append(textElement('summary', 'Map collision frames'));
const mapDebugOptions = textElement('div', '', 'map-debug-options');
const mapDebugChecks: HTMLInputElement[] = [];
for (const [layer, title] of [['terrain', 'Support surfaces'], ['walls', 'Side faces'], ['boxes', 'CFG boxes']] as const) {
  const label = textElement('label', title), input = document.createElement('input'); input.type = 'checkbox';
  input.onchange = () => viewer?.showMapDebug(layer, input.checked);
  label.prepend(input); mapDebugOptions.append(label); mapDebugChecks.push(input);
}
mapDebugPanel.append(mapDebugOptions); el('scene-help').before(mapDebugPanel);
const showMapDebugControls = () => { mapDebugPanel.hidden = false; mapDebugPanel.open = false; for (const input of mapDebugChecks) input.checked = false; };
let crashSession: ReturnType<Viewer['drive']> | undefined;
for (const [label, speed] of [['Impact at 10 km/h', 10 / 3.6], ['Impact at 50 km/h', 50 / 3.6], ['Reset', 0]] as const) {
  const button = textElement('button', label); button.onclick = () => crashSession?.launch(speed); crashControls.append(button);
}
const crumpleLabel = textElement('label', 'Chassis deformation'), crumpleSlider = document.createElement('input'), crumpleValue = textElement('output', `×${DEFAULT_CHASSIS_CRUMPLE.toFixed(2)}`);
crumpleLabel.className = 'crumple-control'; crumpleSlider.type = 'range'; crumpleSlider.min = '0.5'; crumpleSlider.max = '1.5'; crumpleSlider.step = '0.05'; crumpleSlider.value = String(DEFAULT_CHASSIS_CRUMPLE);
crumpleSlider.setAttribute('aria-label', 'Chassis deformation'); crumpleSlider.title = 'Adjusts chassis deformation on the next impact';
crumpleSlider.oninput = () => { const value = Number(crumpleSlider.value); crumpleValue.textContent = `×${value.toFixed(2)}`; crashSession?.chassisCrumple(value); };
crumpleLabel.append(crumpleSlider, crumpleValue); crashControls.append(crumpleLabel);
const crashCageLabel = textElement('label', ' Part frames'), crashCage = document.createElement('input'); crashCage.type = 'checkbox';
const internalsLabel = textElement('label', ' Internal parts'), internals = document.createElement('input'); internals.type = 'checkbox';
internals.onchange = () => viewer?.showInternals(internals.checked); internalsLabel.prepend(internals); crashControls.append(internalsLabel);
const dropButton = textElement('button', 'Drop hood on roof'); dropButton.onclick = () => crashSession?.drop(); crashControls.append(dropButton);
const jumpButton = textElement('button', 'Ramp'), rollButton = textElement('button', 'Side impact');
const rearButton = textElement('button', 'Rear impact'); rearButton.onclick = () => crashSession?.rear(); crashControls.append(rearButton);
const engineRelease = textElement('button', 'Detach engine'); engineRelease.onclick = () => crashSession?.breakEngine(); crashControls.append(engineRelease);
const strutFailure = textElement('button', 'Break left strut'); strutFailure.onclick = () => crashSession?.breakStrut(); crashControls.append(strutFailure);
jumpButton.onclick = () => crashSession?.jump(); rollButton.onclick = () => crashSession?.roll(); crashControls.append(jumpButton, rollButton);
crashCage.onchange = () => crashSession?.wireframe(crashCage.checked); crashCageLabel.prepend(crashCage); crashControls.append(crashCageLabel);
const slowLabel = textElement('label', ' Slow motion ×4'), slow = document.createElement('input'); slow.type = 'checkbox';
slow.onchange = () => crashSession?.slowMotion(slow.checked); slowLabel.prepend(slow); crashControls.append(slowLabel);
const pauseLabel = textElement('label', ' Pause'), pause = document.createElement('input'); pause.type = 'checkbox';
pause.onchange = () => crashSession?.pause(pause.checked); pauseLabel.prepend(pause); crashControls.append(pauseLabel);
const hoodControls = textElement('div', '', 'hood-controls'); hoodControls.hidden = true;
const hoodHud = textElement('div', '', 'hood-telemetry'); hoodHud.setAttribute('role', 'status'); hoodControls.append(hoodHud);
el('scene-help').before(hoodControls);
let hood: Awaited<ReturnType<Viewer['hood']>>;
for (const [label, impulse] of [['Light impact', 5], ['Dent', 65], ['Overload', 650]] as const) {
  const button = textElement('button', label); button.onclick = () => hood?.hit(impulse); button.title = `${impulse} N·s`; hoodControls.append(button);
}
const resetHood = textElement('button', 'Reset hood'); resetHood.onclick = () => hood?.reset(); hoodControls.append(resetHood);
const cageLabel = textElement('label', ' Physics frame');
const cage = document.createElement('input'); cage.type = 'checkbox'; cage.onchange = () => hood?.wireframe(cage.checked); cageLabel.prepend(cage); hoodControls.append(cageLabel);
const driveHud = textElement('div', '', 'drive-hud'); driveHud.hidden = true; driveHud.setAttribute('aria-label', 'Vehicle speed'); el('viewport').append(driveHud);
el('memory-lab').before(worldButton, driveButton, mapButton, trackDriveButton);
trackDriveButton.onclick = async () => {
  if (trackDriving) { setTrackExpanded(true); return; }
  if (!assets || !viewer) return;
  await openWorld('cars/racers/Baiern.rpk', 6);
  const request = sequence;
  if (!engineRoot || !viewer) return;
  try {
    status('Loading track…');
    const map = await viewer.showMap('maps/test_track.rpk', assets, (done, total) => {
      if (request === sequence) status(`Track ${done}/${total}`);
    }, true);
    if (request !== sequence || !engineRoot) return;
    showMapDebugControls();
    const start = new Vector3(0, map.terrain.height(0, -1461.785) + 0.15, -1461.785);
    if (start.y < -100) throw new Error('No track surface at the start line');
    beforeDrivingDetails = el('details').textContent ?? '';
    crashSession = viewer.drive(engineRoot, text => { driveHud.textContent = text; }, true, { terrain: map.terrain, collision: map.collision, position: start, yaw: Math.PI }, assets);
    crashSession.chassisCrumple(Number(crumpleSlider.value));
    disposeDriving = crashSession; driveHud.hidden = false; driveHud.classList.add('crash-hud');
    trackDriving = true; setTrackExpanded(true);
    el('viewport').parentElement?.classList.add('physics-scene');
    el('filename').textContent = 'Test Track · driving'; el('format').textContent = 'MAP / PHYSICS';
    el('scene-help').textContent = 'Start in neutral: E first gear, Q reverse, N neutral · W/S throttle/reverse · A/D steer · Space brake · Shift clutch · R reset to start';
    el('details').textContent = `${map.loaded} map models · ${map.objects} RDB/CFG objects · ${map.collision.boxes} collision boxes · ${map.terrain.faces} support triangles. The start position comes from the quarter-mile straight in TestTrack.java. Placed objects use original RDB positions and CFG box shapes; the remaining map collision currently comes from SCX.`;
    status('Driving on Test Track');
  } catch (error) { if (request === sequence) { stopDrive(); viewer.clear(); status('Drive unavailable', true); el('details').textContent = String(error); } }
};
mapButton.onclick = async () => {
  if (!assets || !viewer) return;
  const request = ++sequence;
  stopDrive(); engineRoot = undefined; engineWorld?.dispose(); engineWorld = undefined;
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  el('filename').textContent = 'test_track · original geometry'; el('format').textContent = 'MAP / WEBGL';
  status('Loading track…'); el('details').textContent = 'Reading SCX and textures from maps/test_track.rpk…';
  try {
    const result = await viewer.showMap('maps/test_track.rpk', assets, (done, total) => {
      if (request === sequence) status(`Track ${done}/${total}`);
    });
    if (request !== sequence) return;
    showMapDebugControls();
    el('details').textContent = `${result.loaded}/${result.total} models · ${result.objects} placed RDB/CFG objects · ${result.triangles.toLocaleString('en-US')} map triangles. Geometry and textures come from the original RPK/SCX; objects use RDB coordinates. Road collision is still approximate.\n${result.warnings.slice(0, 12).join('\n')}`;
    status(result.loaded ? 'Track loaded' : 'No geometry', !result.loaded);
  } catch (error) { if (request === sequence) { viewer.clear(); status('Map error', true); el('details').textContent = String(error); } }
};
function stopDrive() {
  disposeOsdMenu?.(); disposeOsdMenu = undefined;
  trackDriving = false; setTrackExpanded(false);
  el('viewport').parentElement?.classList.remove('physics-scene');
  mapDebugPanel.hidden = true;
  crashSession = undefined; crashControls.hidden = true; driveHud.classList.remove('crash-hud');
  hood?.dispose(); hood = undefined; hoodControls.hidden = true;
  if (disposeDriving) el('details').textContent = beforeDrivingDetails;
  disposeDriving?.(); disposeDriving = undefined; driveHud.hidden = true; driveButton.textContent = 'Test drive';
  el('scene-help').textContent = 'Left drag: rotate · Wheel: zoom · Right drag: pan';
}
async function openMainMenu() {
  if (!assets?.byPath.has('frontend.rpk')) { status('Menu assets unavailable', true); return; }
  const request = ++sequence;
  stopDrive(); engineRoot = undefined; engineWorld?.dispose(); engineWorld = undefined;
  disposeMemoryLab?.(); disposeMemoryLab = undefined; viewer?.clear();
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  try {
    const source = new TextDecoder().decode(await assets.read('sl/scripts/game/src/MainMenu.java'));
    if (request !== sequence) return;
    const runtime = new MainMenuRuntime(source), built = runtime.enter();
    const menu = mountMainMenu(document.body, assets, built.items, built.selected, built.layout, runtime.primaryVisuals(), action => runtime.dispatchMenuAction(action), item => {
      if (item.command === 0xa008) { trackDriveButton.click(); return; }
      if (item.command === 0xb004) { stopDrive(); status('Asset catalog'); return; }
      menu.showMessage('This section will be available after the game logic is ported.');
    }, () => { void menu.animateOut(runtime.cleanupVisuals()).then(() => { stopDrive(); status('Asset catalog'); }); }, localInstallation ? '/api/game/menu-video' : undefined, () => runtime.tick(), runtime.versionText);
    disposeOsdMenu = () => { runtime.exit(); menu.dispose(); };
    el('filename').textContent = 'Main menu · MainMenu.java'; el('format').textContent = 'JAVA / OSD';
    el('scene-help').textContent = '←/→ select · Enter open · Esc asset catalog';
    el('details').textContent = 'MainMenu.enter(), Gates.show(), Gates.buildSlidingMenu(), Gates.run(), and Gates.osdCommand() execute from the installed Java source. Calls to other game systems are currently stubbed. Freeride opens the current track; other sections await the game-logic port.';
    status('Main menu');
  } catch (error) { if (request === sequence) { status('MainMenu.java execution error', true); el('details').textContent = String(error); } }
}
crashButton.onclick = async () => {
  const opening = openWorld('cars/racers/Baiern.rpk', 6), request = sequence;
  await opening;
  if (request !== sequence || !engineRoot || !viewer) return;
  try {
    beforeDrivingDetails = el('details').textContent ?? '';
    crashSession = viewer.drive(engineRoot, text => { driveHud.textContent = text; }, true, undefined, assets); disposeDriving = crashSession;
    crashSession.chassisCrumple(Number(crumpleSlider.value));
    el('viewport').parentElement?.classList.add('physics-scene');
    slow.checked = false; pause.checked = false; crashSession.slowMotion(false);
    crashControls.hidden = false; crashCage.checked = false; internals.checked = false; driveHud.hidden = false; driveHud.classList.add('crash-hud'); driveButton.textContent = 'End drive';
    el('scene-help').textContent = 'Start in neutral: E first gear, Q reverse, N neutral · W/S throttle/reverse · A/D steer · Space brake · Shift clutch · R restore car';
    el('details').textContent = 'Original struts, springs, dampers, brakes, and engine are installed using Java addStockParts and CFG mounts. Their condition affects wheel support, damping, braking, and power; wheel misalignment starts below 10% strut condition. At zero condition, the strut remains on the chassis while the wheel detaches. The engine falls as one body with its nested parts. Detachment buttons set condition to 0% for diagnostics. Internal parts hides the body shell for inspection. R restores the assembly.';
    el('filename').textContent = 'Baiern · suspension and damage'; el('format').textContent = 'PHYSICS / 3D VEHICLE'; status('3D impact test');
  } catch (error) { stopDrive(); viewer.clear(); status('Test error', true); el('details').textContent = String(error); }
};
hoodButton.onclick = async () => {
  if (!assets || !viewer) return;
  const request = ++sequence;
  stopDrive(); driveButton.disabled = false; engineRoot = undefined; engineWorld?.dispose(); engineWorld = undefined;
  disposeMemoryLab?.(); disposeMemoryLab = undefined; viewer.clear();
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  el('filename').textContent = 'Baiern · original hood'; el('format').textContent = 'DEFORMABLE / IMPACT LAB'; status('Preparing hood…');
  try {
    const definition = await new PartFactory(assets).definition({ pack: 'cars/racers/Baiern.rpk', id: 0x10d });
    if (request !== sequence) return;
    const result = await viewer.hood(definition, assets, text => { if (request === sequence) { hoodHud.textContent = text; status(text.startsWith('Hood detached') ? 'Hood detached' : 'Impact test'); } });
    if (request !== sequence) { result?.dispose(); return; }
    hood = result; hoodControls.hidden = false; cage.checked = false;
    el('details').textContent = 'Original SCX and CFG mass. A light impact causes elastic flex; Dent leaves permanent deformation; Overload breaks the supports and drops the hood. Impacts can be repeated. Green points mark intact supports; red points mark broken ones. The frame, three supports, and material belong to this prototype: they are a new physics model, not a recovered SLRR algorithm. Collisions currently use frame-node contacts with the floor only.';
  } catch (error) { if (request === sequence) { viewer.clear(); status('Test error', true); el('details').textContent = String(error); } }
};
driveButton.onclick = async () => {
  if (disposeDriving) { stopDrive(); status('World assembled'); return; }
  if (!engineRoot) await openWorld('cars/racers/Baiern.rpk', 6);
  if (!engineRoot || !viewer) return;
  try {
    beforeDrivingDetails = el('details').textContent ?? '';
    disposeDriving = viewer.drive(engineRoot, text => { driveHud.textContent = text; });
    driveHud.hidden = false; driveButton.textContent = 'End drive';
    el('scene-help').textContent = 'W/S or ↑/↓ throttle/reverse · A/D or ←/→ steer · Space brake · R reset car';
    el('details').textContent = 'Empty test area. Mounts, wheel sizes, wheelbase, and steering limit come from CFG. Driving is simplified, without collisions, suspension, or original engine logic. Click the scene to control the car; drag to rotate the camera.';
    status('Test area');
  } catch (error) { stopDrive(); status('Drive unavailable', true); el('details').textContent = String(error); }
};
worldButton.onclick = () => { void openWorld('cars/racers/Baiern.rpk', 6); };
async function openWorld(pack: string, id: number) {
  if (!assets) return;
  const request = ++sequence;
  stopDrive(); engineRoot = undefined; driveButton.disabled = true;
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  engineWorld?.dispose(); engineWorld = undefined; viewer?.clear();
  el('filename').textContent = `${pack} : 0x${id.toString(16)} · CFG assembly`; el('format').textContent = 'ENGINE / WORLD'; status('Assembling…');
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  try {
    const built = await new PartFactory(assets).stock({ pack, id }, { mechanical: id === 6 && /cars\/racers\/baiern\.rpk$/i.test(pack) });
    if (request !== sequence) { built.world.dispose(); return; }
    engineWorld = built.world;
    const warnings = viewer ? await viewer.showWorld(built.world, assets) : ['WebGL unavailable'];
    if (request !== sequence) return;
    engineRoot = built.root;
    el('details').textContent = `${built.world.parts.size} objects · ${built.root.definition.cfgPath}\n${built.world.mechanical ? 'Stock suspension and engine parts are selected from original Java addStockParts and installed through RPK/CFG. Physics and engine behavior are approximate.' : 'Assembly follows stockpart/slot/attach, including nested parts.'}\n${[...built.warnings, ...warnings].join('\n')}`;
    status('World assembled');
  } catch (error) { if (request === sequence) { engineWorld?.dispose(); engineWorld = undefined; viewer?.clear(); status('Assembly error', true); el('details').textContent = String(error); } }
  finally { if (request === sequence) driveButton.disabled = false; }
}
try { viewer = new Viewer(el('viewport')); }
catch (e) { el('details').textContent = `WebGL unavailable: ${e}`; }

function status(text: string, error = false) { el('state').textContent = text; el('state').classList.toggle('error', error); }
function textElement(tag: string, text: string, className?: string) {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
}

async function connect() {
  try {
    const response = await fetch('/api/game/index');
    if (!response.ok) throw new Error(await response.text());
    const files: Asset[] = await response.json();
    localInstallation = true;
    attach(new Assets(files, async path => {
      const result = await fetch(`/api/game/file?path=${encodeURIComponent(path)}`);
      if (!result.ok) throw new Error(await result.text());
      return new Uint8Array(await result.arrayBuffer());
    }), 'Local installation');
    const example = files.find(f => /baiern_data\/meshes\/chassis\.scx$/i.test(f.path)) ?? files.find(f => /steeringwheel_4spoke_01\.scx$/i.test(f.path));
    if (assets.byPath.has('frontend.rpk')) openMainMenu();
    else if (assets.byPath.has('cars/racers/baiern.rpk')) await openWorld('cars/racers/Baiern.rpk', 6);
    else if (example) await openAsset(example);
  } catch (e) {
    el('connection').textContent = 'Select game folder';
    el('details').textContent = `Game catalog unavailable. Select an installed game with Open game folder. ${e}`;
    status('No catalog', true);
  }
}

function attach(source: Assets, label: string) {
  stopDrive(); engineRoot = undefined; engineWorld?.dispose(); engineWorld = undefined; viewer?.clear(); sequence++;
  driveButton.disabled = false;
  assets = source; el('connection').textContent = label;
  el('counts').replaceChildren(...['scx', 'rpk', 'class'].map(ext => {
    const card = document.createElement('div'); card.append(textElement('b', source.files.filter(f => f.path.toLowerCase().endsWith(`.${ext}`)).length.toLocaleString('en-US')), textElement('span', ext.toUpperCase())); return card;
  }));
  el('total').textContent = `${source.files.length.toLocaleString('en-US')} files`;
  renderList();
}

function renderList() {
  if (!assets) return;
  const q = el<HTMLInputElement>('search').value.toLowerCase().trim();
  const files = assets.files.filter(f => (kind === 'vehicle' ? isSavedVehiclePath(f.path) : f.path.toLowerCase().endsWith(`.${kind}`)) && f.path.toLowerCase().includes(q));
  const list = el('list'); list.replaceChildren();
  for (const file of files.slice(0, 250)) {
    const button = document.createElement('button'); button.className = 'asset'; button.title = file.path;
    button.append(textElement('span', file.path.split('/').at(-1)!), textElement('small', file.path.split('/').slice(0, -1).join('/')));
    button.onclick = () => { for (const child of list.children) child.classList.remove('selected'); button.classList.add('selected'); void openAsset(file); };
    list.append(button);
  }
  el('list-count').textContent = files.length > 250 ? `${files.length} found · showing first 250` : `${files.length} found`;
}

async function companionTextures(path: string) {
  const texPath = path.replace(/\.sc[xy]$/i, '.tex');
  if (!assets.byPath.has(texPath.toLowerCase())) return [];
  const prefix = path.slice(0, path.lastIndexOf('/') + 1);
  return new TextDecoder('windows-1252').decode(await assets.read(texPath)).split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(t => assets.byPath.has(t.replaceAll('\\', '/').toLowerCase()) ? t : prefix + t);
}

async function showModel(path: string, textures: string[] = [], request = sequence) {
  const model = parseScx(await assets.read(path));
  if (request !== sequence) return;
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  const resolvedTextures = textures.length ? textures : await companionTextures(path);
  if (request !== sequence) return;
  const warnings = viewer ? await viewer.show(model, assets, resolvedTextures) : ['WebGL unavailable'];
  if (request !== sequence) return;
  const vertices = model.meshes.reduce((n, m) => n + m.positions.length / 3, 0), faces = model.meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  el('details').textContent = `INVO v${model.version} · ${model.meshes.length} materials · ${vertices.toLocaleString('en-US')} vertices · ${faces.toLocaleString('en-US')} triangles\n${path}\n${warnings.join('\n') || 'Geometry validated. Scale adjusted for viewing; vehicle physics and assembly are not yet implemented here.'}`;
  status(viewer ? 'Model loaded' : 'No WebGL', !viewer);
}

async function openAsset(file: Asset) {
  stopDrive(); engineRoot = undefined; driveButton.disabled = false;
  engineWorld?.dispose(); engineWorld = undefined; viewer?.clear();
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  const request = ++sequence;
  el('filename').textContent = file.path; el('format').textContent = (isSavedVehiclePath(file.path) ? 'SDAT' : file.path.split('.').at(-1)!.toUpperCase()) + ' / ORIGINAL ASSET';
  status('Loading…'); el('details').textContent = '';
  try {
    if (/\.scx$/i.test(file.path)) { await showModel(file.path, [], request); return; }
    const bytes = await assets.read(file.path);
    if (request !== sequence) return;
    const inspector = el('inspector'); inspector.replaceChildren(); inspector.hidden = false;
    el('viewport').hidden = true; el('scene-help').hidden = true;
    if (/\.rpk$/i.test(file.path)) {
      const pack = parseRpk(bytes);
      inspector.append(textElement('h2', 'Resource tree'), textElement('p', `RPAK 0x${pack.version.toString(16)} · ${pack.entries.length} entries · ${pack.dependencies.length} dependencies`));
      const deps = document.createElement('pre'); deps.textContent = pack.dependencies.map(d => `${(d.id >>> 16).toString(16).padStart(4, '0')} → ${d.path}`).join('\n'); inspector.append(deps);
      const filter = document.createElement('input'); filter.placeholder = 'Filter by alias or ID'; inspector.append(filter);
      const table = document.createElement('div'); inspector.append(table);
      const draw = () => {
        table.replaceChildren(); const q = filter.value.toLowerCase();
        for (const entry of pack.entries.filter(e => `${e.alias} 0x${e.typeId.toString(16).padStart(8, '0')}`.toLowerCase().includes(q)).slice(0, 400)) {
          const row = document.createElement('details');
          row.append(textElement('summary', `0x${entry.typeId.toString(16).padStart(8, '0')}  ${entry.alias}  · type ${entry.type} · ${entry.size} B`));
          const props = entryProperties(entry);
          row.append(textElement('pre', props.length ? props.map(p => `${p.key} ${p.value}`).join('\n') : entry.data.length ? 'Binary payload: no decoder for this type yet.' : 'Empty payload'));
          if (props.some(p => p.key === 'native' && /^(car|part)\s/i.test(p.value))) {
            const spawn = textElement('button', 'Create in world');
            spawn.onclick = () => { void openWorld(file.path, entry.typeId); }; row.append(spawn);
          }
          if (props.some(p => ['mesh', 'render'].includes(p.key) || p.key === 'sourcefile' && /\.scx$/i.test(p.value))) {
            const button = textElement('button', 'Open linked model');
            button.onclick = async () => {
              const nextRequest = ++sequence;
              try { const target = await assets.modelForResource(file.path, entry.typeId); if (nextRequest === sequence) await showModel(target.path, target.textures, nextRequest); }
              catch (e) { el('details').textContent = String(e); status('No model', true); }
            }; row.append(button);
          }
          table.append(row);
        }
      }; filter.oninput = draw; draw();
      el('details').textContent = pack.warnings.join('\n') || 'Resource table parsed. Expand an entry to inspect its properties and open its model.';
    } else if (isSavedVehiclePath(file.path)) {
      const saved = inspectSavedVehicle(bytes), encoded = serializeSdat(saved.sdat);
      const identical = encoded.length === bytes.length && encoded.every((v, i) => v === bytes[i]);
      inspector.append(textElement('h2', saved.name ?? 'Unnamed vehicle'));
      inspector.append(textElement('p', `SDAT type ${saved.sdat.type} · Vehicle v${saved.version} · Part v${saved.partVersion}`));
      inspector.append(textElement('pre', JSON.stringify({ chassis: saved.chassis, textureId: saved.textureId, meshId: saved.meshId, wear: saved.wear, tear: saved.tear, adjustedPosition: saved.adjustedPosition, adjustedRotation: saved.adjustedRotation }, null, 2)));
      inspector.append(textElement('h3', 'Resource remount table'));
      inspector.append(textElement('pre', [...saved.sdat.packs].map(([id, path]) => `${id} → ${path}`).join('\n')));
      inspector.append(textElement('p', `${saved.sdat.unsaved.length} transient resources · ${saved.sdat.payload.length} bytes of Java data`));
      el('details').textContent = `${identical ? 'In-memory decode → encode: all bytes match.' : 'WARNING: re-encoded bytes differ.'}\nNo disk writes or calls to the original EXE. The vehicle header and container are decoded; the part tree inside the payload is not yet decoded.`;
    } else if (/\.class$/i.test(file.path)) {
      for (const cls of parseTufa(bytes)) {
        inspector.append(textElement('h2', cls.name), textElement('p', `extends ${cls.superName || '—'} · TUFA 0x${cls.version.toString(16)} · ${cls.constants.length} constants · ${cls.trees.length} trees`));
        for (const method of cls.methods) {
          const details = document.createElement('details'), tree = cls.trees[method.tree];
          details.append(textElement('summary', `${method.name}${method.signature} · ${tree?.length ?? 0} nodes · flags 0x${method.flags.toString(16)}`));
          details.append(textElement('pre', tree?.map((n, i) => `${i.toString().padStart(4)}  op=0x${n.op.toString(16).padStart(2, '0')}  source=${n.source}${n.operand === undefined ? '' : `  operand=0x${n.operand.toString(16).padStart(8, '0')}`}`).join('\n') || 'No body: native/abstract/declaration candidate. Flags need verification.'));
          inspector.append(details);
        }
      }
      el('details').textContent = 'TUFA and TREE structure decoded. Opcodes are shown without assuming their semantics. Game logic execution is not yet implemented.';
    } else {
      inspector.append(textElement('pre', new TextDecoder('windows-1252').decode(bytes)));
      el('details').textContent = `${file.size.toLocaleString('en-US')} bytes · source text, read-only`;
    }
    status('Asset decoded');
  } catch (e) {
    if (request !== sequence) return;
    el('details').textContent = String(e); status('Unsupported format', true);
  }
}

el('search').oninput = renderList;
el('filters').onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-kind]'); if (!button) return;
  kind = button.dataset.kind!; for (const b of el('filters').children) b.classList.toggle('active', b === button); renderList();
};
el<HTMLInputElement>('folder').onchange = event => {
  const files = [...((event.target as HTMLInputElement).files ?? [])]; if (!files.length) return;
  const map = new Map(files.map(f => [f.webkitRelativePath.split('/').slice(1).join('/'), f]));
  localInstallation = false;
  attach(new Assets([...map].map(([path, f]) => ({ path, size: f.size })), async p => new Uint8Array(await map.get(p)!.arrayBuffer())), 'Selected folder');
  if (assets.byPath.has('frontend.rpk')) openMainMenu();
  else status('Catalog connected');
};
void connect();
el('memory-lab').onclick = async () => {
  if (!assets) { status('No catalog', true); return; }
  const request = ++sequence;
  stopDrive(); engineRoot = undefined; driveButton.disabled = false;
  engineWorld?.dispose(); engineWorld = undefined; viewer?.clear();
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  el('viewport').hidden = true; el('scene-help').hidden = true;
  const inspector = el('inspector'); inspector.hidden = false; inspector.replaceChildren(textElement('p', 'Reading original Java methods…'));
  el('filename').textContent = 'Part.save/load · MemoryFile'; el('format').textContent = 'SOURCE RUNTIME / MEMORY STREAM'; status('Loading sources…');
  try {
    const { mountMemoryLab } = await import('./memory-lab');
    if (request !== sequence) return;
    const dispose = await mountMemoryLab(inspector, assets, () => request === sequence);
    if (request !== sequence) { dispose(); return; }
    disposeMemoryLab = dispose; status('Memory stream ready');
    el('details').textContent = 'A restricted Java interpreter executes the original source methods. Their TUFA bytecode is not executed yet. Assembly data passes through the project slot model and an in-memory stream.';
  } catch (e) { if (request === sequence) { status('Source error', true); el('details').textContent = String(e); } }
};
if (import.meta.hot) import.meta.hot.dispose(() => { sequence++; stopDrive(); engineWorld?.dispose(); disposeMemoryLab?.(); viewer?.dispose(); });
