import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { JavaNativeRegistry } from 'slrr-jvm';
import { Assets } from '../src/assets';
import { bootGame } from '../src/runtime/game-boot';
import { parseTufa } from '../src/formats/tufa';
import { gameRoot, relativeGamePath, walk } from './game-files';

type Status = 'implemented' | 'mocked' | 'missing';
interface Handler { owner: string; method: string; parameters: string[]; source: string; body: string }
interface Entry { owner: string; method: string; parameters: string[]; result?: string; descriptor?: string;
  declarations: string[]; status: Status; handler?: string; source?: string; note: string }
const leaf = (type: string) => type.replaceAll('/', '.').split('.').at(-1)!;
const key = (owner: string, method: string, parameters: readonly string[]) => `${owner}#${method}(${parameters.map(leaf).join(',')})`;
const handlers = new Map<string, Handler>();

// Capture actual registrations, including loops/aliases; never execute game assets.
const register = JavaNativeRegistry.prototype.register, registerAsync = JavaNativeRegistry.prototype.registerAsync;
function capture(owner: string, method: string, parameters: readonly string[], implementation: unknown) {
  const frame = new Error().stack?.split('\n').find(line => /[\\/]src[\\/]runtime[\\/]/.test(line));
  const location = frame?.match(/[\\/](src[\\/]runtime[\\/][^:()]+\.ts):(\d+)/);
  handlers.set(key(owner, method, parameters), { owner, method, parameters: [...parameters],
    source: location ? location[1].replaceAll('\\', '/') + ':' + location[2] : 'src/runtime/game-boot.ts',
    body: String(implementation) });
}
JavaNativeRegistry.prototype.register = function(owner, method, parameters, implementation) {
  capture(owner, method, parameters, implementation); return register.call(this, owner, method, parameters, implementation);
};
JavaNativeRegistry.prototype.registerAsync = function(owner, method, parameters, implementation) {
  capture(owner, method, parameters, implementation); return registerAsync.call(this, owner, method, parameters, implementation);
};
try {
  const path = 'sl/scripts/game/src/Init.java', source = 'package java.game; class Init extends GameType { Init(int id) {} }';
  const result = await bootGame(new Assets([{path, size:source.length}], async () => new TextEncoder().encode(source)), () => {});
  try { if (result.error) throw result.error; } finally { result.dispose(); }
} finally {
  JavaNativeRegistry.prototype.register = register;
  JavaNativeRegistry.prototype.registerAsync = registerAsync;
}

const notes = new Map<string, {status: Status; note: string}>();
const annotate = (owner: string, methods: string[], status: Status, note: string) => {
  for (const method of methods) notes.set(owner + '#' + method, {status,note});
};
annotate('java.lang.GarbageCollector',['<init>','push','flush'],'mocked','No-op host adapter; no original collector lifecycle. JavaScript manages memory.');
annotate('java.util.resource.ResourceRef',['precache','cache','unload'],'mocked','Logs the call; no original resource-cache operation or explicit unloading.');
annotate('java.util.resource.GroundRef',['getNearestCross'],'implemented','Queries the receiver ground’s cached TRC graph across both crossing pools in 3D. Minimizes abs(distance - requested radius), not a radius cutoff; stable ties keep file order. Returns a fresh Vector3 or null for absent/empty graph. JS double precision; bit-exact original x87 parity is not claimed.');
annotate('java.util.resource.GroundRef',['delTraffic','addTrafficN'],'implemented','Registers/clears per-ground Java model resources and density weights consumed by the host traffic stream (user cap 0–50). Remaining three parameters are preserved but not assigned unverified semantics. addTrafficN returns a host catalogue registration ID; original native ID parity is not claimed.');
annotate('java.util.resource.GroundRef',['addTrafficCar','notifyTrafficCar'],'mocked','Individual Java Bot registration/notification is not bridged to the host traffic population. Logs and returns 0; creates no individual traffic entity or notification subscription.');
annotate('java.util.resource.Animation',['<init>','finalize','setSpeed','setFade','play','loopPlay','pause','seek','getPos'],'implemented','Per-RenderRef skeleton/AnimationMixer bridge loads original matrixdata clips, preserves Java placement and controls playback/lifecycle. Host position is seconds; fade is approximated as fade-in duration. Exact original native timing/blending semantics remain unverified.');
annotate('java.util.resource.GroundRef',['setPedestrianDensityN','addPedestrianType'],'mocked','Accepts/logs the call; no pedestrian simulation.');
annotate('java.util.resource.GroundRef',['setWater','addWaterLimit'],'mocked','Returns void; no water-plane rendering or water bounds.');
annotate('java.util.resource.RenderRef',['lineCreate','lineAdd'],'mocked','lineCreate parents a resource and returns 1, but creates no line geometry. lineAdd discards points. Route/SkidMark native lines are invisible.');
annotate('java.lang.System',['getConfigOptions'],'mocked','Logs and returns void; does not apply the full original system/graphics/FFB configuration.');
annotate('java.lang.System',['gc','runFinalization','compileAll'],'mocked','Returns 0; does not force collection/finalization or compile the original scripts.');
annotate('java.game.Frontend',['init'],'mocked','Logs and returns void. Original frontend initialization is not reproduced by this adapter.');
annotate('java.game.LoadingScreen',['show'],'mocked','Conditional no-op only when original LoadingScreen assets are absent. With assets, the Java loading-screen implementation runs.');
annotate('java.render.GfxEngine',['flush','forceRendering','changeVideoMode'],'mocked','Returns void; no explicit renderer flush, forced synchronous rendering, or OS display-mode change.');
annotate('java.game.Navigator',['updateNavigator'],'mocked','Returns void; the native navigator viewport update is deferred.');
annotate('java.sound.Sound',['init'],'mocked','Logs and returns void; browser audio initialization belongs to host services.');
annotate('java.sound.Sound',['enableDebugDump'],'mocked','Returns 0; no original sound debug dump.');
annotate('java.io.Input',['enablePointingDevice'],'mocked','Logs and returns void; browser pointer events are managed separately.');
annotate('java.io.Input',['initControllers'],'implemented','Partial browser adapter: stores Controller.controlFile; does not initialize original OS device drivers.');
annotate('java.io.Input',['getDeviceName'],'implemented','Browser adapter exposes SysKeyboard/SysMouse; other device indices return null.');
annotate('java.render.GfxEngine',['numDisplayModes','currDisplayMode','displayModeName'],'implemented','Browser adapter exposes one current viewport-sized mode, not OS display enumeration.');
annotate('java.render.GfxEngine',['openVideo','closeVideo','isPlayingVideo'],'implemented','Delegates to OsdVideo when supplied. Without it: openVideo returns 1, isPlayingVideo returns 0, closeVideo has no effect.');
annotate('java.sound.Sound',['changeMusicSet','nextTrack','prevTrack','firstTrack','randomTrack','stopMusic','playTrack','getTotalTracks','getNowPlaying','setVolume','getVolume'],'implemented','Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback.');
annotate('java.lang.GameType',['getInfo'],'implemented','Partial query switch. GII_BONE returns the root resource ID, not an animated bone; unknown query codes throw.');
annotate('java.util.resource.GameRef',['getInfo'],'implemented','Partial query switch. GII_BONE returns the root resource ID, not an animated bone; unknown query codes throw.');
annotate('java.util.resource.PhysicsRef',['setStatic','getVel','getAngVel'],'implemented','Fixed script-created colliders only. setStatic(0) throws; getVel/getAngVel return zero. Standalone dynamic bodies are absent.');
annotate('java.game.parts.bodypart.Chassis',['setWheelDamage','getWheelDamage'],'implemented','Preserves opaque original damage strings; does not decode their original semantics into suspension damage. Host damage snapshots are a separate implementation.');
annotate('java.game.parts.bodypart.Chassis',['getMin','getMax'],'implemented','Uses actual CFG-transformed chassis mesh bounds; original scene-bound/parent-walk padding is not reproduced.');
annotate('java.io.Controller',['user_SetAxisSmooth','user_SetAxisSpeed'],'implemented','Stores parameters; ControllerNative.read does not apply the stored smoothing/slew-rate parameters.');
annotate('java.io.Controller',['user_SetAxisForce'],'implemented','Stores forceCenter/force; nonzero force overrides the read axis value. No physical wheel force feedback.');
annotate('java.lang.Thread',['setPriority','setDaemon'],'implemented','Stores metadata; cooperative browser execution has no original OS thread priorities/daemon lifecycle.');
annotate('java.lang.System',['setLdPriority'],'implemented','Stores the priority; no original engine loader scheduling.');
annotate('java.lang.System',['buildNumber'],'implemented','Compatibility constant 940, not the host engine version.');
annotate('java.lang.Debug',['writeFile'],'implemented','Writes a host log event, not an original filesystem debug file.');
annotate('java.lang.String',['finalize'],'implemented','Browser lifetime adapter: returns void; JavaScript owns memory.');

function descriptorTypes(descriptor: string) {
  let offset=0;
  const one=(): string => {
    const character=descriptor[offset++];
    if(character==='[') return one()+'[]';
    if(character==='L') { const end=descriptor.indexOf(';',offset); if(end<0) throw new Error('Invalid descriptor '+descriptor);
      const type=descriptor.slice(offset,end).replaceAll('/','.'); offset=end+1; return type; }
    const primitive:Record<string,string>={V:'void',I:'int',F:'float',D:'double',B:'byte',C:'char',S:'short',J:'long',Z:'boolean'};
    if(!primitive[character]) throw new Error('Invalid descriptor '+descriptor); return primitive[character];
  };
  if(descriptor[offset++]!=='(') throw new Error('Invalid descriptor '+descriptor);
  const parameters:string[]=[]; while(descriptor[offset]!==')') parameters.push(one());
  // TUFA native constructor descriptors can omit the return type after ')'.
  offset++; const result=offset===descriptor.length?'void':one(); if(offset!==descriptor.length) throw new Error('Trailing descriptor '+descriptor);
  return {parameters,result};
}
const entries = new Map<string,Entry>(), parents = new Map<string,string>();
let classFiles=0, classes=0;
const errors:{path:string;error:string}[]=[];
for (const path of (await walk(gameRoot)).filter(path=>path.toLowerCase().endsWith('.class'))) {
  const relative=relativeGamePath(path);
  try {
    for (const cls of parseTufa(await readFile(path))) {
      classes++; parents.set(cls.name,cls.superName);
      for (const method of cls.methods.filter(method=>method.flags&0x40)) {
        const {parameters,result}=descriptorTypes(method.signature), id=key(cls.name,method.name,parameters);
        const prior=entries.get(id);
        if(prior) { prior.declarations.push(relative); continue; }
        entries.set(id,{owner:cls.name,method:method.name,parameters,result,descriptor:method.signature,
          declarations:[relative],status:'missing',note:'No matching registration in the browser Java host.'});
      }
    }
    classFiles++;
  } catch(error) { errors.push({path:relative,error:String(error)}); }
}
for (const handler of handlers.values()) {
  const id=key(handler.owner,handler.method,handler.parameters);
  if(!entries.has(id)) entries.set(id,{owner:handler.owner,method:handler.method,parameters:handler.parameters,
    declarations:[],status:'implemented',note:'Host-only overload/adapter; no matching native TUFA declaration in this corpus.'});
}
for (const entry of entries.values()) {
  let handler:Handler|undefined;
  const seen=new Set<string>();
  for(let owner:string|undefined=entry.owner;owner&&!seen.has(owner);owner=parents.get(owner)) {
    seen.add(owner); handler=handlers.get(key(owner,entry.method,entry.parameters)); if(handler) break;
  }
  if(!handler) continue;
  const annotation=notes.get(handler.owner+'#'+handler.method);
  entry.status=annotation?.status ?? (handler.body.includes('Host stub:')?'mocked':'implemented');
  entry.note=annotation?.note ?? (entry.status==='mocked'?'Logs the call and returns void; no substantive implementation.':entry.declarations.length
    ? 'Host implementation registered; original-engine semantic parity is not implied.' : entry.note);
  entry.handler=key(handler.owner,handler.method,handler.parameters); entry.source=handler.source;
}
const ordered=[...entries.values()].sort((a,b)=>key(a.owner,a.method,a.parameters).localeCompare(key(b.owner,b.method,b.parameters),'en'));
const counts=Object.fromEntries((['implemented','mocked','missing'] as const).map(status=>[status,ordered.filter(entry=>entry.status===status).length]));
const declaredCounts=Object.fromEntries((['implemented','mocked','missing'] as const).map(status=>[status,ordered.filter(entry=>entry.status===status&&entry.declarations.length).length]));
const report={schema:1,scope:'Installed TUFA native declarations (flag 0x40) plus actual browser boot registrations; method overloads are separate rows.',
  classFiles,classes,counts,declaredCounts,errors,entries:ordered};
await mkdir('docs/reports',{recursive:true});
await writeFile('docs/reports/native-status.json',JSON.stringify(report,null,2)+'\n');
const link=(source:string) => { const [path,line]=source.split(':'); return `[${source}](../${path}${line?'#L'+line:''})`; };
const statuses = ['implemented','mocked','missing'] as const;
const labels:Record<Status,string>={implemented:'Implemented',mocked:'Mocked',missing:'Not implemented'};
const md=[`# Java native method inventory`, '', 'Snapshot: 2026-11-08. Generated from the installed game and current browser host.', '',
  ...statuses.map((status,index)=>`${index+1}. [${labels[status]} (${counts[status]})](#${index+1}-${labels[status].toLowerCase().replaceAll(' ','-')})`), '',
  `Scanned **${classFiles} TUFA files**, **${classes} classes**; **${errors.length} read errors**. Each overload is a separate row.`, '',
  '| Status | Total overloads | Game native declarations | Host additions |','|---|---:|---:|---:|',...Object.entries(counts).map(([status,count])=>`| ${labels[status as Status]} | ${count} | ${declaredCounts[status]} | ${count-declaredCounts[status]} |`),'',
  '**Status definitions**', '',
  '- **Implemented**: a host handler provides working behavior. This does not imply full parity with the original EXE. Notes identify partial implementations and browser adaptations.',
  '- **Mocked**: the call is accepted, but its main operation is absent, data is discarded, or a temporary result is returned.',
  '- **Not implemented**: no matching handler exists in the current browser Java host.', '',
  '**Scope and limitations**', '',
  'Matching uses class, method and parameter types, including arrays. Short type names are normalized to match host registrations; ancestor handlers are considered. A game declaration is a TUFA method with native flag `0x40`. Host-only overloads are marked separately. Methods interpreted from Java source without that flag are outside this inventory.', '',
  'This snapshot does not certify algorithm accuracy or cover every game version. Registrations outside the standard boot path and the separate legacy PartHost are excluded. Registration capture runs a synthetic Init rather than a game session. Optional audio/video/render bridges are supplied separately by the application; their absence during capture does not make an implemented handler a mock.', '',
  'Only names, signatures and relative paths are published; original game files are not copied into the repository.', '',
  '**Regenerate**', '', '```powershell','npm run report:natives','# Set SLRR_GAME_ROOT to use a different installation.','```','',
  'Machine-readable output: [native-status.json](reports/native-status.json). Classification overrides and limitations: [report-native-status.ts](../tools/report-native-status.ts). Update the annotations and regenerate both reports when replacing a mock.',''];
for(const [index,status] of statuses.entries()) {
  md.push(`## ${index+1}. ${labels[status]}`,'',`**${counts[status]} overloads.**`,'','| Method | Implementation | Notes |','|---|---|---|');
  for(const entry of ordered.filter(entry=>entry.status===status)) md.push(`| \`${entry.owner}.${entry.method}(${entry.parameters.map(leaf).join(', ')})${entry.result?' → '+leaf(entry.result):''}\` | ${entry.source?link(entry.source):'—'} | ${entry.note}${entry.declarations.length?'':' **Host addition.**'} |`);
  md.push('');
}
if(errors.length) md.push('**Read errors**','',...errors.map(error=>`- \`${error.path}\`: ${error.error}`),'');
await writeFile('docs/native-status.md',md.join('\n'));
console.log(JSON.stringify({classFiles,classes,...counts,errors:errors.length}));
if(errors.length) process.exitCode=1;
