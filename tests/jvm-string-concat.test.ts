import test from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';

const source=`class Labels {
  String label(String name,int complex,int tuneable,int illegal) {
    String flags;
    if(complex) flags=flags+"+";
    if(tuneable) flags=flags+"T";
    if(illegal) flags=flags+"!";
    if(flags) flags=" ["+flags+"]";
    return name+flags+" (100%)";
  }
  String nullable(String value){return "<"+value+">";}
  String literal(){return "null"+"+";}
  String number(){String value;return 12+value;}
  int stillNull(){String value;String label="prefix"+value;return value==null;}
}`;

test('SLRR Mechanic-style optional flags concatenate from null without adding a literal null in sync and async calls',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>({path:'Labels.java',source})});await jvm.loadClass('Labels');
  const object=jvm.construct('Labels',[]),name="Einvagen GT driver's door";
  for(let bits=0;bits<8;bits++){
    const flags=(bits&1?'+':'')+(bits&2?'T':'')+(bits&4?'!':'');
    const expected=name+(flags?' ['+flags+']':'')+' (100%)';
    const args=[jv('String',name),jv('int',bits&1),jv('int',bits&2),jv('int',bits&4)];
    assert.equal(jvm.invoke(object,'label',args).value,expected);
    assert.equal((await jvm.invokeAsync(object,'label',args)).value,expected);
  }
  assert.equal(jvm.invoke(object,'nullable',[jv('String',null)]).value,'<>');
  assert.equal(jvm.invoke(object,'nullable',[jv('String','null')]).value,'<null>');
  assert.equal(jvm.invoke(object,'literal').value,'null+');
  assert.equal(jvm.invoke(object,'number').value,'12');
  assert.equal(jvm.invoke(object,'stillNull').value,1,'concatenation must not mutate the original null reference');
});
