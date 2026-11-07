import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function parsePhysicsFrames(text:string){
  const frames:Record<string,number>[]=[];let rejected=0;
  for(const line of text.split(/\r?\n/)){
    if(!line.startsWith('SLRR_FRAME|v=1|'))continue;
    try{
      const row=JSON.parse(line.slice('SLRR_FRAME|v=1|'.length));
      if(!row||typeof row!=='object'||Array.isArray(row)||!['seq','sim_s','frame_interval_ms','constraints_ms'].every(k=>Number.isFinite(row[k]))||!Object.values(row).every(v=>typeof v==='number'&&Number.isFinite(v)))throw Error('Invalid CPU frame');
      frames.push(row);
    }catch{rejected++;}
  }
  return {frames,rejected};
}
export function summarizePhysicsFrames(frames:Record<string,number>[]){
  const intervals=frames.map(f=>f.frame_interval_ms).filter(v=>v>0).sort((a,b)=>a-b);
  const percentile=(p:number)=>intervals.length?intervals[Math.max(0,Math.ceil(p*intervals.length)-1)]:0;
  return {frames:frames.length,frame_ms:{p50:percentile(.5),p95:percentile(.95),max:intervals.at(-1)??0},
    over_50_ms:intervals.filter(v=>v>50).length,over_100_ms:intervals.filter(v=>v>100).length,
    // RAF intervals precede the work in that row. Preserve neighbours for correct attribution.
    worst_frames:frames.map((frame,index)=>({frame,previous:frames[index-1]??null})).sort((a,b)=>b.frame.frame_interval_ms-a.frame.frame_interval_ms).slice(0,20),
    notes:['All durations are CPU milliseconds, not GPU execution time.','frame_interval_ms is the RAF timestamp delta before this callback; inspect both the row and its previous callback.','Physics panels, solve+contacts, simulation+visuals and render callback are nested totals; do not add them to their inner stages.','Timers are opt-in and introduce measurement overhead; 240 Hz and 12 iterations are unchanged.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw Error('Usage: npx tsx tools/report-physics-frames.ts recording.txt [output-prefix]');
  const path=resolve(process.argv[2]),prefix=process.argv[3]?resolve(process.argv[3]):path.replace(/\.txt$/i,'');
  const {frames,rejected}=parsePhysicsFrames(await readFile(path,'utf8'));
  if(!frames.length)throw Error('No SLRR_FRAME v1 data found; record a new session with per-frame CPU profiling.');
  const keys=[...new Set(frames.flatMap(row=>Object.keys(row)))];
  await writeFile(prefix+'.frames.csv',[keys.join(','),...frames.map(row=>keys.map(k=>row[k]??'').join(','))].join('\n')+'\n');
  const summary={...summarizePhysicsFrames(frames),rejected};
  await writeFile(prefix+'.frames-summary.json',JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({frames:frames.length,rejected,frame_ms:summary.frame_ms,csv:prefix+'.frames.csv',summary:prefix+'.frames-summary.json'},null,2));
}
