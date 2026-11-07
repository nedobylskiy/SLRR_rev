import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parse} from './exporter/extract.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
let sessions=0,samples=0,files=0;
async function verify(base,name,expected){
  const data=await readFile(join(base,name));
  assert.equal(data.length,expected.bytes,`${name}: byte length`);
  assert.equal(createHash('sha256').update(data).digest('hex'),expected.sha256,`${name}: SHA-256`);
  files++;
}
for(const capture of manifest.captures){
  const folder=join(root,capture.id);
  for(const [name,expected] of Object.entries(capture.files))await verify(folder,name,expected);
  const raw=await readFile(join(folder,'telemetry.txt'),'utf8');
  const reparsed=parse(raw),saved=JSON.parse(await readFile(join(folder,'summary.json'),'utf8'));
  assert.deepEqual(reparsed,saved,`${capture.id}: raw log / summary mismatch`);
  assert.equal(reparsed.rejected,0);assert.equal(reparsed.incompletePackets,0);
  assert.equal(reparsed.sessions.length,capture.sessions.length);
  for(let i=0;i<reparsed.sessions.length;i++){
    const session=reparsed.sessions[i];
    assert.equal(session.samples.length,capture.sessions[i].samples);
    for(let index=0;index<session.samples.length;index++){
      assert.equal(Number(session.samples[index].seq),index,`${capture.id}: sample sequence gap`);
      if(index)assert.ok(Number(session.samples[index].t)>Number(session.samples[index-1].t),`${capture.id}: non-increasing time`);
    }
    samples+=session.samples.length;sessions++;
  }
}
for(const [name,expected] of Object.entries(manifest.provenance))await verify(join(root,'provenance'),name,expected);
console.log(JSON.stringify({verified:true,captures:manifest.captures.length,sessions,samples,files}));
