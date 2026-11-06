import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {boostEstimate} from './boost-estimate.mjs';

export function parse(text){
  const sessions=[],active=new Map(),pending=new Map();let rejected=0;
  for(const line of text.split(/\r?\n/)){
    const at=line.indexOf('SLRR_PHYSICS|v=2|');if(at<0)continue;
    const fields=Object.fromEntries(line.slice(at).split('|').slice(1).map(part=>{
      const split=part.indexOf('=');return[part.slice(0,split),part.slice(split+1)];
    }));
    const {run,seq,kind,key,value}=fields;
    if(!/^\d+$/.test(run??'')||!/^\d+$/.test(seq??'')||!key||value===undefined){rejected++;continue;}
    if(kind==='meta'&&key==='status'&&value==='begin'){
      const session={id:sessions.length+1,run,metadata:{},engine:{},samples:[],curves:[],ended:false};
      sessions.push(session);active.set(run,session);
    }
    const session=active.get(run);if(!session){rejected++;continue;}
    const packetKey=`${session.id}:${kind}:${seq}`;
    if(kind==='end'){session.ended=true;active.delete(run);continue;}
    if(!['meta','engine','sample','curve'].includes(kind)){rejected++;continue;}
    if(key==='status'&&value==='begin'){pending.set(packetKey,{session,kind,seq,fields:{}});continue;}
    const packet=pending.get(packetKey);if(!packet){rejected++;continue;}
    if(key==='status'&&value==='end'){
      const row={...packet.fields,seq};
      if(kind==='meta')session.metadata=row;
      if(kind==='engine')session.engine=row;
      if(kind==='sample'){
        if(['t','rpm','speed_mps','gear_param6'].every(k=>row[k]!==undefined&&Number.isFinite(Number(row[k]))))session.samples.push(row);
        else rejected++;
      }
      if(kind==='curve')session.curves.push(row);
      pending.delete(packetKey);continue;
    }
    packet.fields[key]=value;
  }
  const decode=(row,key)=>Array.from({length:Math.min(4096,Math.max(0,Number(row[key+'_length'])||0))},(_,i)=>String.fromCharCode(Number(row[key+'_code_'+i])||0)).join('');
  for(const session of sessions){session.model=decode(session.metadata,'vehicle');session.engineName=decode(session.engine,'engine');}
  return{version:2,sessions,rejected,incompletePackets:pending.size};
}

function csv(rows){
  const keys=[...new Set(rows.flatMap(Object.keys))],quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return[keys.map(quote).join(','),...rows.map(row=>keys.map(k=>quote(row[k])).join(','))].join('\n')+'\n';
}
async function main(){
  const [file,output]=process.argv.slice(2);if(!file||!output)throw Error('Usage: node extract.mjs <game-log> <output-directory>');
  const input=await readFile(file,'utf8');if(!input.trim())throw Error('Log is empty; finish the capture and check again.');
  const report=parse(input);if(!report.sessions.length)throw Error('No v2 sessions found; include initial metadata');
  const dir=resolve(output);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'summary.json'),JSON.stringify(report,null,2));
  for(const type of ['samples','curves'])await writeFile(join(dir,type+'.csv'),csv(report.sessions.flatMap(session=>session[type].map(row=>({session:session.id,model:session.model,...row})))));
  const shifts=[];
  for(const session of report.sessions)for(let i=1;i<session.samples.length;i++){
    const previous=session.samples[i-1],current=session.samples[i];if(previous.gear_param6===current.gear_param6)continue;
    shifts.push({session:session.id,model:session.model,from:previous.gear_param6,to:current.gear_param6,t_before:previous.t,t_after:current.t,
      rpm_before:previous.rpm,rpm_after:current.rpm,speed_before_mps:previous.speed_mps,speed_after_mps:current.speed_mps});
  }
  await writeFile(join(dir,'shifts.csv'),csv(shifts));
  const boost=[];
  for(const session of report.sessions)for(const sample of session.samples){
    const estimate=boostEstimate(session.engine,Number(sample.rpm));if(!estimate)continue;
    boost.push({session:session.id,model:session.model,seq:sample.seq,t:sample.t,rpm:sample.rpm,
      throttle_param0:sample.throttle_param0,gear_param6:sample.gear_param6,...estimate});
  }
  if(boost.length)await writeFile(join(dir,'boost-estimates.csv'),csv(boost));
  const runs=report.sessions.map(session=>{
    const samples=session.samples,times=samples.map(row=>Number(row.t));
    const dt=times.slice(1).map((time,i)=>time-times[i]).filter(value=>value>0).sort((a,b)=>a-b);
    return{session:session.id,model:session.model,engine:session.engineName,samples:samples.length,
      duration_s:times.length?times.at(-1)-times[0]:0,median_interval_s:dt.length?dt[Math.floor(dt.length/2)]:'',
      max_rpm:samples.length?Math.max(...samples.map(row=>Number(row.rpm))):'',
      max_speed_kph:samples.length?Math.max(...samples.map(row=>Number(row.speed_mps)*3.6)):'',
      transmission_config:session.metadata.transmission_config,mass_native_raw:session.metadata.mass_native_raw,
      P_turbo_max:session.engine.P_turbo_max,P_turbo_waste:session.engine.P_turbo_waste,
      rpm_turbo_mul:session.engine.rpm_turbo_mul,rpm_turbo_opt:session.engine.rpm_turbo_opt,rpm_turbo_range:session.engine.rpm_turbo_range,
      ended:session.ended,shifts:shifts.filter(row=>row.session===session.id).length};
  });
  await writeFile(join(dir,'runs.csv'),csv(runs));
  const overview=['# Telemetry capture','',`Rejected records: ${report.rejected}; incomplete packets: ${report.incompletePackets}.`,
    '',...runs.flatMap(run=>[`## Run ${run.session}: ${run.model||'(unknown model)'}`,'',
      `Engine: ${run.engine||'(not recorded)'}. Samples: ${run.samples}. Duration: ${Number(run.duration_s).toFixed(2)} s.`,
      `Median interval: ${run.median_interval_s===''?'unknown':(Number(run.median_interval_s)*1000).toFixed(1)+' ms'}.`,
      `Maximum RPM: ${run.max_rpm}; maximum speed: ${run.max_speed_kph===''?'unknown':Number(run.max_speed_kph).toFixed(2)+' km/h'}.`,
      `Observed raw gear changes: ${run.shifts}. Transmission config: ${run.transmission_config}.`,'']),
    'Gear events bracket adjacent samples. Native mass, power and AI parameter semantics remain unqualified.',
    ...(boost.length?['','boost-estimates.csv contains a derived RPM/dyno envelope from a reconstructed HUD equation, with zero plateau assumed. It is not measured pressure, is not qualified against this Steam HUD, and cannot independently measure turbo spool/lag.']:[])];
  await writeFile(join(dir,'overview.md'),overview.join('\n'));
  console.log(JSON.stringify({sessions:report.sessions.length,samples:report.sessions.reduce((n,s)=>n+s.samples.length,0),shifts:shifts.length,rejected:report.rejected,incompletePackets:report.incompletePackets,output:dir}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
