import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';

for (const asynchronous of [false,true]) test(`SLRR empty methods return their declared default (${asynchronous?'async':'sync'})`,async()=>{
  const source = `class InventoryItem {
    String getInfo() { }
    int getCount() { }
    float getWeight() { return; }
    void show() { }
  }
  class PaintItem extends InventoryItem { }
  class Panel {
    native int setToolTip(String text);
    int setToolTip(Vector value) { return -99; }
    int attach(InventoryItem item) { return setToolTip(item.getInfo()); }
  }
  class Vector { }`;
  const jvm = new SlrrJvm({resolveImport:()=>({path:'InventoryItem.java',source})});
  jvm.natives.register('Panel','setToolTip',['String'],({args})=>{
    assert.equal(args[0].value,null);return jv('int',1);
  });
  await jvm.loadClass('InventoryItem');
  const item=await jvm.constructAsync('PaintItem',[]),panel=await jvm.constructAsync('Panel',[]);
  const invoke=(receiver:typeof item,name:string,args:typeof item[]=[])=>asynchronous?jvm.invokeAsync(receiver,name,args):jvm.invoke(receiver,name,args);
  assert.deepEqual(await invoke(item,'getInfo'),jv('String',null));
  assert.deepEqual(await invoke(item,'getCount'),jv('int',0));
  assert.deepEqual(await invoke(item,'getWeight'),jv('float',0));
  assert.deepEqual(await invoke(item,'show'),jv('void',undefined));
  assert.equal((await invoke(panel,'attach',[item])).value,1);
});
