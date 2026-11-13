import {NavigatorView} from './render/navigator-view';
import type {NavigatorMode,NavigatorNative} from './runtime/navigator-native';
import {DEFAULT_DRIVING_HELPING,type DrivingHelping} from './engine/driving-helping';
import {parseScxAsync} from './formats/scx-worker-client';
import './style.css';
import { Assets, isSavedVehiclePath, type Asset } from './assets';
import { activeJavaTrack, javaDrivingControls, javaStockSelection, javaTrackIsCurrent } from './runtime/java-scene';
import { javaSceneCamera } from './runtime/java-scene-camera';
import { JavaSceneVehicles } from './render/java-vehicles';
import { JavaPartPreviews } from './render/java-part-previews';
import { JavaMouse } from './render/java-mouse';
import { JavaGauges } from './osd/java-gauges';
import { jv } from 'slrr-jvm';
import {RenderObject} from './runtime/render-object';
import { replaceGarageCarTree } from './runtime/debug-garage-car';
import { parseRpk, entryProperties } from './formats/rpk';

import { parseTufa } from './formats/tufa';
import { inspectSavedVehicle, serializeSdat } from './formats/sdat';
import { Viewer } from './render/viewer';
import { defaultSuspensionDebug, type SuspensionDebugSettings } from './render/suspension-debug';
import { PartFactory, type EnginePart, type EngineWorld } from './engine/world';
import { DEFAULT_CHASSIS_CRUMPLE } from './engine/vehicle-3d';
import {parseRouteBenchmark,restoreRouteVehicle,type RouteBenchmark,type RouteMode} from './engine/route-benchmark';
import { Vector3 } from 'three';
import type {SkinnedCharacter} from './render/skinned-character';
import {loadCharacterCatalog,skeletonCompatibility} from './render/character-catalog';
import { mountMainMenu } from './osd/main-menu';
import { OsdLayer } from './osd/osd-layer';
import { OsdVideo } from './osd/osd-video';
import { MainMenuRuntime, INITIAL_MENU_STATE } from './runtime/main-menu-runtime';
import { MusicEngine, MUSIC_SET, type MusicState } from './audio/music-engine';
import { SoundJavaBridge } from './audio/sound-java';
import { gameSoundVolume, setGameSoundVolume } from './audio/audio-settings';
import { DEFAULT_TIRE_MODEL, type TireModelSettings } from './engine/tire-model';
import { bootGame, type BootEvent } from './runtime/game-boot';
import { initializeSoftBodyWasm, softBodyRuntime, type SoftBodyBackend } from './engine/soft-body-wasm';

const softBodyReady = initializeSoftBodyWasm();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><div class="brand"><span class="mark">SL / R</span><div>REDLINE <b>REBUILT</b><small>Open-source WebGL remaster · Development build 0.1</small></div></div><div class="header-right"><span id="connection">Connecting…</span><button id="memory-lab">Memory stream</button><label class="button">Open game folder<input id="folder" type="file" webkitdirectory multiple hidden></label></div></header>
<main><aside><div class="eyebrow">ORIGINAL ASSETS</div><h1>Under the hood.</h1><p class="intro">An open-source engine remaster of Street Legal Racing: Redline, rebuilt for the browser with WebGL 2.</p><div id="counts"></div><input id="search" type="search" placeholder="Search: Baiern, chassis, GameLogic…" aria-label="Search assets"><nav id="filters"><button data-kind="scx" class="active">Models</button><button data-kind="rpk">Packages</button><button data-kind="class">Scripts</button><button data-kind="cfg">CFG</button><button data-kind="vehicle">Cars</button></nav><div id="list" role="list"></div><div id="list-count"></div></aside>
<section class="workspace"><div class="toolbar"><div><span class="eyebrow" id="format">JAVA / ENTRY POINT</span><div id="filename">Waiting for Init.java</div></div><span class="badge" id="state">Idle</span></div><div id="viewport"></div><div id="inspector" hidden></div><div class="scene-help" id="scene-help">Left drag: rotate &nbsp; · &nbsp; Wheel: zoom &nbsp; · &nbsp; Right drag: pan</div><div class="detail"><div class="eyebrow">DIAGNOSTICS</div><div id="details">Loading game catalog…</div></div></section></main><footer><span>JAVA SOURCE / WEBGL 2</span><span>Original Init.java runs first · GameLogic is under implementation</span><span id="total"></span></footer>`;

// Keep Java OSD, minimap and native cursor independent of host diagnostics.
window.addEventListener('keydown', event => {
  if (event.code !== 'KeyU' || !event.ctrlKey || !event.altKey || event.metaKey) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!event.repeat) document.body.classList.toggle('debug-ui-hidden');
}, { capture: true });

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let assets: Assets, kind = 'scx', viewer: Viewer | undefined, sequence = 0, disposeMemoryLab: (() => void) | undefined;
let disposeJavaInput: (() => void) | undefined;
let minimapMode:NavigatorMode='java',activeNavigator:NavigatorNative|undefined;
let minimapZoomScale=2;
try{const saved=Number(localStorage.getItem('slrr-minimap-zoom-scale'));if(Number.isFinite(saved)&&saved>=.25&&saved<=12)minimapZoomScale=saved;}catch{/* Use the default scale when storage is unavailable. */}
let activeBoot:Awaited<ReturnType<typeof bootGame>>|undefined;
let disposeMinimap:(()=>void)|undefined;
let disposeGameBoot: (() => void) | undefined;
let disposeGameOsd: (() => void) | undefined;
let disposeJavaScene: (() => void) | undefined;
let localInstallation = false;
let engineWorld: EngineWorld | undefined;
let engineRoot: EnginePart | undefined, disposeDriving: (() => void) | undefined;
let beforeDrivingDetails = '';
let benchmarkRunning=false;
let routePreviewSession:ReturnType<Viewer['playRouteBenchmark']>|undefined;
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
  await softBodyReady;
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
  appendJavaEvent({ level: 'native', message: softBodyRuntime.available ? 'Soft-body C++/WASM ready (TS fallback available)' : `Soft-body TS fallback: ${softBodyRuntime.error ?? 'WASM unavailable'}` });
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
  activeBoot=result;activeNavigator=result.navigator;activeNavigator.mode=minimapMode;activeNavigator.zoomScale=minimapZoomScale;
  const minimap=new NavigatorView(gameOsd.stage,source,()=>hideGameUi.checked?[]:result.navigator.frames(16/9),message=>appendJavaEvent({level:'error',message}),id=>{const node=result.gameTypes.getByResourceId(id);return node?result.gameTypes.resolveRenderResource(node)??undefined:result.resolveResourceIdentity(id);});
  disposeMinimap=()=>minimap.dispose();
  disposeGameBoot = () => {disposeMinimap?.();disposeMinimap=undefined;activeNavigator=undefined;activeBoot=undefined;result.dispose();};
  viewer?.setJavaSceneCamera(() => javaSceneCamera(result),
    () => Number(result.jvm.get(jv('class', 'java.game.GameLogic'), 'time').value),()=>result.system.timeScale,()=>music?.getVolume(0)??1);
  const detachKeyboard = result.input.attachBrowserKeyboard(window);
  const javaMouse = new JavaMouse(el('viewport'), result, source,
    message => appendJavaEvent({ level: 'error', message }), (x, y) => viewer?.pickJavaPart(x, y));
  const poll = window.setInterval(() => {
    try {
      if(viewer)viewer.profiler.measure('Java input poll CPU',()=>{result.horns.update();result.input.pollCooperative();});
      else {result.horns.update();result.input.pollCooperative();}
    }
    catch (reason) {
      window.clearInterval(poll);
      appendJavaEvent({ level: 'error', message: `Java input: ${reason instanceof Error ? reason.message : String(reason)}` });
    }
  }, 50);
  disposeJavaInput = () => { javaMouse.dispose(); detachKeyboard(); window.clearInterval(poll); };
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
    const sceneVehicles = new JavaSceneVehicles(result, source, viewer, message => appendJavaEvent({ level: 'error', message }));
    viewer.setPerformanceContext(()=>[
      `Java scheduler: ${animating?`animating for ${(performance.now()-animateStartTime).toFixed(1)} ms`:'idle'} · skipped animation ticks ${animationSkipped} · animate period 50 ms · scene poll period 150 ms · map loading ${loadingTrack?'yes':'no'}`,
      `Java native registry: ${JSON.stringify(result.gameTypes.runtimeStats())} (allocated instances are not automatically animated)`,
      'Java call profiles (wall time, includes async waits; nested calls overlap):',
      ...[...result.javaProfile].sort((a,b)=>b[1].peakMs-a[1].peakMs).map(([name,t])=>
        `JVM ${name}: avg ${t.averageMs.toFixed(1)} ms · peak ${t.peakMs.toFixed(1)} · calls ${t.calls} · age ${((performance.now()-t.lastAt)/1000).toFixed(1)}s`),
    ]);
    const partPreviews = new JavaPartPreviews(gameOsd.stage, result, source, viewer,
      message => appendJavaEvent({ level: 'error', message }));
    let animating = false, loadingTrack = false,animationSkipped=0,animateStartTime=0;
    let replacingGarageCar = false;
    garageCarButton.onclick = async () => {
      if (replacingGarageCar || loadingTrack) return;
      replacingGarageCar = true; garageCarButton.disabled = true;
      status('Assembling Einvagen 110 GTK…');
      try {
        while (animating) await new Promise(resolve => window.setTimeout(resolve,10));
        await replaceGarageCarTree(result,source);
        loadedTrackKey = ''; pendingTrackKey = '';
        status('Garage car replaced: Einvagen 110 GTK');
      } catch (error) { status('Car replacement failed',true); appendJavaEvent({level:'error',message:String(error)}); }
      finally { replacingGarageCar = false; garageCarButton.disabled = false; }
    };
    let sceneTerrain: Awaited<ReturnType<Viewer['showMap']>>['terrain'] | undefined;
    let loadedTrackKey = '', loadedTrackState: unknown, activeTrackCleanup: (() => void) | undefined;
    let pendingTrackKey = '', pendingCarPose = '', pendingTrackSince = 0;
    const animationTimer = window.setInterval(() => {
      if (animating || replacingGarageCar){animationSkipped++;return;}
      animating = true;
      const animateStart = performance.now();
      animateStartTime=animateStart;
      void result.gameTypes.animateCallbacks(error => {
        appendJavaEvent({ level: 'error', message: `Java animate: ${error.message}` });
      }).finally(() => { viewer?.profiler.record('Java animate (wall)', performance.now() - animateStart); animating = false; });
    }, 50);
    const unlockMusic = () => { if (music?.snapshot().blocked) void music.resume(); };
    window.addEventListener('pointerdown', unlockMusic);
    window.addEventListener('keydown', unlockMusic);

    const loadSelectedTrack = async (selected: NonNullable<ReturnType<typeof activeJavaTrack>>) => {
      sceneVehicles.update(null);
      mapDebugPanel.hidden = true;
      sceneTerrain = undefined;
      const stopPrevious = activeTrackCleanup;
      activeTrackCleanup = undefined;
      stopPrevious?.();
      let built: Awaited<ReturnType<PartFactory['stock']>> | undefined;
      let session: ReturnType<Viewer['drive']> | undefined, gauges: JavaGauges | null = null;
      let physicsBinding: ReturnType<typeof result.physicsRefs.bindCollision> | undefined;
      let persistPhysics: (() => void) | undefined;
      try {
        status('Loading Java track…');
        if (selected.driving && selected.chassis && source.byPath.has(selected.chassis.pack)) {
          try {
            const selection = await javaStockSelection(result, source, selected.chassis.pack);
            built = await new PartFactory(source).stock(selected.chassis, { mechanical: true, javaSelection: selection });
            if (source !== assets || run !== sequence || !javaTrackIsCurrent(result, selected)) { built.world.dispose(); return; }
            await viewer!.showWorld(built.world, source, true);
          } catch (reason) {
            if (built) viewer?.removeWorld(built.world);
            built?.world.dispose(); built = undefined;
            appendJavaEvent({ level: 'error', message: `Java car rendering: ${reason instanceof Error ? reason.message : String(reason)}` });
          }
        }
        if (!javaTrackIsCurrent(result, selected)) {
          if (built) viewer?.removeWorld(built.world);
          built?.world.dispose(); return;
        }
        const map = await viewer!.showMap(selected.mapPack, source, (done, total) => {
          if (source === assets && run === sequence) status(`Java track ${done}/${total}`);
        }, true, { groundId: selected.mapResourceId, preserveCamera: !selected.driving,trafficTypes:result.traffic.models(selected.map),trafficBridge:result.traffic.bridge(selected.map,selected.state,async(car,pack)=>javaStockSelection(result,source,pack,jv('Vehicle',{className:'java.game.Vehicle',fields:new Map([['chassis',car]])}))) });
        if (source !== assets || run !== sequence || !javaTrackIsCurrent(result, selected)) {
          if (built) viewer?.removeWorld(built.world);
          built?.world.dispose(); return;
        }
        if (map.loaded === 0) throw new Error(`No map geometry loaded from ${selected.mapPack}: ${map.warnings.slice(0, 3).join('; ')}`);
        sceneTerrain = map.terrain;
        physicsBinding = result.physicsRefs.bindCollision(selected.map, map.collision);
        showMapDebugControls(map);
        if (built && selected.driving) {
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
              { ...javaControls, persist: () => persistPhysics?.(), active: () => javaTrackIsCurrent(result, selected), sample: () => { physicsBinding?.sync(); return javaControls.sample(); },
                instruments: (speed, rpm, gear, damage, engineCondition, transmissionCondition) => gauges?.update(speed, rpm, gear, damage, engineCondition, transmissionCondition),
                motion: (position, yaw, velocity) => {
                  javaVehicle?.setState(
                    { x: position.x, y: position.y, z: position.z }, { y: yaw, p: 0, r: 0 },
                    { x: velocity.x, y: velocity.y, z: velocity.z }, { x: 0, y: 0, z: 0 });
                  result.gameTypes.updateTriggerContacts(car);
                } });
            const driverRender=result.gameTypes.getResource(result.jvm.get(player,'render'));
            if(driverRender instanceof RenderObject){
              try{await viewer!.bindJavaDriver(driverRender,built.root,source);}catch(reason){appendJavaEvent({level:'error',message:`Driver IK: ${String(reason)}`});}
            }
            if (session.vehicle) persistPhysics = result.parts.bindPhysics(result.jvm.get(car, 'chassis'), session.vehicle);
            showVehicleDebug(built.root, session, () => [...result.javaProfile].sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 3)
              .map(([name, t]) => `JVM ${name}: ${t.averageMs.toFixed(1)} ms / peak ${t.peakMs.toFixed(1)} / calls ${t.calls} / ${((performance.now() - t.lastAt) / 1000).toFixed(1)}s ago (wall)`).join('\n'));
            driveHud.hidden = true;
            el('scene-help').textContent = 'Controls follow the game ControlSet · Right drag: rotate camera';
          } catch (reason) {
            gauges?.dispose(); gauges = null;
            appendJavaEvent({ level: 'error', message: `Java car simulation: ${reason instanceof Error ? reason.message : String(reason)}` });
          }
        }
        activeTrackCleanup = () => {
          clearVehicleDebug(); session?.(); physicsBinding?.dispose(); gauges?.dispose();
          if (built) viewer?.removeWorld(built.world);
          built?.world.dispose();
        };
        el('filename').textContent = selected.mapPack;
        el('format').textContent = 'JAVA / TRACK';
        el('details').textContent = `${map.loaded} map models · ${map.objects} placed objects · Java selected ${selected.chassis?.pack ?? 'no car'}`;
        status('Java track loaded');
      } catch (reason) {
        physicsBinding?.dispose();
        if (built) viewer?.removeWorld(built.world);
        built?.world.dispose();
        appendJavaEvent({ level: 'error', message: `Java scene rendering: ${reason instanceof Error ? reason.message : String(reason)}` });
        status('Java scene unavailable', true);
      }
    };

    const checkActiveTrack = () => {
      const actual = result.jvm.get(jv('class','java.game.GameLogic'),'actualState');
      garageCarButton.hidden = actual.value == null || !result.jvm.isInstance(actual,'java.game.Garage');
      if (replacingGarageCar) return;
      const selected = activeJavaTrack(result);
      if (loadedTrackKey && actual.value !== loadedTrackState) {
        const cleanup = activeTrackCleanup;
        activeTrackCleanup = undefined;
        cleanup?.();
        sceneVehicles.update(null);
        if (!selected) viewer?.clear();
        sceneTerrain = undefined;
        loadedTrackKey = ''; pendingTrackKey = '';
      }
      if (!selected || !source.byPath.has(selected.mapPack)) {
        sceneVehicles.update(null);
        mapDebugPanel.hidden = true;
        const cleanup = activeTrackCleanup;
        activeTrackCleanup = undefined;
        cleanup?.();
        if (loadedTrackKey) viewer?.clear();
        sceneTerrain = undefined;
        loadedTrackKey = '';
        pendingTrackKey = '';
        return;
      }
      if(selected.driving&&selected.carPose)void result.traffic.advanceDistant(selected.map,selected.carPose,(viewer?.trafficPhysicalRange??30)+20).catch(error=>appendJavaEvent({level:'error',message:`Distant rivals: ${String(error)}`}));
      const javaStart = selected.start
        ? `${selected.start.x.toFixed(3)},${selected.start.y.toFixed(3)},${selected.start.z.toFixed(3)},${selected.start.yaw.toFixed(3)}` : '';
      const key = `${selected.mapPack}:${selected.mapResourceId}|${selected.chassis?.pack ?? ''}|${selected.chassis?.id ?? ''}|${javaStart}`;
      if(key===loadedTrackKey&&!loadingTrack)viewer?.setJavaTrafficTypes(result.traffic.models(selected.map));
      if (key === loadedTrackKey && !loadingTrack)
        sceneVehicles.update(!selected.driving && javaSceneCamera(result) ? selected.map : null, sceneTerrain);
      if (key === loadedTrackKey || loadingTrack) return;
      // GameLogic.actualState changes before Track.enter() finishes. Wait until
      // Java has attached the car to this map and its scripted pose has settled;
      // otherwise host physics can start from a half-transition state.
      if (!selected.ready || selected.chassis && !selected.carPose) { pendingTrackKey = ''; return; }
      const pose = selected.carPose ? [selected.carPose.x, selected.carPose.y, selected.carPose.z, selected.carPose.yaw]
        .map(value => value.toFixed(3)).join(',') : 'no car';
      if (pendingTrackKey !== key || pendingCarPose !== pose) {
        pendingTrackKey = key; pendingCarPose = pose; pendingTrackSince = performance.now(); return;
      }
      if (performance.now() - pendingTrackSince < 450) return;
      loadingTrack = true;
      loadedTrackKey = key; loadedTrackState = selected.state.value;
      void loadSelectedTrack(selected).finally(() => { loadingTrack = false; });
    };
    const trackPoll = window.setInterval(()=>viewer?.profiler.measure('Java scene poll CPU',checkActiveTrack), 150);
    disposeJavaScene = () => {
      garageCarButton.hidden = true; garageCarButton.onclick = null;
      mapDebugPanel.hidden = true;
      viewer?.setJavaSceneCamera(undefined);
      viewer?.setPerformanceContext(undefined);
      sceneVehicles.dispose();
      partPreviews.dispose();
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
const hideGameUiLabel = textElement('label', '', 'viewport-hide-game-ui');
const hideGameUi = document.createElement('input'); hideGameUi.type = 'checkbox';
hideGameUi.onchange = () => el('viewport').classList.toggle('game-ui-hidden', hideGameUi.checked);
hideGameUiLabel.append(hideGameUi, 'Hide game UI');
el('viewport').append(hideGameUiLabel);
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
const pairControls = textElement('div', '', 'hood-controls'); pairControls.hidden = true; el('scene-help').before(pairControls);
const playgroundButton=textElement('button','Character playground');playgroundButton.className='hood-button';crashButton.after(playgroundButton);
const vinControls=textElement('div','','hood-controls character-playground');vinControls.hidden=true;el('scene-help').before(vinControls);
let vinTimer:number|undefined;
const driverIkButton=textElement('button','Driver IK');driverIkButton.className='hood-button';playgroundButton.after(driverIkButton);
driverIkButton.onclick=()=>{void openDriverIk();};
async function openDriverIk(pack='cars/racers/Baiern.rpk'){
  if(!assets||!viewer)return;const opening=openWorld(pack,6),request=sequence;await opening;
  if(request!==sequence||!engineRoot)return;
  try{
    const driver=await viewer.showDriverIk(engineRoot,assets);if(request!==sequence)return;
    vinControls.replaceChildren();vinControls.hidden=false;
    const label=textElement('label','Steering wheel '),slider=document.createElement('input'),output=textElement('span','0°'),skeletonLabel=textElement('label','Skeleton / grip targets'),skeleton=document.createElement('input'),cutawayLabel=textElement('label','Cutaway'),cutaway=document.createElement('input'),info=textElement('span',driver.info());
    slider.type='range';slider.min='-540';slider.max='540';slider.step='1';slider.value='0';slider.setAttribute('aria-label','Driver steering wheel');
    slider.oninput=()=>{const value=Number(slider.value);driver.steering(value);output.textContent=`${value}°`;info.textContent=driver.info();};label.append(slider,output);
    skeleton.type=cutaway.type='checkbox';skeleton.checked=cutaway.checked=true;skeletonLabel.prepend(skeleton);cutawayLabel.prepend(cutaway);skeleton.onchange=()=>driver.skeleton(skeleton.checked);cutaway.onchange=()=>driver.cutaway(cutaway.checked);
    const wristLabel=textElement('label','Wrist pivot'),wrist=document.createElement('input');wrist.type='checkbox';wrist.checked=true;wristLabel.prepend(wrist);wrist.onchange=()=>{driver.wristPivot(wrist.checked);info.textContent=driver.info();};
    const model=document.createElement('select');model.setAttribute('aria-label','Driver IK car');for(const name of ['Baiern','Yotta']){const option=document.createElement('option');option.value=`cars/racers/${name}.rpk`;option.textContent=name;model.append(option);}model.value=pack;model.onchange=()=>{void openDriverIk(model.value);};
    const headLabel=textElement('label','Fit head to cockpit'),headCheck=document.createElement('input');headCheck.type='checkbox';headCheck.checked=true;headLabel.prepend(headCheck);headCheck.onchange=()=>{driver.headFit(headCheck.checked);info.textContent=driver.info();};
    driver.skeleton(true);driver.cutaway(true);const row=textElement('div','','character-playground-row');row.append(model,label,skeletonLabel,cutawayLabel,wristLabel,headLabel);vinControls.append(row,info);
    el('format').textContent='DRIVER / SEAT + HAND IK';el('filename').textContent=`Vin · ${pack.includes('Yotta')?'Yotta':'Baiern'} seat and steering wheel`;el('details').textContent='Original humans.rpk Vin render and vin.skl. Seat/pedals/cockpit reference come from chassis CFG. Hands follow two upper-rim targets on the installed steering wheel through its actual slot/render transforms. Three-link arm chain with fixed bone lengths; neutral seated leg pose. A bounded torso/neck positional solve fits the head joint to the first cockpit camera, with neutral gaze and fixed pelvis/bone lengths. Blue marker: head goal. Fit head to cockpit allows comparison. The fitted upper-body pose is cached; hands continue to follow steering. Prototype IK, not native solver parity. Gear shifting, reverse head movement and inertial body movement are not implemented.';
    status('Driver IK ready');
  }catch(error){if(request===sequence){status('Driver IK error',true);el('details').textContent=String(error);}}
}

const minimapPreviewButton=textElement('button','Minimap preview');minimapPreviewButton.className='hood-button';driverIkButton.after(minimapPreviewButton);
minimapPreviewButton.onclick=()=>{void openMinimapPreview();};
async function openMinimapPreview(map='city'){
  if(!activeBoot||!assets||!viewer){status('Wait for Java initialization',true);return;}
  const result=activeBoot,source=assets;stopDrive();const request=++sequence;viewer.clear();
  // Only the preview hides the game OSD; its independent canvas stays inspectable.
  hideGameUi.checked=true;hideGameUi.onchange?.(new Event('change'));status('Loading Java Navigator…');
  let nav:import('slrr-jvm').JavaValue|undefined,mover:import('slrr-jvm').JavaValue|undefined,preview:NavigatorView|undefined,stage:HTMLDivElement|undefined;
  try{
    const script=map==='city'?'Valocity':'TestTrack',java=new TextDecoder().decode(await source.read(`sl/scripts/game/src/${script}.java`));
    const call=/new\s+Navigator\s*\(([^;]+)\)/.exec(java);if(!call)throw Error('Map has no classic Navigator constructor');const args=call[1].split(',').map(s=>s.trim());
    const numeric=(text:string)=>{if(!/^[\d.\s+-]+$/.test(text))throw Error('Unsupported Navigator numeric argument');return (text.replace(/\s/g,'').match(/[+-]?[\d.]+/g)??[]).reduce((sum,n)=>sum+Number(n),0);};
    const values=args.map((arg,index)=>{if(index>=3&&index<=5){const match=/([\w.]+):0x([\da-f]+)r/i.exec(arg);if(!match)throw Error('Unsupported Navigator resource');return result.gameTypes.remountSavedResource(match[1],parseInt(match[2],16));}return jv(index<3?'float':'int',numeric(arg));});
    nav=await result.jvm.constructAsync('java.game.Navigator',values);mover=await result.jvm.constructAsync('java.util.resource.Dummy',[]);const followed=result.gameTypes.get(mover)!;
    const center=map==='city'?{x:0,z:0}:{x:-456,z:-1503};followed.position={...center,y:0};
    await result.jvm.invokeAsync(nav,'show');await result.jvm.invokeAsync(nav,'changeSize',[jv('float',.02),jv('float',.02),jv('float',.96),jv('float',.96)]);
    const type=async(id:number)=>result.jvm.constructAsync('java.util.resource.RenderRef',[result.gameTypes.remountSavedResource('frontend.rpk',id)]);
    await result.jvm.invokeAsync(nav,'addMarker',[await type(0x5c),mover]);
    for(const [id,x,z]of [[0x5b,-200,100],[0x5f,100,-200],[0x5a,2500,1000]]){const point=await result.jvm.constructAsync('java.lang.Vector3',[jv('float',center.x+x),jv('float',0),jv('float',center.z+z)]);await result.jvm.invokeAsync(nav,'addMarker',[await type(id),point,jv('int',0)]);}
    await result.jvm.invokeAsync(nav,'updateNavigator',[mover,jv('int',0)]);
    if(sequence!==request||activeBoot!==result)throw Error('Navigator preview superseded');
    stage=document.createElement('div');stage.style.cssText='position:absolute;inset:48px 5% 5%;pointer-events:none;';el('viewport').append(stage);
    preview=new NavigatorView(stage,source,()=>result.navigator.frames(stage!.clientWidth/stage!.clientHeight).filter(frame=>frame.id===nav!.value),message=>appendJavaEvent({level:'error',message}),id=>{const node=result.gameTypes.getByResourceId(id);return node?result.gameTypes.resolveRenderResource(node)??undefined:result.resolveResourceIdentity(id);});
    vinControls.replaceChildren();vinControls.hidden=false;const row=textElement('div','','character-playground-row'),maps=document.createElement('select');maps.setAttribute('aria-label','Minimap preview map');for(const [value,label]of [['city','City'],['test_track','Test Track']]){const option=document.createElement('option');option.value=value;option.textContent=label;maps.append(option);}maps.value=map;maps.onchange=()=>{void openMinimapPreview(maps.value);};row.append(maps);
    const modes=document.createElement('select');modes.setAttribute('aria-label','Minimap preview mode');for(const [value,label]of [['java','Java / original'],['north','North up'],['heading','Follow heading']]){const option=document.createElement('option');option.value=value;option.textContent=label;modes.append(option);}modes.value=minimapMode;modes.onchange=()=>{minimapMode=modes.value as NavigatorMode;result.navigator.mode=minimapMode;minimapModeSelect.value=minimapMode;};row.append(modes);
    for(const [name,min,max,initial,apply]of [['Preview X',center.x-1000,center.x+1000,center.x,(v:number)=>{followed.position.x=v;}],['Preview Z',center.z-1000,center.z+1000,center.z,(v:number)=>{followed.position.z=v;}],['Preview heading',-180,180,0,(v:number)=>{followed.orientation.y=v*Math.PI/180;}],['Minimap zoom',1,15,4.5,(v:number)=>{const cam=result.gameTypes.getRender(result.jvm.get(nav!,'cam'));if(cam)cam.position.y=v;}]]as const){const label=textElement('label',name),slider=document.createElement('input');slider.type='range';slider.min=String(min);slider.max=String(max);slider.step=name==='Minimap zoom'?'.1':'1';slider.value=String(initial);slider.setAttribute('aria-label',name);slider.oninput=()=>apply(Number(slider.value));label.append(slider);row.append(label);}
    vinControls.append(row);el('format').textContent='MINIMAP / JAVA NAVIGATOR';el('filename').textContent=`${script} · original tile resources and marker symbols`;el('details').textContent='Original Navigator.java creates the tiles and viewport. Preview adds a moving player, two static garage symbols and an off-screen finish symbol. Sliders move only the test marker. Normal gameplay uses the original Java marker lists. Tile resources are cached, loaded three at a time, and frustum-culled by the independent unlit minimap renderer.';status('Minimap preview ready');
    const savedNav=nav,savedMover=mover,savedPreview=preview,savedStage=stage;disposeDriving=()=>{savedPreview.dispose();savedStage.remove();void result.jvm.invokeAsync(savedNav,'hide').then(()=>result.jvm.invokeAsync(savedNav,'finalize')).finally(()=>result.jvm.invokeAsync(savedMover,'finalize')).catch(()=>{});};
  }catch(error){preview?.dispose();stage?.remove();if(nav)void result.jvm.invokeAsync(nav,'hide').catch(()=>{});status('Minimap preview error',true);el('details').textContent=String(error);}
}

const suspensionButton=textElement('button','Suspension playground');suspensionButton.className='hood-button';driverIkButton.after(suspensionButton);
suspensionButton.onclick=()=>{void (async()=>{
  if(!assets||!viewer)return;const request=++sequence;stopDrive();engineRoot=undefined;engineWorld?.dispose();engineWorld=undefined;disposeMemoryLab?.();disposeMemoryLab=undefined;
  el('viewport').hidden=false;el('inspector').hidden=true;el('scene-help').hidden=false;status('Loading suspension bones…');
  try{
    const lab=await viewer.showSuspensionPlayground(assets);if(request!==sequence)return;
    vinControls.replaceChildren();vinControls.hidden=false;
    const row=textElement('div','','character-playground-row'),model=document.createElement('select');model.setAttribute('aria-label','Suspension model');
    for(const [value,label] of [['shock','Shock absorber'],['spring','Spring'],['both','Spring + shock']]){const option=document.createElement('option');option.value=value;option.textContent=label;model.append(option);}
    const lengthLabel=textElement('label','Length '),length=document.createElement('input'),lengthValue=document.createElement('output');length.type='range';length.min='45';length.max='145';length.step='1';length.value='100';length.setAttribute('aria-label','Suspension length');lengthLabel.append(length,lengthValue);
    const tiltLabel=textElement('label','Upper bone tilt '),tilt=document.createElement('input'),tiltValue=document.createElement('output');tilt.type='range';tilt.min='-25';tilt.max='25';tilt.step='1';tilt.value='0';tilt.setAttribute('aria-label','Suspension upper bone tilt');tiltLabel.append(tilt,tiltValue);
    const playLabel=textElement('label','Animate compression'),play=document.createElement('input'),bonesLabel=textElement('label','Bones'),bones=document.createElement('input');play.type=bones.type='checkbox';bones.checked=true;playLabel.prepend(play);bonesLabel.prepend(bones);
    const info=document.createElement('output'),reset=textElement('button','Reset suspension');
    const update=()=>{lengthValue.textContent=`${length.value}%`;tiltValue.textContent=`${tilt.value}°`;lab.setPose(Number(length.value)/100,Number(tilt.value));info.textContent=lab.info();};
    length.oninput=tilt.oninput=()=>{play.checked=false;lab.animate(false);update();};
    model.onchange=()=>{lab.select(model.value as 'spring'|'shock'|'both');info.textContent=lab.info();};
    play.onchange=()=>{lab.animate(play.checked);length.disabled=tilt.disabled=play.checked;};bones.onchange=()=>lab.skeleton(bones.checked);
    reset.onclick=()=>{play.checked=false;length.disabled=tilt.disabled=false;lab.animate(false);length.value='100';tilt.value='0';update();};
    row.append(model,lengthLabel,tiltLabel,playLabel,bonesLabel,reset);vinControls.append(row,info);update();vinTimer=window.setInterval(()=>{if(play.checked){length.value=String(Math.round(lab.lengthRatio*100));lengthValue.textContent=`${length.value}%`;info.textContent=lab.info();}},250);
    el('format').textContent='SUSPENSION / BONE SKINNING VS SCALE';el('filename').textContent='Original spring and shock absorber · parts.rpk';el('details').textContent='Left: original SCX weights and paired two-root BON. Right: the identical mesh under uniform Y scaling. Bind bone span 24.5 cm. Upper bone tilt affects only the skinned example; it is an experiment, not recovered suspension physics. Damper weights are rigid 0/1, spring weights are blended. No files are exported.';
    el('scene-help').textContent='Left: bone skinning · Right: scale Y · Left drag: orbit · Wheel: zoom · Right drag: pan';status('Suspension playground ready');
  }catch(error){if(request===sequence){status('Suspension playground error',true);el('details').textContent=String(error);}}
})();};

const suspensionRoadButton=textElement('button','Suspension road test');suspensionRoadButton.className='hood-button';suspensionButton.after(suspensionRoadButton);
suspensionRoadButton.onclick=()=>{void (async()=>{
  if(!assets||!viewer)return;const opening=openWorld('cars/racers/Baiern.rpk',6),request=sequence;await opening;if(request!==sequence||!engineRoot)return;
  status('Preparing suspension road…');
  try{
    const lab=await viewer.suspensionRoad(engineRoot,assets);if(request!==sequence){lab.dispose();return;}
    disposeDriving=()=>lab.dispose();vinControls.replaceChildren();vinControls.hidden=false;
    const row=textElement('div','','character-playground-row'),wheel=document.createElement('select');wheel.setAttribute('aria-label','Follow suspension wheel');
    for(const [value,label] of [['0','FL · front left'],['1','FR · front right'],['2','RL · rear left'],['3','RR · rear right']]){const option=document.createElement('option');option.value=value;option.textContent=label;wheel.append(option);}wheel.onchange=()=>lab.wheel(Number(wheel.value));row.append(textElement('label','Follow wheel'),wheel);
    const info=document.createElement('output');
    for(const [label,min,max,initial,action] of [['Test speed',0,40,20,(v:number)=>lab.speed(v)],['Bump height',0,15,8,(v:number)=>lab.bumps(v)]] as const){
      const box=textElement('label',label),slider=document.createElement('input'),value=document.createElement('output');slider.type='range';slider.min=String(min);slider.max=String(max);slider.step='1';slider.value=String(initial);slider.setAttribute('aria-label',label);const update=()=>{action(Number(slider.value));value.textContent=`${slider.value}${label==='Test speed'?' km/h':' cm'}`;};slider.oninput=update;update();box.append(slider,value);row.append(box);
    }
    for(const [label,initial,action] of [['Pause',false,(v:boolean)=>lab.pause(v)],['Slow motion ×0.25',false,(v:boolean)=>lab.slowMotion(v)],['Show body',false,(v:boolean)=>lab.body(v)],['Bone anchors',true,(v:boolean)=>lab.bones(v)],['Suspension bone animation',suspensionBonesCheck.checked,(v:boolean)=>{suspensionBonesCheck.checked=v;viewer?.setSuspensionBonesEnabled(v);}]] as const){const box=textElement('label',label),check=document.createElement('input');check.type='checkbox';check.checked=initial;check.onchange=()=>action(check.checked);box.prepend(check);row.append(box);}
    const reset=textElement('button','Restart road test');reset.onclick=()=>lab.reset();row.append(reset);vinControls.append(row,info);info.textContent=lab.info();vinTimer=window.setInterval(()=>{info.textContent=lab.info();},250);
    el('format').textContent='SUSPENSION / UNEVEN ROAD';el('filename').textContent='Baiern · live suspension and original bone skins';el('details').textContent='Original complete Baiern assembly, body hidden by default. The 120 Hz suspension solver handles tyres, springs, dampers, vertical motion, pitch and roll. A longitudinal guide holds the requested speed and lane; engine/transmission and crash deformation are not part of this stand. The rendered road and physics share the same height field. Original spring/shock bones follow CFG-linked lower and upper mounts. Camera follows the selected wheel; orbit and zoom remain available.';el('scene-help').textContent='Camera follows selected wheel · Left drag: orbit · Wheel: zoom · Right drag: pan';status('Suspension road test ready');
  }catch(error){if(request===sequence){stopDrive();status('Suspension road error',true);el('details').textContent=String(error);}}
})();};

playgroundButton.onclick=()=>{void openSkeletonPreview();};
async function openSkeletonPreview(id=0xa){
  if(!assets||!viewer)return;const request=++sequence;
  stopDrive();engineRoot=undefined;engineWorld?.dispose();engineWorld=undefined;disposeMemoryLab?.();disposeMemoryLab=undefined;
  el('viewport').hidden=false;el('inspector').hidden=true;el('scene-help').hidden=false;
  el('format').textContent='CHARACTER PLAYGROUND';status('Loading character…');
  try{
    const catalog=await loadCharacterCatalog(assets);if(request!==sequence)return;
    const resource=catalog.models.find(m=>m.id===id);if(!resource)throw Error('Character render is not in the RPK catalog');
    const character=await viewer.showVin(assets,id);if(request!==sequence)return;
    el('filename').textContent=`${resource.name} · humans.rpk : 0x${id.toString(16).padStart(4,'0')}`;
    vinControls.replaceChildren();vinControls.hidden=false;
    const row=()=>textElement('div','','character-playground-row');
    const selection=row(),playback=row(),manual=document.createElement('details');manual.append(textElement('summary','Manual bone pose'));const poseRow=row();manual.append(poseRow);
    const model=document.createElement('select');model.setAttribute('aria-label','Character model');
    for(const item of catalog.models){const option=document.createElement('option');option.value=String(item.id);option.textContent=`${item.name} · ${item.bones.length} bones · 0x${item.id.toString(16)}`;model.append(option);}model.value=String(id);
    model.onchange=()=>{void openSkeletonPreview(Number(model.value));};
    const animationSelect=document.createElement('select');animationSelect.setAttribute('aria-label','Character animation');
    const foreign=document.createElement('input');foreign.type='checkbox';const foreignLabel=textElement('label',"Other models' animations");foreignLabel.prepend(foreign);
    selection.append(textElement('label','Model'),model,textElement('label','Animation'),animationSelect,foreignLabel);
    const message=document.createElement('output');message.setAttribute('aria-label','Animation compatibility');
    const play=document.createElement('input');play.type='checkbox';const playLabel=textElement('label','Play animation');playLabel.prepend(play);
    const loop=document.createElement('input');loop.type='checkbox';loop.checked=true;const loopLabel=textElement('label','Loop animation');loopLabel.prepend(loop);
    const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='0';seek.step='0.001';seek.value='0';seek.setAttribute('aria-label','Animation time');
    const clock=document.createElement('output');clock.setAttribute('aria-label','Animation playback');const restart=textElement('button','Restart animation') as HTMLButtonElement;
    const skeleton=document.createElement('input');skeleton.type='checkbox';skeleton.checked=true;const skeletonLabel=textElement('label','Skeleton');skeletonLabel.prepend(skeleton);
    skeleton.onchange=()=>{character.helper.visible=skeleton.checked;};
    playback.append(playLabel,loopLabel,seek,clock,restart,skeletonLabel);
    const ragdoll=textElement('button','Ragdoll') as HTMLButtonElement,restore=textElement('button','Back to animation') as HTMLButtonElement;restore.disabled=true;
    playback.append(ragdoll,restore);
    const bone=document.createElement('select');bone.setAttribute('aria-label','Character bone');
    character.definitions.forEach((def,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${i}: ${def.name}`;bone.append(option);});bone.value=String(character.bone);
    const axis=document.createElement('select');axis.setAttribute('aria-label','Rotation axis');for(const name of ['X','Y','Z']){const option=document.createElement('option');option.value=name;option.textContent=name;axis.append(option);}axis.value='Z';
    const angle=document.createElement('input');angle.type='range';angle.min='-90';angle.max='90';angle.step='1';angle.value='0';angle.setAttribute('aria-label','Bone rotation');const value=document.createElement('output');value.textContent='0°';
    const reset=textElement('button','Reset pose'),bend=textElement('button','Test bend 45°');const test=document.createElement('input');test.type='checkbox';const testLabel=textElement('label','Animate test');testLabel.prepend(test);
    const info=document.createElement('output');info.setAttribute('aria-label','Skin deformation');
    poseRow.append(bone,axis,angle,value,bend,reset,testLabel,info);
    vinControls.append(selection,message,playback,manual);
    let original:Awaited<ReturnType<SkinnedCharacter['loadOriginalClip']>>|undefined,clipRequest=0;
    const updateInfo=()=>{const d=character.deformation();info.textContent=`${d.moved}/${d.total} vertices moved · max ${(d.max*100).toFixed(2)} cm`;};
    const updatePlayback=()=>{seek.value=String(character.playbackTime);clock.textContent=original?`${character.playbackTime.toFixed(2)} / ${original.clip.duration.toFixed(2)} s · ${original.animation.times.length} keys/bone`:'Bind pose';};
    const updateDetails=()=>{el('details').textContent=`${character.source.pack}:0x${id.toString(16)}\nMesh: ${character.source.mesh}\nSkeleton: ${character.source.skeleton}\n${character.definitions.length} bones · ${character.meshes.length} skinned sections\n${original?`Animation: ${original.path} · ${original.clip.tracks.length} native Three.js tracks`:'Bind pose; no original animation selected.'}\nJoint limits are metadata. No files are exported.`;};
    const setPlaybackEnabled=(enabled:boolean)=>{play.disabled=seek.disabled=restart.disabled=loop.disabled=!enabled||character.isRagdoll;};
    const updateRagdollControls=()=>{
      const active=character.isRagdoll;ragdoll.disabled=active;restore.disabled=!active;animationSelect.disabled=foreign.disabled=active;
      restore.textContent=original?'Back to animation':'Restore pose';setPlaybackEnabled(!!original);
      for(const control of poseRow.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button'))control.disabled=active;
    };
    ragdoll.onclick=async()=>{
      ++clipRequest;ragdoll.disabled=true;
      try{await character.startRagdoll();if(request!==sequence)return;play.checked=false;test.checked=false;updateRagdollControls();clock.textContent='Ragdoll';}
      catch(error){if(request===sequence){message.textContent=String(error);updateRagdollControls();}}
    };
    restore.onclick=()=>{const time=Number(seek.value);character.stopRagdoll();if(original){character.playClip(original.clip,true,loop.checked);character.seek(time);}else character.setPlaybackPlaying(false);play.checked=!!original;updateRagdollControls();updatePlayback();updateInfo();};
    const loadAnimation=async()=>{
      const pending=++clipRequest;play.checked=false;test.checked=false;original=undefined;character.setPose(character.bone,character.axis,0);setPlaybackEnabled(false);
      updateRagdollControls();ragdoll.disabled=true;
      if(!animationSelect.value){ragdoll.disabled=false;message.textContent='Bind pose';updateInfo();updatePlayback();updateDetails();return;}
      message.textContent='Loading animation…';
      try{
        const animation=catalog.animations.find(a=>a.id===Number(animationSelect.value))!;
        const transferred=animation.family!==resource.family;
        const loaded=await character.loadOriginalClip(assets,animation.id,transferred);
        if(request!==sequence||pending!==clipRequest)return;
        original=loaded;seek.max=String(loaded.clip.duration);seek.value='0';angle.value='0';value.textContent='0°';play.checked=true;setPlaybackEnabled(true);character.playClip(loaded.clip,true,loop.checked);
        updateRagdollControls();
        message.textContent=transferred?'Shared skeleton: using this model’s bone lengths. Different bone axes still need retargeting.':`Original animation · ${animation.name}`;
        updateInfo();updatePlayback();updateDetails();
      }catch(error){if(request===sequence&&pending===clipRequest){message.textContent=String(error);updateRagdollControls();updatePlayback();updateDetails();}}
    };
    const populateAnimations=()=>{
      const previous=animationSelect.value;animationSelect.replaceChildren();const bind=document.createElement('option');bind.value='';bind.textContent='Bind pose';animationSelect.append(bind);
      for(const animation of catalog.animations){
        if(!foreign.checked&&animation.family!==resource.family)continue;
        const incompatible=skeletonCompatibility(character.definitions,animation.bones),option=document.createElement('option');option.value=String(animation.id);option.disabled=!!incompatible;
        option.textContent=`${animation.name}${animation.family!==resource.family?' · other model':''}${incompatible?' · incompatible skeleton':''}`;option.title=incompatible??animation.path;animationSelect.append(option);
      }
      const options=Array.from(animationSelect.options),exact=catalog.animations.find(a=>a.path.replace(/\.matrixdata$/i,'').toLowerCase()===resource.path.replace(/\.skl$/i,'').toLowerCase());
      animationSelect.value=options.some(o=>o.value===previous&&previous&&!o.disabled)?previous:exact&&options.some(o=>o.value===String(exact.id)&&!o.disabled)?String(exact.id):options.find(o=>o.value&&!o.disabled)?.value??'';
      void loadAnimation();
    };
    animationSelect.onchange=()=>{void loadAnimation();};foreign.onchange=populateAnimations;
    play.onchange=()=>{if(!original)return;test.checked=false;character.playClip(original.clip,play.checked,loop.checked);character.seek(Number(seek.value));};
    loop.onchange=()=>character.setPlaybackLoop(loop.checked);
    seek.oninput=()=>{if(!original)return;test.checked=false;play.checked=false;const time=Number(seek.value);character.playClip(original.clip,false,loop.checked);character.seek(time);updateInfo();updatePlayback();};
    restart.onclick=()=>{if(!original)return;test.checked=false;play.checked=true;character.playClip(original.clip,true,loop.checked);updatePlayback();};
    const pose=()=>{++clipRequest;play.checked=false;test.checked=false;character.setPose(Number(bone.value),axis.value as 'X'|'Y'|'Z',Number(angle.value));value.textContent=`${angle.value}°`;updateInfo();};
    bone.onchange=pose;axis.onchange=pose;angle.oninput=pose;reset.onclick=()=>{angle.value='0';pose();};bend.onclick=()=>{angle.value='45';pose();};test.onchange=()=>{play.checked=false;character.animate(test.checked);};
    populateAnimations();updateInfo();updatePlayback();updateDetails();
    vinTimer=window.setInterval(()=>{if(request!==sequence)return;if(play.checked)updatePlayback();if(manual.open&&(play.checked||test.checked||character.isRagdoll))updateInfo();},100);
    status(`${resource.name} ready`);
  }catch(error){if(request===sequence){viewer.clear();status('Character load failed',true);el('details').textContent=String(error);}}
}
const mapDebugPanel = document.createElement('details'); mapDebugPanel.className = 'map-debug-panel'; mapDebugPanel.hidden = true;
const garageCarButton = textElement('button','Replace car: Einvagen 110 GTK') as HTMLButtonElement;
garageCarButton.hidden = true;
garageCarButton.title = 'Replace the current garage car tree with a complete stock 110 GTK for testing';
mapDebugPanel.append(textElement('summary', 'Graphics / map debug'),garageCarButton);
const mapDebugData = textElement('pre', '', 'map-debug-data'); mapDebugPanel.append(mapDebugData);
const mapDebugOptions = textElement('div', '', 'map-debug-options');
const hideTreesLabel=textElement('label','Hide trees'),hideTreesCheck=document.createElement('input');
hideTreesCheck.type='checkbox';hideTreesLabel.prepend(hideTreesCheck);mapDebugOptions.append(hideTreesLabel);
hideTreesLabel.title='Hide stock tree trunks and foliage in all render passes for performance comparisons. Tree collision stays active.';
hideTreesCheck.onchange=()=>viewer?.setMapTreesHidden(hideTreesCheck.checked);
for(const [category,title,description] of [
  ['streetlights','Hide streetlights / poles','Streetlights, their attached components, traffic lights and utility poles.'],
  ['bins','Hide trash bins','Stock trash bins, including separate lids.'],
  ['small-props','Hide other small props','Signs, adverts, benches, hydrants, crates, containers, barriers and other known stock street furniture. Buildings and roads stay visible.'],
] as const){
  const label=textElement('label',title),check=document.createElement('input');
  check.type='checkbox';label.prepend(check);label.title=`${description} Hide in all render passes; collision stays active.`;
  check.onchange=()=>viewer?.setMapObjectCategoryHidden(category,check.checked);mapDebugOptions.append(label);
}
const cachedCellsLabel=textElement('label','Precached object cells'),cachedCellsCheck=document.createElement('input');
cachedCellsCheck.type='checkbox';cachedCellsLabel.prepend(cachedCellsCheck);mapDebugOptions.append(cachedCellsLabel);
cachedCellsLabel.title='Experimental: prepare fixed instance buffers for trees and street furniture once; switch whole cells without per-object instance compaction. Buildings and roads retain ordinary streaming.';
const cellSizeLabel=textElement('label','Object cell size (m)'),cellSizeSelect=document.createElement('select');
for(const size of [64,128]){const option=document.createElement('option');option.value=String(size);option.textContent=String(size);cellSizeSelect.append(option);}
cellSizeSelect.value='128';cellSizeLabel.append(cellSizeSelect);mapDebugOptions.append(cellSizeLabel);
const cachedCellsStatus=textElement('span','');mapDebugOptions.append(cachedCellsStatus);
const updateCachedCells=async()=>{
  cachedCellsCheck.disabled=cellSizeSelect.disabled=true;cachedCellsStatus.textContent='Preparing object cells…';
  try{await viewer?.setPrecachedObjectCells(cachedCellsCheck.checked,Number(cellSizeSelect.value));cachedCellsStatus.textContent='';}
  catch(error){cachedCellsStatus.textContent=String(error);}
  finally{cachedCellsCheck.disabled=cellSizeSelect.disabled=false;}
};
cachedCellsCheck.onchange=()=>{void updateCachedCells();};
cellSizeSelect.onchange=()=>{void updateCachedCells();};
const unifiedBuildingsStorageKey='slrr.graphics.unifiedBuildingMaterials.v1';
const unifiedBuildingsLabel=textElement('label','Unified building materials'),unifiedBuildingsCheck=document.createElement('input');
try{unifiedBuildingsCheck.checked=localStorage.getItem(unifiedBuildingsStorageKey)==='1';}catch{ /* Keep the default when browser storage is unavailable. */ }
unifiedBuildingsCheck.type='checkbox';unifiedBuildingsLabel.prepend(unifiedBuildingsCheck);mapDebugOptions.append(unifiedBuildingsLabel);
unifiedBuildingsLabel.title='Experimental: merge compatible opaque parts of each building model using a shared texture-array material. Saved in this browser. Re-enter the map, reload the page or rerun the benchmark after changing this setting. Transparent and unsupported surfaces stay original.';
const unifiedBuildingsStatus=textElement('span','');mapDebugOptions.append(unifiedBuildingsStatus);
unifiedBuildingsCheck.onchange=()=>{
  try{localStorage.setItem(unifiedBuildingsStorageKey,unifiedBuildingsCheck.checked?'1':'0');}catch{ /* The live setting still works when storage is unavailable. */ }
  viewer?.setUnifiedBuildingMaterials(unifiedBuildingsCheck.checked);unifiedBuildingsStatus.textContent='Saved · re-enter map / reload page / Run benchmark to apply';
};
const globalFacadesStorageKey='slrr.graphics.globalFacadeBatches.v1';
const globalFacadesLabel=textElement('label','Global facade batches'),globalFacadesCheck=document.createElement('input');
try{globalFacadesCheck.checked=localStorage.getItem(globalFacadesStorageKey)==='1';}catch{ /* Optional preference. */ }
globalFacadesCheck.type='checkbox';globalFacadesLabel.prepend(globalFacadesCheck);mapDebugOptions.append(globalFacadesLabel);
globalFacadesLabel.title='Experimental CPU tradeoff: expand all prepared opaque facade instances into large static batches by shared material once at map load. No per-facade distance/frustum selection. Requires Unified building materials; more off-screen triangles and memory. Re-enter map or rerun benchmark to apply.';
const applyGlobalFacadesPreference=()=>{
  if(globalFacadesCheck.checked){unifiedBuildingsCheck.checked=true;viewer?.setUnifiedBuildingMaterials(true);try{localStorage.setItem(unifiedBuildingsStorageKey,'1');}catch{}}
  unifiedBuildingsCheck.disabled=globalFacadesCheck.checked;viewer?.setGlobalFacadeBatching(globalFacadesCheck.checked);
};
applyGlobalFacadesPreference();
globalFacadesCheck.onchange=()=>{
  try{localStorage.setItem(globalFacadesStorageKey,globalFacadesCheck.checked?'1':'0');}catch{}
  applyGlobalFacadesPreference();unifiedBuildingsStatus.textContent='Saved · re-enter map / reload page / Run benchmark to apply';
};
const staticBatchLabel=textElement('label','Merge static map geometry'),staticBatchCheck=document.createElement('input');
staticBatchCheck.type='checkbox';staticBatchLabel.prepend(staticBatchCheck);mapDebugOptions.append(staticBatchLabel);
staticBatchLabel.title='Experimental: combine compatible opaque parts by material and 128 m cell within each streamed model. Original geometry stays cached for comparison.';
staticBatchCheck.onchange=()=>viewer?.setStaticBatchingEnabled(staticBatchCheck.checked);
const autoLodLabel=textElement('label','Generated map LOD'),autoLodCheck=document.createElement('input');
autoLodCheck.type='checkbox';autoLodLabel.prepend(autoLodCheck);mapDebugOptions.append(autoLodLabel);
autoLodLabel.title='Experimental: quality-checked closed opaque surfaces only, far at 200 m / near 160 m. Open facades, cutout foliage and unsupported extra UV channels stay original.';
autoLodCheck.onchange=()=>viewer?.setAutoMapLodEnabled(autoLodCheck.checked);
const farPlaneLabel=textElement('label','Far plane'),farPlaneCheck=document.createElement('input');
const tightFrustumLabel=textElement('label','Per-part frustum culling'),tightFrustumCheck=document.createElement('input');
tightFrustumCheck.type='checkbox';tightFrustumCheck.checked=true;tightFrustumLabel.prepend(tightFrustumCheck);mapDebugOptions.append(tightFrustumLabel);
tightFrustumLabel.title='Check each mesh part against the camera frustum after the coarse model check. Off-screen parts stay available for shadows and reflections.';
tightFrustumCheck.onchange=()=>viewer?.setTightMapFrustumEnabled(tightFrustumCheck.checked);
farPlaneCheck.type='checkbox';farPlaneLabel.prepend(farPlaneCheck);mapDebugOptions.append(farPlaneLabel);
farPlaneLabel.title='Limit the primary camera far clipping plane to the streaming radius. The inspection camera retains its full range. Disable to restore the game camera range.';
farPlaneCheck.onchange=()=>viewer?.setFarPlaneEnabled(farPlaneCheck.checked);
const streamThrottleLabel=textElement('label','Limit streamer update rate'),streamThrottleCheck=document.createElement('input');
streamThrottleCheck.type='checkbox';streamThrottleCheck.checked=true;streamThrottleLabel.prepend(streamThrottleCheck);mapDebugOptions.append(streamThrottleLabel);
streamThrottleLabel.title='Reuse the prepared map instance lists between updates. Larger intervals also delay visibility changes and installation of loaded objects.';
const streamIntervalLabel=textElement('label','Streamer interval (ms)'),streamIntervalInput=document.createElement('input');
streamIntervalInput.type='number';streamIntervalInput.min='0';streamIntervalInput.step='1';streamIntervalInput.value='100';
streamIntervalInput.style.width='75px';streamIntervalLabel.append(streamIntervalInput);mapDebugOptions.append(streamIntervalLabel);
streamThrottleCheck.onchange=()=>{streamIntervalInput.disabled=!streamThrottleCheck.checked;viewer?.setStreamThrottleEnabled(streamThrottleCheck.checked);};
streamIntervalInput.onchange=()=>{if(streamIntervalInput.value!==''&&streamIntervalInput.checkValidity())viewer?.setStreamIntervalMs(Number(streamIntervalInput.value));};
const graphicsDetailsLabel=textElement('label','Detailed GPU diagnostics'),graphicsDetailsCheck=document.createElement('input');
const cutoffLabel=textElement('label','Geometry distance cutoff'),cutoffCheck=document.createElement('input');
const rayOcclusionLabel=textElement('label','Raycast occlusion culling'),rayOcclusionCheck=document.createElement('input');
rayOcclusionCheck.type='checkbox';rayOcclusionLabel.prepend(rayOcclusionCheck);mapDebugOptions.append(rayOcclusionLabel);
rayOcclusionLabel.title='Experimental CPU rays against opaque visual triangles. Only proven convex coverage hides a box. Shadows and reflections retain full geometry.';
rayOcclusionCheck.onchange=()=>viewer?.setRaycastOcclusionEnabled(rayOcclusionCheck.checked);
const gpuOcclusionLabel=textElement('label','GPU Hi-Z occlusion'),gpuOcclusionCheck=document.createElement('input');
gpuOcclusionCheck.type='checkbox';gpuOcclusionCheck.checked=true;gpuOcclusionLabel.prepend(gpuOcclusionCheck);mapDebugOptions.append(gpuOcclusionLabel);
gpuOcclusionLabel.title='Experimental GPU bounding-box visibility flags with asynchronous readback. Preserves shadows. Always tests primary-camera visibility, including in the observer view. Bypassed with Inspect all resident instances, distance cutoff or CPU rays. Last completed GPU verdicts remain applied through camera movement and streaming until the next GPU result.';
gpuOcclusionCheck.onchange=()=>{viewer?.setGpuOcclusionEnabled(gpuOcclusionCheck.checked);if(gpuOcclusionCheck.checked)rayOcclusionCheck.checked=false;};
const gpuIntervalLabel=textElement('label','GPU occlusion interval (frames)'),gpuInterval=document.createElement('select');
for(const frames of [1,2,3,4,6,8,12]){const option=document.createElement('option');option.value=String(frames);option.textContent=String(frames);gpuInterval.append(option);}gpuInterval.value='12';
gpuIntervalLabel.append(gpuInterval);mapDebugOptions.append(gpuIntervalLabel);gpuInterval.onchange=()=>viewer?.setGpuOcclusionInterval(Number(gpuInterval.value));
const gpuApplyLabel=textElement('label','Apply GPU occlusion results'),gpuApply=document.createElement('input');gpuApply.type='checkbox';gpuApply.checked=true;
gpuApplyLabel.prepend(gpuApply);mapDebugOptions.append(gpuApplyLabel);gpuApply.onchange=()=>viewer?.setGpuOcclusionApply(gpuApply.checked);
const gpuDebugLabel=textElement('label','GPU occlusion debug view'),gpuDebug=document.createElement('select');
for(const [value,label] of [['off','Off'],['depth','Depth 512 × 256'],...Array.from({length:9},(_,i)=>['hiz-'+i,'Hi-Z '+i+' (max depth)']),['flags','Visibility flags'],['boxes','Bounding boxes'],['boxes-hidden','Hidden boxes only']]){const option=document.createElement('option');option.value=value;option.textContent=label;gpuDebug.append(option);}
gpuDebugLabel.append(gpuDebug);mapDebugOptions.append(gpuDebugLabel);
gpuDebug.onchange=()=>{if(gpuDebug.value!=='off'){if(!gpuOcclusionCheck.checked){gpuOcclusionCheck.checked=true;viewer?.setGpuOcclusionEnabled(true);}gpuApply.checked=false;viewer?.setGpuOcclusionApply(false);}viewer?.setGpuOcclusionDebug(gpuDebug.value);};
const gpuFreezeLabel=textElement('label','Freeze GPU occlusion depth'),gpuFreeze=document.createElement('input');gpuFreeze.type='checkbox';gpuFreezeLabel.prepend(gpuFreeze);mapDebugOptions.append(gpuFreezeLabel);gpuFreeze.onchange=()=>viewer?.setGpuOcclusionFreeze(gpuFreeze.checked);
const rayBudgetLabel=textElement('label','Ray budget (ms)'),rayBudgetInput=document.createElement('input');
rayBudgetInput.type='number';rayBudgetInput.min='.5';rayBudgetInput.max='8';rayBudgetInput.step='.5';rayBudgetInput.value='2';
rayBudgetInput.style.width='55px';rayBudgetLabel.append(rayBudgetInput);mapDebugOptions.append(rayBudgetLabel);
rayBudgetInput.onchange=()=>viewer?.setRaycastOcclusionBudget(Number(rayBudgetInput.value));
cutoffCheck.type='checkbox';cutoffLabel.prepend(cutoffCheck);mapDebugOptions.append(cutoffLabel);
cutoffLabel.title='Split large static meshes into 64 m cells and cut at the streaming radius. Cells prepare once when enabled. Physics stays unchanged.';
cutoffCheck.onchange=()=>viewer?.setGeometryCutoffEnabled(cutoffCheck.checked);
const backfaceLabel=textElement('label','Back-face culling (map)'),backfaceCheck=document.createElement('input');
backfaceCheck.type='checkbox';backfaceCheck.checked=true;backfaceLabel.prepend(backfaceCheck);mapDebugOptions.append(backfaceLabel);
backfaceLabel.title='Experimental: cull reverse faces of opaque static map meshes with consistent winding. Foliage, transparency and shadow casters stay two-sided.';
backfaceCheck.onchange=()=>viewer?.setMapBackfaceCullingEnabled(backfaceCheck.checked);
graphicsDetailsCheck.type='checkbox';graphicsDetailsLabel.prepend(graphicsDetailsCheck);mapDebugOptions.append(graphicsDetailsLabel);
graphicsDetailsLabel.title='Record GPU passes, CPU/browser stalls, GL resource activity and texture memory estimates. Instrumentation adds CPU overhead while enabled.';
graphicsDetailsCheck.onchange=()=>viewer?.setGraphicsDiagnosticsEnabled(graphicsDetailsCheck.checked);
const observerLabel=textElement('label','Independent inspection camera'),observerCheck=document.createElement('input');
observerCheck.type='checkbox';observerLabel.prepend(observerCheck);mapDebugOptions.append(observerLabel);
observerLabel.title='Left drag orbit, right drag pan, wheel zoom. Streaming stays attached to the primary game camera.';
observerCheck.onchange=()=>viewer?.setInspectionCameraEnabled(observerCheck.checked);
const residentLabel=textElement('label','Inspect all resident instances'),residentCheck=document.createElement('input');
residentCheck.type='checkbox';residentLabel.prepend(residentCheck);mapDebugOptions.append(residentLabel);
residentLabel.title='Observer only: show already loaded instances, including those excluded by primary-camera culling. This deliberately increases render work.';
residentCheck.onchange=()=>viewer?.setInspectResidentEnabled(residentCheck.checked);
const observerReset=textElement('button','Reset inspection camera') as HTMLButtonElement;
observerReset.type='button';observerReset.onclick=()=>viewer?.resetInspectionCamera();mapDebugOptions.append(observerReset);
const graphicsReport=textElement('pre','','map-debug-data');
mapDebugPanel.append(graphicsReport);
const graphicsCopy=textElement('button','Copy graphics report') as HTMLButtonElement;
graphicsCopy.type='button';graphicsCopy.onclick=()=>{
  const report=viewer?.profiler.measure('Graphics report build CPU',()=>[
    new Date().toISOString(),...viewer!.profiler.lines(),...viewer!.graphicsDebugLines(),
  ].join('\n'))??new Date().toISOString();
  void navigator.clipboard.writeText(report).catch(error=>{graphicsReport.textContent=String(error);});
};
mapDebugOptions.append(graphicsCopy);
window.setInterval(()=>{
  // Keep capture independent of expensive scene reports and DOM reconstruction.
  if(recordingRequested)return;
  if(benchmarkRunning){
    viewer?.profiler.measure('Graphics debug UI CPU',()=>{
      const text=viewer?.benchmarkDebugLines().join('\n')??'';
      graphicsReport.textContent=text;routeLiveMetrics.textContent=text;
    });return;
  }
  if(mapDebugPanel.hidden||!mapDebugPanel.open)return;
  trafficTestStatus.textContent=viewer?.trafficTestInfo()??'';
  pedestrianCrowdStatus.textContent=viewer?.pedestrianInfo()??'';
  playerTrafficCheck.checked=viewer?.playerTrafficEnabled??false;
  if(playerTrafficCheck.checked)playerTrafficStatus.textContent=viewer?.playerTrafficInfo()??'';
  viewer?.profiler.measure('Graphics debug UI CPU',()=>{
  graphicsReport.textContent=[
    ...(graphicsDetailsCheck.checked?viewer?.profiler.gpuSummaryLines()??[]:[]),
    ...viewer?.graphicsDebugLines(false)??[],
  ].join('\n');
  });
},500);
const mapDebugChecks: HTMLInputElement[] = [];
const roadDebugStatus=textElement('pre','','map-debug-data');
for(const [layer,title] of [['graph','Road graph'],['crossings','Road crossings'],['metadata','Road metadata labels']] as const){
  const label=textElement('label',title),input=document.createElement('input');input.type='checkbox';
  input.onchange=()=>{const pending=viewer?.showRoadDebug(layer,input.checked);roadDebugStatus.textContent=viewer?.roadDebugStatus??'';void pending?.then(()=>{roadDebugStatus.textContent=viewer?.roadDebugStatus??'';});};
  label.prepend(input);mapDebugOptions.append(label);mapDebugChecks.push(input);
}
mapDebugOptions.append(roadDebugStatus);
const pedestrianDebugStatus=textElement('pre','','map-debug-data');
for(const [layer,title] of [['graph','Pedestrian graph'],['rest','Pedestrian rest areas']] as const){
  const label=textElement('label',title),input=document.createElement('input');input.type='checkbox';
  input.onchange=()=>{const pending=viewer?.showPedestrianDebug(layer,input.checked);pedestrianDebugStatus.textContent=viewer?.pedestrianDebugStatus??'';void pending?.then(()=>{pedestrianDebugStatus.textContent=viewer?.pedestrianDebugStatus??'';});};
  label.prepend(input);mapDebugOptions.append(label);mapDebugChecks.push(input);
}
mapDebugOptions.append(pedestrianDebugStatus);
const pedestrianCrowdLabel=textElement('label','Walking pedestrians'),pedestrianCrowdCheck=document.createElement('input'),pedestrianCrowdStatus=textElement('pre','','map-debug-data');
pedestrianCrowdCheck.type='checkbox';pedestrianCrowdLabel.prepend(pedestrianCrowdCheck);mapDebugOptions.append(pedestrianCrowdLabel,pedestrianCrowdStatus);mapDebugChecks.push(pedestrianCrowdCheck);
for(const [title,min,max,step,initial,set] of [
  ['Pedestrians',0,50,1,6,(n:number)=>viewer?.setPedestrianCount(n)],
  ['Pedestrian spawn radius (m)',50,300,25,100,(n:number)=>viewer?.setPedestrianRadius(n)],
] as const){
  const label=textElement('label',''),value=textElement('span',`${title}: ${initial}`),slider=document.createElement('input');slider.type='range';slider.min=String(min);slider.max=String(max);slider.step=String(step);slider.value=String(initial);slider.setAttribute('aria-label',title);
  slider.oninput=()=>{const n=Number(slider.value);value.textContent=`${title}: ${n}`;set(n);};label.append(value,slider);mapDebugOptions.append(label);
}
const inspectPedestriansButton=textElement('button','Inspect pedestrians');inspectPedestriansButton.onclick=()=>viewer?.inspectPedestrians();mapDebugOptions.append(inspectPedestriansButton);
pedestrianCrowdCheck.onchange=()=>{const pending=viewer?.showWalkingPedestrians(pedestrianCrowdCheck.checked);pedestrianCrowdStatus.textContent=viewer?.pedestrianCrowdStatus??'';void pending?.then(()=>{pedestrianCrowdStatus.textContent=viewer?.pedestrianCrowdStatus??'';});};

const trafficCountLabel=textElement('label',''),trafficCountValue=textElement('span','Traffic cars: 2'),trafficCountSlider=document.createElement('input');
trafficCountSlider.type='range';trafficCountSlider.min='0';trafficCountSlider.max='50';trafficCountSlider.step='1';trafficCountSlider.value='2';trafficCountSlider.setAttribute('aria-label','Traffic cars');
trafficCountLabel.append(trafficCountValue,trafficCountSlider);mapDebugOptions.append(trafficCountLabel);
trafficCountSlider.oninput=()=>{const count=Number(trafficCountSlider.value);trafficCountValue.textContent=`Traffic cars: ${count}`;void viewer?.setTrafficCount(count);};
const trafficRadiusLabel=textElement('label',''),trafficRadiusValue=textElement('span','Traffic physics radius: 30 m'),trafficRadiusSlider=document.createElement('input');
trafficRadiusSlider.type='range';trafficRadiusSlider.min='5';trafficRadiusSlider.max='200';trafficRadiusSlider.step='5';trafficRadiusSlider.value='30';trafficRadiusSlider.setAttribute('aria-label','Traffic physics radius');
trafficRadiusLabel.append(trafficRadiusValue,trafficRadiusSlider);mapDebugOptions.append(trafficRadiusLabel);
trafficRadiusSlider.oninput=()=>{const radius=Number(trafficRadiusSlider.value);trafficRadiusValue.textContent=`Traffic physics radius: ${radius} m`;viewer?.setTrafficPhysicsRadius(radius);};
const trafficSpawnLabel=textElement('label',''),trafficSpawnValue=textElement('span','Traffic spawn radius: 100 m'),trafficSpawnSlider=document.createElement('input');
trafficSpawnSlider.type='range';trafficSpawnSlider.min='25';trafficSpawnSlider.max='500';trafficSpawnSlider.step='25';trafficSpawnSlider.value='100';trafficSpawnSlider.setAttribute('aria-label','Traffic spawn radius');
trafficSpawnLabel.title='New cars appear on the nearest free graph lanes within this radius. Existing cars remain until they leave the map streaming radius.';
trafficSpawnLabel.append(trafficSpawnValue,trafficSpawnSlider);mapDebugOptions.append(trafficSpawnLabel);
trafficSpawnSlider.oninput=()=>{const radius=Number(trafficSpawnSlider.value);trafficSpawnValue.textContent=`Traffic spawn radius: ${radius} m`;viewer?.setTrafficSpawnRadius(radius);};
const trafficTestStatus=textElement('pre','','map-debug-data');mapDebugOptions.append(trafficTestStatus);
const playerTrafficLabel=textElement('label','Traffic controls my car'),playerTrafficCheck=document.createElement('input');
playerTrafficCheck.type='checkbox';playerTrafficLabel.prepend(playerTrafficCheck);mapDebugOptions.append(playerTrafficLabel);
const playerTrafficStatus=textElement('span','');mapDebugOptions.append(playerTrafficStatus);
playerTrafficCheck.onchange=()=>{playerTrafficStatus.textContent='';void viewer?.setPlayerTrafficEnabled(playerTrafficCheck.checked).catch(error=>{playerTrafficCheck.checked=false;playerTrafficStatus.textContent=String(error instanceof Error?error.message:error);});};
const trafficRestart=textElement('button','Respawn traffic around player');trafficRestart.setAttribute('type','button');
trafficRestart.onclick=()=>{void viewer?.restartTrafficTest();};mapDebugOptions.append(trafficRestart);
const trafficFind=textElement('button','Inspect traffic');trafficFind.setAttribute('type','button');trafficFind.onclick=()=>{viewer?.focusTrafficTest();observerCheck.checked=true;};mapDebugOptions.append(trafficFind);
const trafficHit=textElement('button','Test traffic impact');trafficHit.setAttribute('type','button');trafficHit.onclick=()=>viewer?.impactTrafficTest();mapDebugOptions.append(trafficHit);
for (const [layer, title] of [['terrain', 'Support surfaces'], ['walls', 'Side faces'], ['boxes', 'CFG boxes']] as const) {
  const label = textElement('label', title), input = document.createElement('input'); input.type = 'checkbox';
  input.onchange = () => viewer?.showMapDebug(layer, input.checked);
  label.prepend(input); mapDebugOptions.append(label); mapDebugChecks.push(input);
}
const vehicleFramesLabel = textElement('label', 'Vehicle bounds: parts + chassis'), vehicleFramesCheck = document.createElement('input');
vehicleFramesLabel.title = 'Green: chassis collision hull. Amber: body geometry AABB. Cyan: mechanical geometry AABB. Effects are excluded.'; vehicleFramesCheck.type = 'checkbox'; vehicleFramesLabel.prepend(vehicleFramesCheck); mapDebugOptions.append(vehicleFramesLabel);
const bodyVisibleLabel = textElement('label', 'Show body shell'), bodyVisibleCheck = document.createElement('input');
bodyVisibleCheck.type = 'checkbox'; bodyVisibleCheck.checked = true; bodyVisibleLabel.prepend(bodyVisibleCheck); mapDebugOptions.append(bodyVisibleLabel);
const suspensionBonesLabel=textElement('label','Suspension bone animation'),suspensionBonesCheck=document.createElement('input');
suspensionBonesCheck.type='checkbox';suspensionBonesCheck.checked=true;suspensionBonesLabel.prepend(suspensionBonesCheck);mapDebugOptions.append(suspensionBonesLabel);
suspensionBonesLabel.title='Original spring and damper bone deformation. Disable to use the cheaper ordinary meshes; suspension physics stays unchanged.';
suspensionBonesCheck.onchange=()=>viewer?.setSuspensionBonesEnabled(suspensionBonesCheck.checked);
const inertialCameraLabel = textElement('label', 'Inertial chase camera'), inertialCameraCheck = document.createElement('input');
inertialCameraCheck.type = 'checkbox'; inertialCameraLabel.prepend(inertialCameraCheck); mapDebugOptions.append(inertialCameraLabel);
inertialCameraLabel.title = 'Experimental external camera with its own velocity and smooth catch-up; cockpit views stay unchanged';
inertialCameraCheck.onchange = () => viewer?.setInertialCameraEnabled(inertialCameraCheck.checked);
const minimapModeLabel=textElement('label','Minimap mode'),minimapModeSelect=document.createElement('select');minimapModeSelect.setAttribute('aria-label','Minimap mode');
for(const [value,label] of [['java','Java / original'],['north','North up'],['heading','Follow heading']]){const option=document.createElement('option');option.value=value;option.textContent=label;minimapModeSelect.append(option);}minimapModeSelect.onchange=()=>{minimapMode=minimapModeSelect.value as NavigatorMode;if(activeNavigator)activeNavigator.mode=minimapMode;};minimapModeLabel.append(minimapModeSelect);mapDebugOptions.append(minimapModeLabel);
const minimapZoomLabel=textElement('label','Minimap scale'),minimapZoomInput=document.createElement('input'),minimapZoomValue=textElement('span',`×${minimapZoomScale.toFixed(2)}`);
minimapZoomInput.type='range';minimapZoomInput.min='.25';minimapZoomInput.max='12';minimapZoomInput.step='.05';minimapZoomInput.value=String(minimapZoomScale);minimapZoomInput.setAttribute('aria-label','Minimap scale');
minimapZoomLabel.title='Higher values zoom in. ×1 uses the scale requested by Java.';
minimapZoomInput.oninput=()=>{minimapZoomScale=Number(minimapZoomInput.value);minimapZoomValue.textContent=`×${minimapZoomScale.toFixed(2)}`;if(activeNavigator)activeNavigator.zoomScale=minimapZoomScale;};
minimapZoomInput.onchange=()=>{try{localStorage.setItem('slrr-minimap-zoom-scale',String(minimapZoomScale));}catch{/* Live adjustment remains available without storage. */}};
minimapZoomLabel.append(minimapZoomInput,minimapZoomValue);mapDebugOptions.append(minimapZoomLabel);
const fogLabel = textElement('label', 'Fog'), fogCheck = document.createElement('input');
fogCheck.type = 'checkbox'; fogCheck.checked = true; fogLabel.prepend(fogCheck); mapDebugOptions.append(fogLabel);
const shadowsLabel = textElement('label', 'Dynamic shadows'), shadowsCheck = document.createElement('input');
shadowsCheck.type = 'checkbox'; shadowsCheck.checked = true; shadowsLabel.prepend(shadowsCheck); mapDebugOptions.append(shadowsLabel);
shadowsLabel.title = 'Dynamic sun shadows from vehicle parts only. Static map shadows use Baked lightmaps.';
shadowsCheck.onchange = () => viewer?.setShadowMapsEnabled(shadowsCheck.checked);
const bakedLightmapsLabel = textElement('label', 'Baked lightmaps'), bakedLightmapsCheck = document.createElement('input');
bakedLightmapsCheck.type = 'checkbox'; bakedLightmapsCheck.checked = true; bakedLightmapsLabel.prepend(bakedLightmapsCheck); mapDebugOptions.append(bakedLightmapsLabel);
bakedLightmapsLabel.title = 'Authored SCX lighting; surfaces without a lightmap use cached static-map shadows. Independent of dynamic shadows.';
bakedLightmapsCheck.onchange = () => viewer?.setBakedLightmapsEnabled(bakedLightmapsCheck.checked);
const reflectionsLabel = textElement('label', 'Real reflections'), reflectionsCheck = document.createElement('input');
reflectionsCheck.type = 'checkbox'; reflectionsLabel.prepend(reflectionsCheck); mapDebugOptions.append(reflectionsLabel);
reflectionsLabel.title = 'Local 128px cubemap around the car, refreshed four times per second (additional GPU cost)';
reflectionsCheck.onchange = () => viewer?.setRealReflectionsEnabled(reflectionsCheck.checked);
const lightingLabel = textElement('label', 'Dynamic lighting'), lightingCheck = document.createElement('input');
lightingCheck.type = 'checkbox'; lightingCheck.checked = true; lightingLabel.prepend(lightingCheck); mapDebugOptions.append(lightingLabel);
lightingLabel.title = 'Sun and ambient illumination; disable to inspect original texture colors';
lightingCheck.onchange = () => viewer?.setDynamicLightingEnabled(lightingCheck.checked);
const vertexColorsLabel = textElement('label', 'Vertex colors (experimental)'), vertexColorsCheck = document.createElement('input');
vertexColorsCheck.type = 'checkbox'; vertexColorsCheck.checked = true; vertexColorsLabel.prepend(vertexColorsCheck); mapDebugOptions.append(vertexColorsLabel);
vertexColorsLabel.title = 'SCX vertex RGB; facade paint materials use texture alpha to preserve windows. Original blending semantics remain experimental.';
vertexColorsCheck.onchange = () => viewer?.setVertexColorsEnabled(vertexColorsCheck.checked);
mapDebugPanel.append(mapDebugOptions); el('scene-help').before(mapDebugPanel);
const streamRangeLabel = document.createElement('label'); streamRangeLabel.className = 'map-stream-range';
const streamRangeValue = textElement('span', ''), streamRangeInput = document.createElement('input');
streamRangeInput.type = 'range'; streamRangeInput.min = '200'; streamRangeInput.max = '2000'; streamRangeInput.step = '50';
streamRangeInput.value = String(viewer?.streamRange ?? 500);
streamRangeInput.setAttribute('aria-label', 'Streaming radius in meters');
const updateStreamRange = () => {
  const value = Number(streamRangeInput.value);
  streamRangeValue.textContent = `Streaming radius: ${value} m`;
  viewer?.setMapStreamRange(value);
};
streamRangeInput.oninput = updateStreamRange;
streamRangeLabel.append(streamRangeValue, streamRangeInput); mapDebugPanel.append(streamRangeLabel);
updateStreamRange();
const softBodyLabel = textElement('label', 'Soft-body solver'); softBodyLabel.className = 'map-stream-range';
const softBodySelect = document.createElement('select'); softBodySelect.setAttribute('aria-label', 'Soft-body solver');
for (const [value, title] of [['auto', 'Auto (prefer C++ / WASM)'], ['ts', 'TypeScript'], ['wasm', 'C++ / WASM (TS fallback)']] as const) {
  const option = document.createElement('option'); option.value = value; option.textContent = title; softBodySelect.append(option);
}
softBodySelect.onchange = () => { softBodyRuntime.preference = softBodySelect.value as SoftBodyBackend; };
softBodyLabel.append(softBodySelect); mapDebugPanel.append(softBodyLabel);
const suspensionDebugPanel = document.createElement('details');
suspensionDebugPanel.append(textElement('summary', 'Suspension alignment (visual debug)'));
suspensionDebugPanel.append(textElement('p', 'Base suspension: height +0.140 m; front attachments 0.055 m inward, rear 0.075 m outward. Sliders add visual offsets (zero keeps the base placement). Arm controls are independent and mirrored: positive X moves outward. Meters / degrees, XYZ order.'));
const suspensionSettings = defaultSuspensionDebug();
let suspensionSteer: number | undefined;
const suspensionInputs: { key: keyof SuspensionDebugSettings; axis: number; range: HTMLInputElement; number: HTMLInputElement }[] = [];
const suspensionValues = document.createElement('textarea'); suspensionValues.readOnly = true; suspensionValues.rows = 8;
suspensionValues.setAttribute('aria-label', 'Suspension debug values to share');
const updateSuspensionDebug = () => {
  viewer?.setSuspensionDebug(suspensionSettings);
  if (viewer) viewer.calibrationSteering = suspensionSteer;
  suspensionValues.value = JSON.stringify({ ...suspensionSettings, steeringInput: suspensionSteer ?? null }, null, 2);
};
for (const [key, title] of [
  ['frontLeftAttachmentOffset', 'Front left attachment offset'], ['frontRightAttachmentOffset', 'Front right attachment offset'],
  ['rearLeftAttachmentOffset', 'Rear left attachment offset'], ['rearRightAttachmentOffset', 'Rear right attachment offset'],
  ['rearRotation', 'Rear control arm rotation'], ['rearShaftRotation', 'Rear CV shaft rotation'],
  ['rearLeftArmOffset', 'Left rear arm offset'], ['rearLeftArmRotation', 'Left rear arm rotation'],
  ['rearRightArmOffset', 'Right rear arm offset'], ['rearRightArmRotation', 'Right rear arm rotation'],
  ['frontLeftWheelOffset', 'Front left wheel offset'], ['frontRightWheelOffset', 'Front right wheel offset'],
  ['rearLeftWheelOffset', 'Rear left wheel offset'], ['rearRightWheelOffset', 'Rear right wheel offset'],
] as const) {
  suspensionDebugPanel.append(textElement('strong', title));
  const rotation = key.includes('Rotation');
  for (let axis = 0; axis < 3; axis++) {
    const label = document.createElement('label'); label.className = 'suspension-debug-axis';
    const range = document.createElement('input'), number = document.createElement('input');
    range.type = 'range'; number.type = 'number';
    for (const input of [range, number]) {
      input.min = rotation ? '-180' : '-0.5'; input.max = rotation ? '180' : '0.5';
      input.step = rotation ? '1' : '0.005'; input.value = '0';
      input.setAttribute('aria-label', `${title} ${'XYZ'[axis]} (${rotation ? 'degrees' : 'meters'})`);
    }
    const change = (input: HTMLInputElement) => {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
      const value = Math.max(Number(input.min), Math.min(Number(input.max), input.valueAsNumber));
      suspensionSettings[key][axis] = value; range.value = number.value = String(value); updateSuspensionDebug();
    };
    range.oninput = () => change(range); number.oninput = () => change(number);
    label.append(textElement('span', `${'XYZ'[axis]} ${rotation ? '°' : 'm'}`), range, number);
    suspensionDebugPanel.append(label); suspensionInputs.push({ key, axis, range, number });
  }
}
const steeringLabel = document.createElement('label'); steeringLabel.className = 'map-stream-range';
const steeringReadout = textElement('span', 'Garage steering: script controlled');
const steeringRange = document.createElement('input'); steeringRange.type = 'range';
steeringRange.min = '-1'; steeringRange.max = '1'; steeringRange.step = '0.01'; steeringRange.value = '0';
steeringRange.setAttribute('aria-label', 'Garage vehicle steering');
steeringRange.oninput = () => {
  suspensionSteer = Number(steeringRange.value);
  steeringReadout.textContent = `Garage steering: ${suspensionSteer.toFixed(2)}`;
  updateSuspensionDebug();
};
const steeringRestore = textElement('button', 'Restore script steering');
steeringRestore.onclick = () => {
  suspensionSteer = undefined; steeringRange.value = '0'; steeringReadout.textContent = 'Garage steering: script controlled'; updateSuspensionDebug();
};
steeringLabel.append(steeringReadout, steeringRange, steeringRestore); suspensionDebugPanel.append(steeringLabel);
const suspensionReset = textElement('button', 'Reset suspension alignment');
const hubGeometryLabel = textElement('label', 'Experimental hub geometry'), hubGeometryCheck = document.createElement('input');
hubGeometryCheck.type = 'checkbox'; hubGeometryLabel.prepend(hubGeometryCheck);
hubGeometryLabel.title = 'Test native arm-circle and hub modes 0/-1. Unsupported corners use the existing pose. Driving forces are unchanged.';
hubGeometryCheck.onchange = () => viewer?.setExperimentalHubGeometry(hubGeometryCheck.checked);
suspensionDebugPanel.append(hubGeometryLabel);
const suspensionHeightPreset = textElement('button', 'Use base height (+0.140 m)');
suspensionHeightPreset.onclick = () => {
  suspensionSettings.frontOffset[1] = suspensionSettings.rearOffset[1] = 0;
  for (const offset of [suspensionSettings.frontLeftAttachmentOffset, suspensionSettings.frontRightAttachmentOffset,
    suspensionSettings.rearLeftAttachmentOffset, suspensionSettings.rearRightAttachmentOffset]) offset[1] = 0;
  for (const { key, axis, range, number } of suspensionInputs)
    range.value = number.value = String(suspensionSettings[key][axis]);
  updateSuspensionDebug();
};
suspensionReset.onclick = () => {
  Object.assign(suspensionSettings, defaultSuspensionDebug());
  suspensionSteer = undefined; steeringRange.value = '0'; steeringReadout.textContent = 'Garage steering: script controlled';
  for (const { range, number } of suspensionInputs) range.value = number.value = '0';
  updateSuspensionDebug();
};
suspensionDebugPanel.append(suspensionHeightPreset, suspensionReset, suspensionValues); mapDebugPanel.append(suspensionDebugPanel);
updateSuspensionDebug();
let mapDebugSession: ReturnType<Viewer['drive']> | undefined;
vehicleFramesCheck.onchange = () => mapDebugSession?.vehicleFrames(vehicleFramesCheck.checked);
bodyVisibleCheck.onchange = () => mapDebugSession?.bodyVisible(bodyVisibleCheck.checked);
fogCheck.onchange = () => viewer?.setMapFogEnabled(fogCheck.checked);
const showMapDebugControls = (map?: { terrain: { faces: number }; collision: { walls: number; boxes: number } }) => {
  mapDebugPanel.hidden = false; mapDebugPanel.open = false;
  for (const input of mapDebugChecks) input.checked = false;
  roadDebugStatus.textContent='';
  pedestrianDebugStatus.textContent='';pedestrianCrowdStatus.textContent='';
  vehicleFramesCheck.checked = false; bodyVisibleCheck.checked = true;
  if (map) mapDebugData.textContent = `Support triangles: ${map.terrain.faces.toLocaleString()}\nCollision walls: ${map.collision.walls.toLocaleString()}\nCFG collision boxes: ${map.collision.boxes.toLocaleString()}`;
};
const vehicleDebugPanel = document.createElement('details'); vehicleDebugPanel.className = 'vehicle-debug-panel'; vehicleDebugPanel.hidden = true;
vehicleDebugPanel.append(textElement('summary', 'Vehicle runtime · physics / Java'));
const vehicleTeleportButton = textElement('button', 'Move car to (0, 1, 0)');
vehicleTeleportButton.title = 'Teleport the car to the city center and reset its motion';
vehicleTeleportButton.onclick = () => mapDebugSession?.teleport(new Vector3(0, 1, 0), 0);
vehicleDebugPanel.append(vehicleTeleportButton);
const telemetryStart = textElement('button', 'Start physics recording') as HTMLButtonElement;
const telemetryStop = textElement('button', 'Stop & download telemetry') as HTMLButtonElement;
const telemetryDownload = textElement('button', 'Download last recording') as HTMLButtonElement;
const routeDownload = textElement('button', 'Download route benchmark') as HTMLButtonElement;
routeDownload.disabled=true;
const telemetryStatus = textElement('p', 'Physics recording off · 100 ms interval');
vehicleDebugPanel.append(telemetryStart, telemetryStop, telemetryDownload, routeDownload, telemetryStatus);
let lastRouteRecording:string|undefined;
function downloadText(text:string,filename:string,type='application/json'){
  downloadBlob(new Blob([text],{type}),filename);
}
function downloadBlob(blob:Blob,filename:string){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
routeDownload.onclick=()=>{if(lastRouteRecording)downloadText(lastRouteRecording,`slrr-route-${Date.now()}.json`);};
let recordingRequested = false;
let lastDriveRecording: { text: string; filename: string } | undefined;
const downloadDriveRecording = () => {
  if (!lastDriveRecording) return;
  const url = URL.createObjectURL(new Blob([lastDriveRecording.text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = lastDriveRecording.filename;
  document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function finishDriveRecording(reason: string) {
  if (!recordingRequested) return;
  recordingRequested = false;
  const recorder = mapDebugSession?.telemetry;
  if (!recorder) return;
  recorder.stop(reason);
  lastRouteRecording=recorder.benchmarkText();routeDownload.disabled=!lastRouteRecording;
  lastDriveRecording = { text: recorder.text(), filename: `slrr-remaster-physics-${new Date().toISOString().replace(/[:.]/g,'-')}.txt` };
  telemetryStatus.textContent = `Saved ${recorder.status.samples} samples · ${recorder.status.seconds.toFixed(1)} s · ${recorder.status.reason}`;
  telemetryStart.disabled = !recorder.status.available; telemetryStop.disabled = true; telemetryDownload.disabled = false;
  downloadDriveRecording();
}
telemetryStart.onclick = () => {
  const recorder = mapDebugSession?.telemetry;
  if (!recorder?.status.available) return;
  recorder.start({...mapDebugSession!.telemetryContext(),viewport_expanded:Number(document.body.classList.contains('viewport-expanded')),diagnostic_panels_suspended:1}); recordingRequested = true;
  mapDebugSession!.focusControls();
  telemetryStart.disabled = true; telemetryStop.disabled = false;
  telemetryStatus.textContent = 'Recording physics · CPU timing every frame · diagnostic panels paused';
  vehicleDebugTelemetry.textContent='Detailed panels paused during capture; per-frame CPU timing remains active.';
};
telemetryStop.onclick = () => finishDriveRecording('button');
telemetryDownload.onclick = downloadDriveRecording;
const vehicleDebugTelemetry = textElement('pre', '', 'vehicle-debug-telemetry'), vehicleDebugTree = textElement('pre', '', 'vehicle-debug-tree');
vehicleDebugPanel.append(vehicleDebugTelemetry, vehicleDebugTree); el('scene-help').before(vehicleDebugPanel);
let vehicleDebugTimer: number | undefined;
function showVehicleDebug(root: EnginePart, session: ReturnType<Viewer['drive']>, javaLoop?: () => string) {
  clearVehicleDebug(); mapDebugSession = session; vehicleDebugPanel.hidden = false; vehicleDebugPanel.open = true;
  const tree = (part: EnginePart, depth = 0): string[] => {
    const prefix = depth === 0 ? '' : `${'  '.repeat(depth - 1)}├─ `;
    const slot = part.parentSlot === undefined ? 'root' : `slot ${part.parentSlot}`;
    const row = `${prefix}${part.definition.alias} [0x${part.definition.key.id.toString(16)}] · ${slot} · wear ${Math.round(part.condition * 100)}%`;
    return [row, ...[...part.children.values()].flatMap(child => tree(child, depth + 1))];
  };
  let lastRecordingUi=-Infinity;
  const refreshCore = () => {
    const recording = session.telemetry?.status;
    if (recordingRequested && !recording?.recording) finishDriveRecording(recording?.reason || 'session_ended');
    if(recording?.recording){
      const now=performance.now();if(now-lastRecordingUi<1000)return;lastRecordingUi=now;
    }
    telemetryStart.disabled = !recording?.available || !!recording?.recording;
    telemetryStop.disabled = !recording?.recording; telemetryDownload.disabled = !lastDriveRecording;
    if (recording?.recording) telemetryStatus.textContent = `Recording physics · ${recording.samples} samples · ${recording.frames} CPU frames · ${recording.seconds.toFixed(1)} s`;
    if(recording?.recording)return; // CPU samples continue; detailed panels resume after capture.
    if(!vehicleDebugPanel.open)return;
    const state = session.diagnostics();
    vehicleDebugTelemetry.textContent = [
      `FPS ${viewer?.fps ?? 0}`,
      ...(viewer?.profiler.lines() ?? []),
      ...(viewer?.streamInfo ? [viewer.streamInfo] : []),
      ...(viewer?.physicsWork ? [viewer.physicsWork] : []),
      ...(javaLoop ? [javaLoop()] : []),
      `Position (m) X ${state.position.x.toFixed(1)} · Y ${state.position.y.toFixed(1)} · Z ${state.position.z.toFixed(1)}`,
      `Speed ${state.speedKmh} km/h · RPM ${state.rpm} · gear ${state.gear < 0 ? 'R' : state.gear || 'N'}`,
      `Engine ${state.engineStarting ? 'starter' : state.engineRunning ? `${Math.round(state.enginePower * 100)}%` : 'stalled · throttle to start'} · boost ${state.boost.toFixed(2)} bar · slip ${Math.round(state.wheelSlip * 100)}%`,
      `Wheels on ground ${state.wheelContacts}/4 · chassis ${state.chassis}% · block ${state.engineBlock}% · transmission avg ${state.transmission}% · parts ${state.parts.length}`,
    ].join('\n');
    vehicleDebugTree.textContent = tree(root).join('\n');
  };
  const refresh=()=>viewer?.profiler.measure('Vehicle debug UI CPU',refreshCore);
  refresh(); vehicleDebugTimer = window.setInterval(refresh, 200);
}
function clearVehicleDebug() {
  finishDriveRecording('scene_change');
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
if (storedTires?.model === 'legacy' || storedTires?.model === 'sl2') tireSettings.model = storedTires.model;
const modelLabel = textElement('label', 'Tire solver'), modelCheck = document.createElement('select');
for (const [value,label] of [['sl2','Original SL2 (Java WheelRef)'],['pacejka','Tunable Pacejka'],['legacy','Legacy']]) { const option=document.createElement('option'); option.value=value; option.textContent=label; modelCheck.append(option); }
modelCheck.value=tireSettings.model; modelLabel.append(modelCheck); tireControls.append(modelLabel);
const tireSliders: { input: HTMLInputElement; output: HTMLOutputElement; axis: 'longitudinal' | 'lateral'; parameter: 'B' | 'C' | 'D' | 'E' }[] = [];
const updateTireModel = () => { tireSettings.model = modelCheck.value as TireModelSettings['model']; tirePanel.querySelector('summary')!.textContent = `Tire model · ${modelCheck.selectedOptions[0].textContent}`; try { localStorage.setItem(tireStorageKey, JSON.stringify(tireSettings)); } catch { /* Live tuning still works without storage. */ } crashSession?.tireModel(tireSettings); };
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
resetTires.onclick = () => { Object.assign(tireSettings, structuredClone(DEFAULT_TIRE_MODEL)); modelCheck.value = DEFAULT_TIRE_MODEL.model; for (const { input, output, axis, parameter } of tireSliders) { input.value = String(tireSettings[axis][parameter]); output.value = Number(input.value).toFixed(2); } updateTireModel(); };
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
for(const [scenario,label] of [['offset','Two cars · 50% overlap · 50 km/h each'],['side','Side impact · 50 km/h'],['rear-chain','Barrier · A 50 / B 100 km/h · 1 s following gap']] as const){
  const button=textElement('button',label);button.onclick=()=>void openVehiclePairTest(scenario);crashControls.append(button);
}
const drivingHelping:DrivingHelping={...DEFAULT_DRIVING_HELPING};
try{
  const saved=JSON.parse(localStorage.getItem('slrr-driving-helping')??'{}');
  for(const key of ['brake','steer','clutch','acceleration','abs'] as const)
    if((key!=='steer'||saved.version>=2)&&(key!=='clutch'||saved.version>=3)&&Number.isFinite(saved[key])&&saved[key]>=0&&saved[key]<=1)drivingHelping[key]=saved[key];
}catch{}
for(const [key,title,description] of [
  ['brake','Break helping','Opens the clutch during heavy braking near stall RPM above 20 km/h; full assistance from 30 km/h.'],
  ['steer','Steer helping','Slows button steering as vehicle speed increases. Analogue steering is unchanged.'],
  ['clutch','Clutch helping','Opens the clutch near idle at low speed and progressively reconnects during acceleration.'],
  ['acceleration','Acceleration helping','Simulates launch control: reduces accelerator demand when driven wheels spin during a fast start.'],
  ['abs','ABS','Reduces service braking on a wheel approaching lock-up. Does not control the handbrake.'],
] as const){
  const label=textElement('label',title),input=document.createElement('input'),output=document.createElement('output');
  label.className='crumple-control';input.type='range';input.min='0';input.max='1';input.step='0.01';input.value=String(drivingHelping[key]);
  input.setAttribute('aria-label',title);output.value=drivingHelping[key].toFixed(2);label.title=description+' Set 0 to disable.';
  label.append(input,output);mapDebugOptions.append(label);
  input.oninput=()=>{
    drivingHelping[key]=Number(input.value);output.value=drivingHelping[key].toFixed(2);viewer?.setDrivingHelping(drivingHelping);
    try{localStorage.setItem('slrr-driving-helping',JSON.stringify({...drivingHelping,version:3}));}catch{}
  };
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
const benchmarkPanel=document.createElement('details');benchmarkPanel.className='route-benchmark-panel';
benchmarkPanel.append(textElement('summary','Route benchmark'));
const routeFile=document.createElement('input');routeFile.type='file';routeFile.accept='.json,application/json';
const routeMode=document.createElement('select');
const routeProfileLabel=textElement('label','Map render profile'),routeProfile=document.createElement('select');
for(const [value,label] of [['optimized','Optimized'],['baseline','Baseline']]){const option=document.createElement('option');option.value=value;option.textContent=label;routeProfile.append(option);}
routeProfileLabel.append(routeProfile);
routeProfile.onchange=()=>{tightFrustumCheck.checked=routeProfile.value==='optimized';};
for(const [value,label] of [['render','Render recorded route'],['physics','Physics along route (100 ms sync)'],['free-physics','Free physics controls (stop at 2 m drift)']]){
  const option=document.createElement('option');option.value=value;option.textContent=label;routeMode.append(option);
}
const routeRun=textElement('button','Run benchmark') as HTMLButtonElement,routeStop=textElement('button','Stop') as HTMLButtonElement;
const routeLoopLabel=textElement('label','Loop'),routeLoop=document.createElement('input');routeLoop.type='checkbox';routeLoopLabel.prepend(routeLoop);
routeLoopLabel.title='Repeat without reloading the map. Reports cover one completed lap; Stop or Preview frame ends playback. Physics drift failures do not repeat.';
const routeReport=textElement('button','Download benchmark report') as HTMLButtonElement,routeStatus=textElement('p','Load a recorded route JSON. Original game assets must be mounted.');
const routeLiveMetrics=textElement('pre','','map-debug-data');
const routeSeekLabel=textElement('label','Preview time (s)'),routeSeekInput=document.createElement('input');
routeSeekInput.type='number';routeSeekInput.min='0';routeSeekInput.step='.1';routeSeekInput.value='0';routeSeekInput.style.width='70px';routeSeekLabel.append(routeSeekInput);
const routeSeek=textElement('button','Preview frame') as HTMLButtonElement,routeScreenshot=textElement('button','Download preview screenshot') as HTMLButtonElement;
routeSeek.disabled=true;routeScreenshot.disabled=true;
routeSeek.onclick=()=>{if(!routePreviewSession)return;routePreviewSession.seek(Number(routeSeekInput.value));routeReport.disabled=true;routeScreenshot.disabled=false;};
routeScreenshot.onclick=async()=>{if(!viewer)return;try{downloadBlob(await viewer.captureFrame(),`slrr-route-frame-${routeSeekInput.value}-${Date.now()}.png`);}catch(error){routeStatus.textContent=String(error);}};
routeRun.disabled=true;routeReport.disabled=true;
benchmarkPanel.append(routeFile,routeMode,routeProfileLabel,routeRun,routeStop,routeLoopLabel,routeReport,routeSeekLabel,routeSeek,routeScreenshot,routeStatus,routeLiveMetrics);el('viewport').after(benchmarkPanel);
let loadedRoute:RouteBenchmark|undefined,lastRouteReport:string|undefined;
routeFile.onchange=async()=>{
  try{const file=routeFile.files?.[0];if(!file)return;if(file.size>100*1024*1024)throw Error('Route exceeds 100 MiB');
    loadedRoute=parseRouteBenchmark(await file.text());routeRun.disabled=false;mapDebugPanel.hidden=false;routeStatus.textContent=`${loadedRoute.metadata.map_pack} · ${loadedRoute.poses.at(-1)!.t.toFixed(1)} s · ready`;
  }catch(error){loadedRoute=undefined;routeRun.disabled=true;routeStatus.textContent=String(error);}
};
routeStop.onclick=()=>{++sequence;stopDrive();routeStatus.textContent='Stopped';};
routeReport.onclick=()=>{if(lastRouteReport)downloadText(lastRouteReport,`slrr-route-result-${Date.now()}.json`);};
routeRun.onclick=async()=>{
  if(!loadedRoute||!viewer||!assets)return;
  const route=loadedRoute,request=++sequence;routeRun.disabled=true;routeReport.disabled=true;
  stopDrive();disposeJavaInput?.();disposeJavaInput=undefined;disposeGameBoot?.();disposeGameBoot=undefined;
  viewer.setMapRenderProfile(routeProfile.value==='optimized',tightFrustumCheck.checked);
  disposeGameOsd?.();disposeGameOsd=undefined;viewer.setJavaSceneCamera(undefined);
  disposeMemoryLab?.();disposeMemoryLab=undefined;viewer.clear();engineRoot=undefined;engineWorld?.dispose();engineWorld=undefined;
  try{
    const built=restoreRouteVehicle(route.vehicle);engineWorld=built.world;engineRoot=built.root;
    await softBodyReady;
    await viewer.showWorld(built.world,assets);
    if(request!==sequence)return;
    const map=await viewer.showMap(String(route.metadata.map_pack),assets,(done,total)=>{routeStatus.textContent=`Loading map ${done}/${total}`;},true);
    if(request!==sequence)return;
    await viewer.restoreRouteEnvironment(route.metadata,assets);
    if(request!==sequence)return;
    showMapDebugControls(map);el('viewport').hidden=false;el('inspector').hidden=true;
    setViewportExpanded(route.metadata.viewport_expanded===undefined||!!Number(route.metadata.viewport_expanded));
    el('filename').textContent=`Route benchmark · ${route.metadata.map_pack}`;
    el('java-run-state').textContent='Java stopped for standalone route benchmark';
    benchmarkRunning=true;
    el('viewport').parentElement?.classList.add('route-benchmark-active');
    routePreviewSession=viewer.playRouteBenchmark(built.root,route,map,routeMode.value as RouteMode,message=>{routeStatus.textContent=message;},(report,looping)=>{
      benchmarkRunning=!!looping;lastRouteReport=report;routeReport.disabled=false;routeSeekInput.value=String(route.poses.at(-1)!.t);routeScreenshot.disabled=false;
    },()=>routeLoop.checked);
    disposeDriving=routePreviewSession;routeSeek.disabled=false;routeSeekInput.max=String(route.poses.at(-1)!.t);
    el('details').textContent='Benchmark runs directly in the host engine. Java game loops, input polling and OSD are stopped. Use Restart Java to return to the game.';
  }catch(error){benchmarkRunning=false;routeStatus.textContent=String(error);viewer.clear();}
  finally{routeRun.disabled=!loadedRoute;}
};
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
    el('scene-help').textContent = 'Start in neutral: E first gear, Q reverse, N neutral · W/S throttle/reverse · A/D steer · B brake · Space handbrake · Shift clutch · I restart engine · R reset to start';
    el('details').textContent = `${map.loaded} map models · ${map.objects} RDB/CFG objects · ${map.collision.boxes} collision boxes · ${map.terrain.faces} support triangles. The start position comes from the quarter-mile straight in TestTrack.java. Placed objects use original RDB positions and CFG box shapes; the remaining map collision currently comes from SCX.`;
    status('Driving on Test Track');
  } catch (error) { if (request === sequence) { stopDrive(); viewer.clear(); status('Drive unavailable', true); el('details').textContent = String(error); } }
};
mapButton.onclick = () => {void previewMap('maps/test_track.rpk');};
async function previewMap(packPath:string,groundId?:number) {
  if (!assets || !viewer) return;
  const request = ++sequence;
  stopDrive(); engineRoot = undefined; engineWorld?.dispose(); engineWorld = undefined;
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  el('filename').textContent = `${packPath} · original geometry`; el('format').textContent = 'MAP / WEBGL';
  status('Loading map…'); el('details').textContent = `Reading SCX and textures from ${packPath}…`;
  try {
    const result = await viewer.showMap(packPath, assets, (done, total) => {
      if (request === sequence) status(`Track ${done}/${total}`);
    },false,{groundId});
    if (request !== sequence) return;
    showMapDebugControls(result);
    el('details').textContent = `${result.loaded}/${result.total} models · ${result.objects} placed RDB/CFG objects · ${result.triangles.toLocaleString('en-US')} map triangles. Geometry and textures come from the original RPK/SCX; objects use RDB coordinates. Road collision is still approximate.\n${result.warnings.slice(0, 12).join('\n')}`;
    status(result.loaded ? 'Track loaded' : 'No geometry', !result.loaded);
  } catch (error) { if (request === sequence) { viewer.clear(); status('Map error', true); el('details').textContent = String(error); } }
}
function stopDrive() {
  vinControls.hidden=true;clearInterval(vinTimer);vinTimer=undefined;
  pairControls.hidden=true;
  benchmarkRunning=false;
  routePreviewSession=undefined;routeSeek.disabled=true;routeScreenshot.disabled=true;
  el('viewport').parentElement?.classList.remove('route-benchmark-active');
  disposeJavaScene?.(); disposeJavaScene = undefined;
  const wasTrackDriving = trackDriving;
  disposeOsdMenu?.(); disposeOsdMenu = undefined;
  trackDriving = false; setViewportExpanded(false);
  el('viewport').parentElement?.classList.remove('physics-scene');
  mapDebugPanel.hidden = true;
  tirePanel.hidden = true;
  enginePanel.hidden = true;
  // Stop physics while its EngineWorld is still alive. Several disposal callbacks
  // refer to crashSession, so clearing it first left the old viewer session running.
  const stopCrash=crashSession;crashSession=undefined;stopCrash?.();
  crashControls.hidden = true; driveHud.classList.remove('crash-hud');
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
async function openVehiclePairTest(scenario:'offset'|'side'|'rear-chain') {
  if(!assets||!viewer)return;
  const source=assets;let request=sequence;
  let other:Awaited<ReturnType<PartFactory['stock']>>|undefined;
  try{
    const opening=openWorld('cars/racers/Baiern.rpk',6);request=sequence;
    await opening;if(request!==sequence||!engineRoot||!viewer)return;
    status('Assembling second car…');
    other=await new PartFactory(source).stock({pack:'cars/racers/Baiern.rpk',id:6},{mechanical:true});
    if(request!==sequence){other.world.dispose();return;}
    await viewer.showWorld(other.world,source,true);
    if(request!==sequence){viewer.removeWorld(other.world);other.world.dispose();return;}
    beforeDrivingDetails=el('details').textContent??'';
    const second=other,session=viewer.vehiclePair([engineRoot,second.root],scenario,text=>{driveHud.textContent=text;});
    session.chassisCrumple(Number(crumpleSlider.value));
    disposeDriving=()=>{session();viewer?.removeWorld(second.world);second.world.dispose();};
    pairControls.replaceChildren();
    for(const [label,action] of [
      ['Restart same collision',()=>session.reset()],
      ['50% overlap',()=>void openVehiclePairTest('offset')],
      ['Side impact',()=>void openVehiclePairTest('side')],
      ['Barrier + rear hit',()=>void openVehiclePairTest('rear-chain')],
      ['Car and obstacle',()=>crashButton.click()],
    ] as const){const button=textElement('button',label);button.onclick=action;pairControls.append(button);}
    for(const [label,action] of [['Pause',(value:boolean)=>session.pause(value)],['Slow motion ×0.25',(value:boolean)=>session.slowMotion(value)],['Cages',(value:boolean)=>session.wireframe(value)]] as const){
      const container=textElement('label',label),check=document.createElement('input');check.type='checkbox';check.onchange=()=>action(check.checked);container.prepend(check);pairControls.append(container);
    }
    pairControls.hidden=false;crashControls.hidden=true;driveHud.hidden=false;driveHud.classList.add('crash-hud');driveButton.textContent='End drive';
    el('viewport').parentElement?.classList.add('physics-scene');
    el('filename').textContent=scenario==='offset'?'Baiern ×2 · 50% overlap':scenario==='side'?'Baiern ×2 · side impact':'Baiern ×2 · barrier + following car';el('format').textContent='PHYSICS / TWO VEHICLES';
    el('scene-help').textContent='Left drag: orbit · Wheel: zoom · Right drag: pan · Restart restores both cars';
    el('details').textContent='Both complete CFG cars use 120 Hz suspension, mass, rotation and deformable panels. Offset: each starts at 50 km/h, with 50% body-width overlap. Side: A starts at 50 km/h and hits stationary B at 90 degrees. Chain: both start together toward a barrier, A at 50 km/h and B at 100 km/h, with a 27.8 m bumper-to-bumper gap (one second at B\'s initial speed). Both remain fully dynamic throughout; impact timing follows their motion. Inter-car contact uses chassis OBB hulls; detailed mesh-to-mesh and cross-car debris contacts are not yet implemented.';
    status('Two-car collision test');
  }catch(error){if(other){viewer?.removeWorld(other.world);other.world.dispose();}if(request===sequence){stopDrive();status('Two-car test error',true);el('details').textContent=String(error);}}
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
    el('scene-help').textContent = 'Start in neutral: E first gear, Q reverse, N neutral · W/S throttle/reverse · A/D steer · B brake · Space handbrake · Shift clutch · I restart engine · R restore car';
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
    el('scene-help').textContent = 'W/S or ↑/↓ throttle/reverse · A/D or ←/→ steer · B brake · Space handbrake · R reset car';
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
try { viewer = new Viewer(el('viewport')); viewer.setDrivingHelping(drivingHelping); viewer.setUnifiedBuildingMaterials(unifiedBuildingsCheck.checked); viewer.setGlobalFacadeBatching(globalFacadesCheck.checked); viewer.setTrafficPhysicsRadius(Number(trafficRadiusSlider.value)); viewer.setTrafficSpawnRadius(Number(trafficSpawnSlider.value)); void viewer.setTrafficCount(Number(trafficCountSlider.value)); }
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
  const model = await parseScxAsync(await assets.read(path));
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
          if(entry.type===1&&/^maps[\\/]/i.test(file.path)){
            const preview=textElement('button','Preview map');preview.onclick=()=>{void previewMap(file.path,entry.typeId);};row.append(preview);
          }
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
