import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScx} from '../src/formats/scx';
import {ScxWorkerClient} from '../src/formats/scx-worker-client';
import {parseScxRequest,scxModelTransfers,type ScxParseRequest,type ScxParseReply} from '../src/formats/scx-worker-protocol';

const u32=(...values:number[])=>{const bytes=Buffer.alloc(values.length*4);values.forEach((value,i)=>bytes.writeUInt32LE(value,i*4));return bytes;};
function v3(){
  const material=Buffer.alloc(56);material.writeUInt32LE(56);material.writeUInt16LE(2,44);material.writeUInt16LE(5,52);
  const vertex=Buffer.alloc(44);vertex.writeFloatLE(12,0);vertex.writeFloatLE(1,16);vertex.writeFloatLE(.25,24);vertex.writeFloatLE(.5,28);vertex.writeUInt32LE(0x7f123456,40);
  return Buffer.concat([Buffer.from('INVO'),u32(3),material,u32(1),vertex,u32(0),u32(0)]);
}
function v4(){
  const vertex=Buffer.alloc(28);vertex.writeUInt32LE(0x00123456,12);vertex.writeUInt32LE(0xffabcdef,16);vertex.writeFloatLE(.25,20);vertex.writeFloatLE(.75,24);
  const chunks=[u32(0,20,0,0,0),Buffer.concat([u32(4,44,1,0x381),vertex]),u32(5,12,0)];
  let offset=12+chunks.length*8;const directory=chunks.map((part,i)=>{const entry=u32([0,4,5][i],offset);offset+=part.length;return entry;});
  return Buffer.concat([Buffer.from('INVO'),u32(4,chunks.length),...directory,...chunks]);
}
class FakeWorker {
  onmessage:((event:MessageEvent<ScxParseReply>)=>void)|null=null;
  onerror:((event:ErrorEvent)=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  requests:ScxParseRequest[]=[];
  transferred:ArrayBuffer[]=[];
  terminated=false;
  postMessage(request:ScxParseRequest,transfer:ArrayBuffer[]){this.requests.push(structuredClone(request,{transfer}));this.transferred.push(...transfer);}
  deliver(index=0){
    const reply=parseScxRequest(this.requests[index]),transfer='model' in reply?scxModelTransfers(reply.model):[];
    const received=structuredClone(reply,{transfer});assert.ok(transfer.every(buffer=>buffer.byteLength===0));
    this.onmessage?.({data:received} as MessageEvent<ScxParseReply>);
  }
  terminate(){this.terminated=true;}
  asWorker(){return this as unknown as Worker;}
}

test('SCX worker preserves v3/v4 output and transfers owned input/output buffers without detaching source views',async()=>{
  const worker=new FakeWorker();let created=0;const parser=new ScxWorkerClient(()=>{created++;return worker.asWorker();});
  const bytes=v3(),backing=Buffer.concat([u32(123),bytes,u32(456)]),view=backing.subarray(4,4+bytes.length),original=Uint8Array.from(view);
  const a=parser.parse(view),b=parser.parse(v4());assert.equal(created,1);assert.equal(worker.requests.length,2);
  assert.deepEqual(Uint8Array.from(view),original);assert.ok(worker.transferred.every(buffer=>buffer.byteLength===0));
  worker.deliver(1);worker.deliver(0);
  assert.deepEqual(await a,parseScx(original));assert.deepEqual(await b,parseScx(v4()));assert.deepEqual(Uint8Array.from(view),original);
  parser.dispose();assert.equal(worker.terminated,true);
});

test('invalid SCX rejects its own request while the worker remains usable',async()=>{
  const worker=new FakeWorker(),parser=new ScxWorkerClient(()=>worker.asWorker());
  const bad=assert.rejects(parser.parse(new Uint8Array([0])),/SCX|bounds|INVO/);worker.deliver();await bad;
  const good=parser.parse(v3());worker.deliver(1);assert.deepEqual(await good,parseScx(v3()));parser.dispose();
});

test('unsupported or failed worker creation preserves synchronous parser behavior',async()=>{
  for(const create of [()=>undefined,()=>{throw Error('worker blocked');}]){
    const parser=new ScxWorkerClient(create);assert.deepEqual(await parser.parse(v3()),parseScx(v3()));await assert.rejects(parser.parse(new Uint8Array()),/bounds|SCX|INVO/);parser.dispose();
  }
});

test('worker failure recovers all queued jobs from intact input and ignores late replies',async()=>{
  const worker=new FakeWorker(),parser=new ScxWorkerClient(()=>worker.asWorker()),first=v3(),second=v4();
  const a=parser.parse(first),b=parser.parse(second);worker.onerror?.({preventDefault(){}} as ErrorEvent);
  assert.equal(worker.terminated,true);assert.deepEqual(await a,parseScx(first));assert.deepEqual(await b,parseScx(second));
  worker.deliver();assert.deepEqual(await parser.parse(first),parseScx(first));parser.dispose();
});

test('dispose settles pending SCX jobs and rejects subsequent work',async()=>{
  const worker=new FakeWorker(),parser=new ScxWorkerClient(()=>worker.asWorker());
  const pending=assert.rejects(parser.parse(v3()),/disposed/);parser.dispose();await pending;assert.equal(worker.terminated,true);
  await assert.rejects(parser.parse(v4()),/disposed/);
});
