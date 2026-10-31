import './style.css';
import { Assets, isSavedVehiclePath, type Asset } from './assets';
import { activeJavaTrack, javaDrivingControls, javaStockSelection } from './runtime/java-scene';
import { JavaGauges } from './osd/java-gauges';
import { jv } from 'slrr-jvm';
import { parseRpk, entryProperties } from './formats/rpk';
import { parseScx } from './formats/scx';
import { parseTufa } from './formats/tufa';
import { inspectSavedVehicle, serializeSdat } from './formats/sdat';
import { Viewer } from './render/viewer';
import { PartFactory, type EnginePart, type EngineWorld } from './engine/world';
import { DEFAULT_CHASSIS_CRUMPLE } from './engine/vehicle-3d';
import { Vector3 } from 'three';
import { mountMainMenu } from './osd/main-menu';
import { OsdLayer } from './osd/osd-layer';
import { OsdVideo } from './osd/osd-video';
import { MainMenuRuntime, INITIAL_MENU_STATE } from './runtime/main-menu-runtime';
import { MusicEngine, MUSIC_SET, type MusicState } from './audio/music-engine';
import { SoundJavaBridge } from './audio/sound-java';
import { gameSoundVolume, setGameSoundVolume } from './audio/audio-settings';
import { DEFAULT_TIRE_MODEL, type TireModelSettings } from './engine/tire-model';
import { bootGame, type BootEvent } from './runtime/game-boot';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><div class="brand"><span class="mark">SL / R</span><div>REDLINE <b>REBUILT</b><small>Independent engine · Research build 0.1</small></div></div><div class="header-right"><span id="connection">Connecting…</span><button id="memory-lab">Memory stream</button><label class="button">Open game folder<input id="folder" type="file" webkitdirectory multiple hidden></label></div></header>
<main><aside><div class="eyebrow">ORIGINAL ASSETS</div><h1>Under the hood.</h1><p class="intro">SLRR assets in a new environment. No original EXE required.</p><div id="counts"></div><input id="search" type="search" placeholder="Search: Baiern, chassis, GameLogic…" aria-label="Search assets"><nav id="filters"><button data-kind="scx" class="active">Models</button><button data-kind="rpk">Packages</button><button data-kind="class">Scripts</button><button data-kind="cfg">CFG</button><button data-kind="vehicle">Cars</button></nav><div id="list" role="list"></div><div id="list-count"></div></aside>
<section class="workspace"><div class="toolbar"><div><span class="eyebrow" id="format">JAVA / ENTRY POINT</span><div id="filename">Waiting for Init.java</div></div><span class="badge" id="state">Idle</span></div><div id="viewport"></div><div id="inspector" hidden></div><div class="scene-help" id="scene-help">Left drag: rotate &nbsp; · &nbsp; Wheel: zoom &nbsp; · &nbsp; Right drag: pan</div><div class="detail"><div class="eyebrow">DIAGNOSTICS</div><div id="details">Loading game catalog…</div></div></section></main><footer><span>JAVA SOURCE / WEBGL 2</span><span>Original Init.java runs first · GameLogic is under implementation</span><span id="total"></span></footer>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let assets: Assets, kind = 'scx', viewer: Viewer | undefined, sequence = 0, disposeMemoryLab: (() => void) | undefined;
let disposeJavaInput: (() => void) | undefined;
let disposeGameBoot: (() => void) | undefined;
let disposeGameOsd: (() => void) | undefined;
let disposeJavaScene: (() => void) | undefined;
let localInstallation = false;
let engineWorld: EngineWorld | undefined;
let engineRoot: EnginePart | undefined, disposeDriving: (() => void) | undefined;
let beforeDrivingDetails = '';
let disposeOsdMenu: (() => void) | undefined;
let music: MusicEngine | undefined, disconnectMusic: (() => void) | undefined;
const javaConsole = document.createElement('section');
javaConsole.className = 'java-console';
javaConsole.innerHTML = '<div class="java-console-heading"><strong>JAVA CONSOLE</strong><span id="java-run-state">Waiting for game files</span><button id="java-retry" type="button">Restart Java</button></div><div id="java-log" role="log" aria-live="polite"></div>';
el('viewport').parentElement!.append(javaConsole);
el<HTMLButtonElement>('java-retry').onclick = () => { void runGameBoot(); };
function appendJavaEvent(event: BootEvent) {
  const line = document.createElement('div'); line.className = `java-log-${event.level}`;
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  line.textContent = `[${time}] ${event.level.toUpperCase()}  ${event.message}`;
  el('java-log').append(line);
  el('java-log').scrollTop = el('java-log').scrollHeight;
}
async function runGameBoot() {
  if (!assets) return;
  disposeJavaScene?.(); disposeJavaScene = undefined;
  driveHud.hidden = true; driveHud.classList.remove('crash-hud');
  disposeJavaInput?.(); disposeJavaInput = undefined;
  disposeGameBoot?.(); disposeGameBoot = undefined;
  disposeGameOsd?.(); disposeGameOsd = undefined;
  viewer?.clear();
  const source = assets, run = sequence;
  const gameOsd = new OsdLayer(el('viewport'), source);
  gameOsd.root.classList.add('osd-layer-game');
  const gameVideo = new OsdVideo(gameOsd, source, localInstallation);
  disposeGameOsd = () => gameOsd.dispose();
  el('java-log').replaceChildren();
  el('java-run-state').textContent = 'Running Init.java';
  el<HTMLButtonElement>('java-retry').disabled = true;
  const result = await bootGame(source, event => { if (source === assets && run === sequence) appendJavaEvent(event); },
    () => gameOsd.getViewportSize(),
    node => {
      if (source !== assets || run !== sequence || !viewer) return;
      void viewer.upsertJavaRenderObject(node, source).catch(reason => {
        if (source === assets && run === sequence)
          appendJavaEvent({ level: 'error', message: `Java RenderRef ${node.alias}: ${reason instanceof Error ? reason.message : String(reason)}` });
      });
    },
    gameOsd, music ? new SoundJavaBridge(music) : undefined, undefined, gameVideo,
    settings => { if (source === assets && run === sequence) viewer?.setMapFog(settings); },
    settings => { if (source === assets && run === sequence) viewer?.setSceneLight(settings); },
    texture => source === assets && run === sequence ? viewer?.setGlobalEnvmap(texture) : undefined,
    flare => source === assets && run === sequence ? viewer?.setSceneFlare(flare) : undefined);
  if (source !== assets || run !== sequence) { result.dispose(); gameOsd.dispose(); return; }
  disposeGameBoot = () => result.dispose();
  const detachKeyboard = result.input.attachBrowserKeyboard(window);
  const poll = window.setInterval(() => {
    try { result.input.pollCooperative(); }
    catch (reason) {
      window.clearInterval(poll);
      appendJavaEvent({ level: 'error', message: `Java input: ${reason instanceof Error ? reason.message : String(reason)}` });
    }
  }, 50);
  disposeJavaInput = () => { detachKeyboard(); window.clearInterval(poll); };
  el<HTMLButtonElement>('java-retry').disabled = false;
  el('java-run-state').textContent = result.error ? 'Blocked at Java call' : 'Init.java completed';
  el('details').textContent = result.error
    ? 'Java initialization stopped at the call shown in the console.'
    : 'Init.java completed. Render resource warnings are handled separately from Java execution.';
  status(result.error ? 'Java boot blocked' : 'Java boot ready', !!result.error);
  if (result.error) {
    const location = /\n([^\n]+\.java):(\d+)\n>/.exec(result.error.message);
    el('filename').textContent = location ? `${location[1]}:${location[2]}` : 'Init.java';
    el('format').textContent = 'JAVA / ERROR';
    el('details').textContent = result.error.message;
  } else if (viewer) {
    const javaControls = javaDrivingControls(result);
    let animating = false, animateFailed = false, loadingTrack = false;
    let loadedTrackKey = '', activeTrackCleanup: (() => void) | undefined;
    let pendingTrackKey = '', pendingCarPose = '', pendingTrackSince = 0;
    const animationTimer = window.setInterval(() => {
      if (animating || animateFailed) return;
      const state = result.jvm.get(jv('class', 'java.game.GameLogic'), 'actualState');
      if (state.value == null || !result.gameTypes.hasCallback(state, 28)) return;
      animating = true;
      void result.jvm.invokeAsync(state, 'animate').catch(reason => {
        animateFailed = true;
        appendJavaEvent({ level: 'error', message: `Java animate: ${reason instanceof Error ? reason.message : String(reason)}` });
      }).finally(() => { animating = false; });
    }, 50);
    const unlockMusic = () => { if (music?.snapshot().blocked) void music.resume(); };
    window.addEventListener('pointerdown', unlockMusic);
    window.addEventListener('keydown', unlockMusic);

    const loadSelectedTrack = async (selected: NonNullable<ReturnType<typeof activeJavaTrack>>) => {
      const stopPrevious = activeTrackCleanup;
      activeTrackCleanup = undefined;
      stopPrevious?.();
      let built: Awaited<ReturnType<PartFactory['stock']>> | undefined;
      let session: ReturnType<Viewer['drive']> | undefined, gauges: JavaGauges | null = null;
      try {
        status('Loading Java track…');
        if (selected.chassis && source.byPath.has(selected.chassis.pack)) {
          try {
            const selection = await javaStockSelection(result, source, selected.chassis.pack);
            built = await new PartFactory(source).stock(selected.chassis, { mechanical: true, javaSelection: selection });
            if (source !== assets || run !== sequence) { built.world.dispose(); return; }
            await viewer!.showWorld(built.world, source, true);
          } catch (reason) {
            built?.world.dispose(); built = undefined;
            appendJavaEvent({ level: 'error', message: `Java car rendering: ${reason instanceof Error ? reason.message : String(reason)}` });
          }
        }
        const map = await viewer!.showMap(selected.mapPack, source, (done, total) => {
          if (source === assets && run === sequence) status(`Java track ${done}/${total}`);
        }, true);
        if (source !== assets || run !== sequence) { built?.world.dispose(); return; }
        if (map.loaded === 0) throw new Error(`No map geometry loaded from ${selected.mapPack}: ${map.warnings.slice(0, 3).join('; ')}`);
        if (built) {
          gauges = selected.chassis ? new JavaGauges(gameOsd, selected.chassis.pack, built.root.definition.config) : null;
          const point = selected.carPose ?? selected.start ?? (selected.mapPack === 'maps/test_track.rpk'
            ? { x: 0, y: 0, z: -1461.785, yaw: Math.PI } : { x: 0, y: 0, z: 0, yaw: 0 });
          const ground = map.terrain.height(point.x, point.z);
          const wheelSlots = built.root.definition.config.slots.filter(slot => slot.type !== undefined && slot.type >= 101 && slot.type <= 104);
          const lowestTireBottom = Math.min(...wheelSlots.map(slot => {
            const index = slot.type! - 101, wheel = built!.root.definition.config.wheels[index], tyre = built!.world.wheelRefs[index];
            const radius = (wheel?.radius ?? 0) * (tyre ? tyre.radius / 0.32865 : 1);
            return new Vector3().setFromMatrixPosition(built!.root.slotFrame(slot)).y - radius;
          }));
          // Track start Y is the chassis origin, not the tire contact plane. Place
          // each car from its own CFG wheel slots/radii so the tires start at the
          // road instead of burying a low chassis origin and letting collision
          // correction launch the suspension into its upper travel.
          const tireClearance = wheelSlots.length === 4 && Number.isFinite(ground) && Number.isFinite(lowestTireBottom)
            ? ground - lowestTireBottom + 0.02 : point.y;
          const start = new Vector3(point.x, Number.isFinite(ground) ? Math.max(point.y, tireClearance) : point.y, point.z);
          try {
            const player = result.jvm.get(jv('class', 'java.game.GameLogic'), 'player');
            const car = result.jvm.get(player, 'car');
            const javaVehicle = result.gameTypes.get(car);
            session = viewer!.drive(built.root, () => {}, true,
              { terrain: map.terrain, collision: map.collision, position: start, yaw: point.yaw }, source, music,
              { ...javaControls, instruments: (speed, rpm, gear, damage, engineCondition, transmissionCondition) => gauges?.update(speed, rpm, gear, damage, engineCondition, transmissionCondition),
                motion: (position, yaw, velocity) => {
                  javaVehicle?.setState(
                    { x: position.x, y: position.y, z: position.z }, { y: yaw, p: 0, r: 0 },
                    { x: velocity.x, y: velocity.y, z: velocity.z }, { x: 0, y: 0, z: 0 });
                  result.gameTypes.updateTriggerContacts(car);
                } });
            showMapDebugControls(map);
            showVehicleDebug(built.root, session);
            driveHud.hidden = true;
            el('scene-help').textContent = 'Controls follow the game ControlSet · Right drag: rotate camera';
          } catch (reason) {
            gauges?.dispose(); gauges = null;
            appendJavaEvent({ level: 'error', message: `Java car simulation: ${reason instanceof Error ? reason.message : String(reason)}` });
          }
        }
        activeTrackCleanup = () => { clearVehicleDebug(); session?.(); gauges?.dispose(); built?.world.dispose(); };
        el('filename').textContent = selected.mapPack;
        el('format').textContent = 'JAVA / TRACK';
        el('details').textContent = `${map.loaded} map models · ${map.objects} placed objects · Java selected ${selected.chassis?.pack ?? 'no car'}`;
        status('Java track loaded');
      } catch (reason) {
        built?.world.dispose();
        appendJavaEvent({ level: 'error', message: `Java scene rendering: ${reason instanceof Error ? reason.message : String(reason)}` });
        status('Java scene unavailable', true);
      }
    };

    const checkActiveTrack = () => {
      const selected = activeJavaTrack(result);
      if (!selected || !source.byPath.has(selected.mapPack)) {
        loadedTrackKey = '';
        pendingTrackKey = '';
        return;
      }
      const javaStart = selected.start
        ? `${selected.start.x.toFixed(3)},${selected.start.y.toFixed(3)},${selected.start.z.toFixed(3)},${selected.start.yaw.toFixed(3)}` : '';
      const key = `${selected.mapPack}|${selected.chassis?.pack ?? ''}|${selected.chassis?.id ?? ''}|${javaStart}`;
      if (key === loadedTrackKey || loadingTrack) return;
      // GameLogic.actualState changes before Track.enter() finishes. Wait until
      // Java has attached the car to this map and its scripted pose has settled;
      // otherwise host physics can start from a half-transition state.
      if (!selected.ready || !selected.carPose) { pendingTrackKey = ''; return; }
      const pose = [selected.carPose.x, selected.carPose.y, selected.carPose.z, selected.carPose.yaw]
        .map(value => value.toFixed(3)).join(',');
      if (pendingTrackKey !== key || pendingCarPose !== pose) {
        pendingTrackKey = key; pendingCarPose = pose; pendingTrackSince = performance.now(); return;
      }
      if (performance.now() - pendingTrackSince < 450) return;
      loadingTrack = true;
      loadedTrackKey = key;
      void loadSelectedTrack(selected).finally(() => { loadingTrack = false; });
    };
    const trackPoll = window.setInterval(checkActiveTrack, 150);
    disposeJavaScene = () => {
      window.clearInterval(animationTimer);
      window.clearInterval(trackPoll);
      window.removeEventListener('pointerdown', unlockMusic);
      window.removeEventListener('keydown', unlockMusic);
      activeTrackCleanup?.();
      activeTrackCleanup = undefined;
    };
    checkActiveTrack();
  }
}
const menuButton = textElement('button', 'Main menu');
el('memory-lab').before(menuButton);
menuButton.onclick = () => openMainMenu();
const worldButton = textElement('button', 'Assemble Baiern');
const mapButton = textElement('button', 'Test Track');
const trackDriveButton = textElement('button', 'Drive Test Track');
const viewportExpandButton = textElement('button', 'Expand view', 'viewport-expand-button');
el('viewport').append(viewportExpandButton);
const viewportCollapseButton = textElement('button', 'Minimize view · Esc', 'viewport-window-button');
viewportCollapseButton.hidden = true; el('viewport').after(viewportCollapseButton);
let trackDriving = false;
function setViewportExpanded(expanded: boolean) {
  el('viewport').parentElement?.classList.toggle('viewport-expanded', expanded);
  document.body.classList.toggle('viewport-expanded', expanded);
  viewportExpandButton.hidden = expanded;
  viewportCollapseButton.hidden = !expanded;
  trackDriveButton.textContent = trackDriving ? 'Expand drive view' : 'Drive Test Track';
  if (expanded && trackDriving) el('viewport').querySelector('canvas')?.focus({ preventScroll: true });
}
viewportExpandButton.onclick = () => setViewportExpanded(true);
viewportCollapseButton.onclick = () => setViewportExpanded(false);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !viewportCollapseButton.hidden) {
    event.preventDefault(); event.stopImmediatePropagation(); setViewportExpanded(false);
  }
});
const driveButton = textElement('button', 'Test drive') as HTMLButtonElement;
const hoodButton = textElement('button', 'Hood impact test'); hoodButton.className = 'hood-button'; el('counts').before(hoodButton);
const crashButton = textElement('button', 'Car and obstacle'); crashButton.className = 'hood-button'; hoodButton.after(crashButton);
const crashControls = textElement('div', '', 'hood-controls'); crashControls.hidden = true; el('scene-help').before(crashControls);
const mapDebugPanel = document.createElement('details'); mapDebugPanel.className = 'map-debug-panel'; mapDebugPanel.hidden = true;
mapDebugPanel.append(textElement('summary', 'Map collision frames'));
const mapDebugData = textElement('pre', '', 'map-debug-data'); mapDebugPanel.append(mapDebugData);
const mapDebugOptions = textElement('div', '', 'map-debug-options');
const mapDebugChecks: HTMLInputElement[] = [];
for (const [layer, title] of [['terrain', 'Support surfaces'], ['walls', 'Side faces'], ['boxes', 'CFG boxes']] as const) {
  const label = textElement('label', title), input = document.createElement('input'); input.type = 'checkbox';
  input.onchange = () => viewer?.showMapDebug(layer, input.checked);
  label.prepend(input); mapDebugOptions.append(label); mapDebugChecks.push(input);
}
const vehicleFramesLabel = textElement('label', 'Vehicle part bounds (AABB)'), vehicleFramesCheck = document.createElement('input');
vehicleFramesCheck.type = 'checkbox'; vehicleFramesLabel.prepend(vehicleFramesCheck); mapDebugOptions.append(vehicleFramesLabel);
const bodyVisibleLabel = textElement('label', 'Show body shell'), bodyVisibleCheck = document.createElement('input');
bodyVisibleCheck.type = 'checkbox'; bodyVisibleCheck.checked = true; bodyVisibleLabel.prepend(bodyVisibleCheck); mapDebugOptions.append(bodyVisibleLabel);
mapDebugPanel.append(mapDebugOptions); el('scene-help').before(mapDebugPanel);
let mapDebugSession: ReturnType<Viewer['drive']> | undefined;
vehicleFramesCheck.onchange = () => mapDebugSession?.vehicleFrames(vehicleFramesCheck.checked);
bodyVisibleCheck.onchange = () => mapDebugSession?.bodyVisible(bodyVisibleCheck.checked);
const showMapDebugControls = (map?: { terrain: { faces: number }; collision: { walls: number; boxes: number } }) => {
  mapDebugPanel.hidden = false; mapDebugPanel.open = false;
  for (const input of mapDebugChecks) input.checked = false;
  vehicleFramesCheck.checked = false; bodyVisibleCheck.checked = true;
  if (map) mapDebugData.textContent = `Support triangles: ${map.terrain.faces.toLocaleString()}\nCollision walls: ${map.collision.walls.toLocaleString()}\nCFG collision boxes: ${map.collision.boxes.toLocaleString()}`;
};
const vehicleDebugPanel = document.createElement('details'); vehicleDebugPanel.className = 'vehicle-debug-panel'; vehicleDebugPanel.hidden = true;
vehicleDebugPanel.append(textElement('summary', 'Vehicle runtime · physics / Java'));
const vehicleTeleportButton = textElement('button', 'Move car to (0, 1, 0)');
vehicleTeleportButton.title = 'Teleport the car to the city center and reset its motion';
vehicleTeleportButton.onclick = () => mapDebugSession?.teleport(new Vector3(0, 1, 0), 0);
vehicleDebugPanel.append(vehicleTeleportButton);
const vehicleDebugTelemetry = textElement('pre', '', 'vehicle-debug-telemetry'), vehicleDebugTree = textElement('pre', '', 'vehicle-debug-tree');
vehicleDebugPanel.append(vehicleDebugTelemetry, vehicleDebugTree); el('scene-help').before(vehicleDebugPanel);
let vehicleDebugTimer: number | undefined;
function showVehicleDebug(root: EnginePart, session: ReturnType<Viewer['drive']>) {
  clearVehicleDebug(); mapDebugSession = session; vehicleDebugPanel.hidden = false; vehicleDebugPanel.open = true;
  const tree = (part: EnginePart, depth = 0): string[] => {
    const prefix = depth === 0 ? '' : `${'  '.repeat(depth - 1)}├─ `;
    const slot = part.parentSlot === undefined ? 'root' : `slot ${part.parentSlot}`;
    const row = `${prefix}${part.definition.alias} [0x${part.definition.key.id.toString(16)}] · ${slot} · wear ${Math.round(part.condition * 100)}%`;
    return [row, ...[...part.children.values()].flatMap(child => tree(child, depth + 1))];
  };
  const refresh = () => {
    const state = session.diagnostics();
    vehicleDebugTelemetry.textContent = [
      `Speed ${state.speedKmh} km/h · RPM ${state.rpm} · gear ${state.gear < 0 ? 'R' : state.gear || 'N'}`,
      `Engine ${state.engineRunning ? `${Math.round(state.enginePower * 100)}%` : 'stalled'} · boost ${state.boost.toFixed(2)} bar · slip ${Math.round(state.wheelSlip * 100)}%`,
      `Wheels on ground ${state.wheelContacts}/4 · chassis ${state.chassis}% · block ${state.engineBlock}% · transmission avg ${state.transmission}% · parts ${state.parts.length}`,
    ].join('\n');
    vehicleDebugTree.textContent = tree(root).join('\n');
  };
  refresh(); vehicleDebugTimer = window.setInterval(refresh, 200);
}
function clearVehicleDebug() {
  if (vehicleDebugTimer !== undefined) window.clearInterval(vehicleDebugTimer);
  vehicleDebugTimer = undefined; mapDebugSession = undefined; vehicleDebugPanel.hidden = true; vehicleDebugPanel.open = false;
}
let crashSession: ReturnType<Viewer['drive']> | undefined;
const tirePanel = document.createElement('details'); tirePanel.className = 'tire-tuning-panel'; tirePanel.hidden = true;
tirePanel.append(textElement('summary', 'Tire model · Pacejka'));
const tireControls = textElement('div', '', 'tire-tuning-controls'); tirePanel.append(tireControls); el('scene-help').before(tirePanel);
const tireSettings: TireModelSettings = structuredClone(DEFAULT_TIRE_MODEL);
const tireStorageKey = 'slrr.tire-model.v1';
let storedTires: Partial<TireModelSettings> | undefined;
try { storedTires = JSON.parse(localStorage.getItem(tireStorageKey) ?? 'null') ?? undefined; } catch { /* Ignore invalid saved tuning. */ }
if (storedTires?.model === 'legacy') tireSettings.model = 'legacy';
const modelLabel = textElement('label', 'Magic Formula (Pacejka)'), modelCheck = document.createElement('input');
modelCheck.type = 'checkbox'; modelCheck.checked = tireSettings.model === 'pacejka'; modelLabel.prepend(modelCheck); tireControls.append(modelLabel);
const tireSliders: { input: HTMLInputElement; output: HTMLOutputElement; axis: 'longitudinal' | 'lateral'; parameter: 'B' | 'C' | 'D' | 'E' }[] = [];
const updateTireModel = () => { tireSettings.model = modelCheck.checked ? 'pacejka' : 'legacy'; tirePanel.querySelector('summary')!.textContent = `Tire model · ${modelCheck.checked ? 'Pacejka' : 'legacy'}`; try { localStorage.setItem(tireStorageKey, JSON.stringify(tireSettings)); } catch { /* Live tuning still works without storage. */ } crashSession?.tireModel(tireSettings); };
modelCheck.onchange = updateTireModel;
for (const [axis, title] of [['longitudinal', 'Longitudinal grip'], ['lateral', 'Lateral grip']] as const) {
  tireControls.append(textElement('strong', title));
  for (const [parameter, label, min, max, step, hint] of [
    ['B', 'B · stiffness', 2, axis === 'lateral' ? 40 : 30, 0.5, 'How quickly grip rises with slip'],
    ['C', 'C · curve shape', 1, 2.5, 0.05, 'Shape near and after the grip peak'],
    ['D', 'D · peak grip', 0.3, 2, 0.05, 'Peak force relative to wheel load'],
    ['E', 'E · falloff', -2, 2, 0.05, 'Curvature beyond the initial rise'],
  ] as const) {
    const row = textElement('label', label), input = document.createElement('input'), output = document.createElement('output');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    const saved = storedTires?.[axis]?.[parameter];
    if (typeof saved === 'number' && Number.isFinite(saved) && saved >= min && saved <= max) tireSettings[axis][parameter] = saved;
    input.value = String(tireSettings[axis][parameter]); input.title = hint; input.setAttribute('aria-label', `${title}: ${label}`);
    output.value = Number(input.value).toFixed(2);
    input.oninput = () => { tireSettings[axis][parameter] = Number(input.value); output.value = Number(input.value).toFixed(2); updateTireModel(); };
    row.append(input, output); tireControls.append(row); tireSliders.push({ input, output, axis, parameter });
  }
}
const resetTires = textElement('button', 'Reset tire parameters');
resetTires.onclick = () => { Object.assign(tireSettings, structuredClone(DEFAULT_TIRE_MODEL)); modelCheck.checked = true; for (const { input, output, axis, parameter } of tireSliders) { input.value = String(tireSettings[axis][parameter]); output.value = Number(input.value).toFixed(2); } updateTireModel(); };
const copyTires = textElement('button', 'Copy parameters');
copyTires.onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(tireSettings, null, 2)); copyTires.textContent = 'Copied'; } catch { copyTires.textContent = 'Copy unavailable'; } setTimeout(() => { copyTires.textContent = 'Copy parameters'; }, 1800); };
tireControls.append(resetTires, copyTires);
const showTireControls = () => { tirePanel.hidden = false; tirePanel.open = false; updateTireModel(); };
const enginePanel = document.createElement('details'); enginePanel.className = 'engine-tuning-panel'; enginePanel.hidden = true;
enginePanel.append(textElement('summary', 'Engine tuning'));
const engineControls = textElement('div', '', 'engine-tuning-controls'); enginePanel.append(engineControls); el('scene-help').before(enginePanel);
const engineTuning = { idle: 900, redline: 6500 };
const engineSliders = {} as Record<'idle' | 'redline', { input: HTMLInputElement; output: HTMLOutputElement }>;
let engineStorageKey = '';
const applyEngineTuning = () => { crashSession?.engineTuning(engineTuning.idle, engineTuning.redline); try { localStorage.setItem(engineStorageKey, JSON.stringify(engineTuning)); } catch { /* Live tuning still works without storage. */ } };
for (const [key, title, min, max, step] of [['idle', 'Idle', 150, 2500, 50], ['redline', 'Redline', 3000, 12000, 250]] as const) {
  const row = textElement('label', title), input = document.createElement('input'), output = document.createElement('output');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
  input.setAttribute('aria-label', `${title} RPM`);
  input.oninput = () => { engineTuning[key] = Number(input.value); output.value = `${input.value} RPM`; applyEngineTuning(); };
  row.append(input, output); engineControls.append(row); engineSliders[key] = { input, output };
}
engineControls.append(textElement('small', 'A low idle may stall the engine. Press I to restart (N or Shift for manual).'));
const resetEngineTuning = textElement('button', 'Reset engine tuning');
resetEngineTuning.onclick = () => { const block = engineRoot && [...engineRoot.world.parts.values()].find(part => !!part.definition.mechanics?.values.cylinders); engineTuning.idle = block?.definition.mechanics?.values.rpm_idle ?? 900; engineTuning.redline = block?.definition.mechanics?.values.RPM_limit ?? 6500; for (const [key, control] of Object.entries(engineSliders) as ['idle' | 'redline', { input: HTMLInputElement; output: HTMLOutputElement }][]) { control.input.value = String(engineTuning[key]); control.output.value = `${control.input.value} RPM`; } applyEngineTuning(); };
engineControls.append(resetEngineTuning);
const showEngineControls = (root: EnginePart) => {
  const block = [...root.world.parts.values()].find(part => !!part.definition.mechanics?.values.cylinders);
  engineTuning.idle = block?.definition.mechanics?.values.rpm_idle ?? 900;
  engineTuning.redline = block?.definition.mechanics?.values.RPM_limit ?? 6500;
  engineStorageKey = `slrr.engine-tuning.${root.definition.key.pack}:${root.definition.key.id}.v1`;
  try {
    const saved = JSON.parse(localStorage.getItem(engineStorageKey) ?? 'null');
    if (Number.isFinite(saved?.idle) && saved.idle >= 150 && saved.idle <= 2500) engineTuning.idle = saved.idle;
    if (Number.isFinite(saved?.redline) && saved.redline >= 3000 && saved.redline <= 12000) engineTuning.redline = saved.redline;
  } catch { /* Use the installed block's values. */ }
  for (const [key, control] of Object.entries(engineSliders) as ['idle' | 'redline', { input: HTMLInputElement; output: HTMLOutputElement }][]) { control.input.value = String(engineTuning[key]); control.output.value = `${control.input.value} RPM`; }
  enginePanel.hidden = false; enginePanel.open = false; applyEngineTuning();
};
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
const musicPanel = document.createElement('details'); musicPanel.className = 'music-panel'; musicPanel.hidden = true;
const musicSummary = textElement('summary', 'Music'); musicPanel.append(musicSummary);
const musicTitle = textElement('strong', 'No track'), musicArtist = textElement('span', ''), musicPosition = textElement('span', '0:00 / 0:00');
const musicButtons = textElement('div', '', 'music-buttons');
const previousSong = textElement('button', 'Previous'), playSong = textElement('button', 'Play'), nextSong = textElement('button', 'Next');
previousSong.onclick = () => music?.prevTrack();
playSong.onclick = () => { if (!music) return; if (!music.snapshot().track) music.changeMusicSet(MUSIC_SET.MENU); else if (music.snapshot().playing) music.pause(); else void music.resume(); };
nextSong.onclick = () => music?.nextTrack(); musicButtons.append(previousSong, playSong, nextSong);
const musicSeek = document.createElement('input'); musicSeek.type = 'range'; musicSeek.min = '0'; musicSeek.max = '1'; musicSeek.step = '0.1'; musicSeek.setAttribute('aria-label', 'Track position');
musicSeek.onchange = () => music?.seek(Number(musicSeek.value));
const musicVolume = document.createElement('input'); musicVolume.type = 'range'; musicVolume.min = '0'; musicVolume.max = '1'; musicVolume.step = '0.01'; musicVolume.setAttribute('aria-label', 'Music volume');
musicVolume.oninput = () => music?.setVolume(1, Number(musicVolume.value));
const musicVolumeLabel = textElement('label', 'Volume'); musicVolumeLabel.append(musicVolume);
const gameVolume = document.createElement('input'); gameVolume.type = 'range'; gameVolume.min = '0'; gameVolume.max = '1'; gameVolume.step = '0.01'; gameVolume.value = String(gameSoundVolume); gameVolume.setAttribute('aria-label', 'Game sound volume');
gameVolume.oninput = () => setGameSoundVolume(Number(gameVolume.value));
const gameVolumeLabel = textElement('label', 'Game sounds'); gameVolumeLabel.append(gameVolume);
musicPanel.append(musicTitle, musicArtist, musicButtons, musicSeek, musicPosition, musicVolumeLabel, gameVolumeLabel); document.body.append(musicPanel);
const musicTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
function showMusicState(state: MusicState) {
  musicSummary.textContent = state.blocked ? 'Music · press Play' : state.track ? `Music · ${state.track.title}` : 'Music';
  musicTitle.textContent = state.track?.title ?? 'No track'; musicArtist.textContent = state.track?.artist ?? state.track?.path ?? '';
  musicSeek.max = String(Math.max(1, state.durationSeconds ?? 1)); musicSeek.value = String(Math.min(state.positionSeconds, Number(musicSeek.max)));
  musicSeek.disabled = !state.track || state.durationSeconds === null;
  musicPosition.textContent = `${musicTime(state.positionSeconds)} / ${state.durationSeconds === null ? '?:??' : musicTime(state.durationSeconds)}`;
  musicVolume.value = String(state.volume); playSong.textContent = state.playing ? 'Pause' : 'Play';
  playSong.title = state.blocked ? 'Browser requires a click before music can play' : state.error ?? '';
}
el('memory-lab').before(worldButton, driveButton, mapButton, trackDriveButton);
trackDriveButton.onclick = async () => {
  if (trackDriving) { setViewportExpanded(true); return; }
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
    showMapDebugControls(map);
    music?.changeMusicSet(MUSIC_SET.DRIVING);
    const start = new Vector3(0, map.terrain.height(0, -1461.785) + 0.15, -1461.785);
    if (start.y < -100) throw new Error('No track surface at the start line');
    beforeDrivingDetails = el('details').textContent ?? '';
    crashSession = viewer.drive(engineRoot, text => { driveHud.textContent = text; }, true, { terrain: map.terrain, collision: map.collision, position: start, yaw: Math.PI }, assets, music);
    crashSession.chassisCrumple(Number(crumpleSlider.value));
    showTireControls();
    showEngineControls(engineRoot);
    showVehicleDebug(engineRoot, crashSession);
    disposeDriving = () => { clearVehicleDebug(); crashSession?.(); }; driveHud.hidden = false; driveHud.classList.add('crash-hud');
    trackDriving = true; setViewportExpanded(true);
    el('viewport').parentElement?.classList.add('physics-scene');
    el('filename').textContent = 'Test Track · driving'; el('format').textContent = 'MAP / PHYSICS';
    el('scene-help').textContent = 'Start in neutral: E first gear, Q reverse, N neutral · W/S throttle/reverse · A/D steer · Space brake · Shift clutch · I restart engine · R reset to start';
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
    showMapDebugControls(result);
    el('details').textContent = `${result.loaded}/${result.total} models · ${result.objects} placed RDB/CFG objects · ${result.triangles.toLocaleString('en-US')} map triangles. Geometry and textures come from the original RPK/SCX; objects use RDB coordinates. Road collision is still approximate.\n${result.warnings.slice(0, 12).join('\n')}`;
    status(result.loaded ? 'Track loaded' : 'No geometry', !result.loaded);
  } catch (error) { if (request === sequence) { viewer.clear(); status('Map error', true); el('details').textContent = String(error); } }
};
function stopDrive() {
  disposeJavaScene?.(); disposeJavaScene = undefined;
  const wasTrackDriving = trackDriving;
  disposeOsdMenu?.(); disposeOsdMenu = undefined;
  trackDriving = false; setViewportExpanded(false);
  el('viewport').parentElement?.classList.remove('physics-scene');
  mapDebugPanel.hidden = true;
  tirePanel.hidden = true;
  enginePanel.hidden = true;
  crashSession = undefined; crashControls.hidden = true; driveHud.classList.remove('crash-hud');
  clearVehicleDebug();
  hood?.dispose(); hood = undefined; hoodControls.hidden = true;
  if (disposeDriving) el('details').textContent = beforeDrivingDetails;
  disposeDriving?.(); disposeDriving = undefined; driveHud.hidden = true; driveButton.textContent = 'Test drive';
  el('scene-help').textContent = 'Left drag: rotate · Wheel: zoom · Right drag: pan';
  if (wasTrackDriving) music?.changeMusicSet(MUSIC_SET.NONE);
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
    const runtime = new MainMenuRuntime(source, INITIAL_MENU_STATE, music ? new SoundJavaBridge(music) : undefined), built = runtime.enter();
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
    crashSession = viewer.drive(engineRoot, text => { driveHud.textContent = text; }, true, undefined, assets, music);
    showVehicleDebug(engineRoot, crashSession); disposeDriving = () => { clearVehicleDebug(); crashSession?.(); };
    crashSession.chassisCrumple(Number(crumpleSlider.value));
    showTireControls();
    showEngineControls(engineRoot);
    el('viewport').parentElement?.classList.add('physics-scene');
    slow.checked = false; pause.checked = false; crashSession.slowMotion(false);
    crashControls.hidden = false; crashCage.checked = false; internals.checked = false; driveHud.hidden = false; driveHud.classList.add('crash-hud'); driveButton.textContent = 'End drive';
    el('scene-help').textContent = 'Start in neutral: E first gear, Q reverse, N neutral · W/S throttle/reverse · A/D steer · Space brake · Shift clutch · I restart engine · R restore car';
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
    const session = viewer.drive(engineRoot, text => { driveHud.textContent = text; });
    showVehicleDebug(engineRoot, session); disposeDriving = () => { clearVehicleDebug(); session(); };
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
    }), 'Local installation', true);
    await runGameBoot();
  } catch (e) {
    el('connection').textContent = 'Select game folder';
    el('details').textContent = `Game catalog unavailable. Select an installed game with Open game folder. ${e}`;
    status('No catalog', true);
  }
}

function attach(source: Assets, label: string, local = false) {
  disposeJavaScene?.(); disposeJavaScene = undefined;
  disposeJavaInput?.(); disposeJavaInput = undefined;
  disposeGameBoot?.(); disposeGameBoot = undefined;
  disposeGameOsd?.(); disposeGameOsd = undefined;
  stopDrive(); engineRoot = undefined; engineWorld?.dispose(); engineWorld = undefined; viewer?.clear(); sequence++;
  driveButton.disabled = false;
  assets = source; localInstallation = local; el('connection').textContent = label;
  disconnectMusic?.(); music?.dispose();
  music = new MusicEngine(source, local);
  disconnectMusic = music.onState(showMusicState);
  musicPanel.hidden = !source.files.some(file => file.path.replaceAll('\\', '/').toLowerCase().startsWith('music/'));
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
  attach(new Assets([...map].map(([path, f]) => ({ path, size: f.size })), async p => new Uint8Array(await map.get(p)!.arrayBuffer())), 'Selected folder', false);
  void runGameBoot();
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
if (import.meta.hot) import.meta.hot.dispose(() => { sequence++; stopDrive(); engineWorld?.dispose(); disposeMemoryLab?.(); viewer?.dispose(); disconnectMusic?.(); music?.dispose(); });
