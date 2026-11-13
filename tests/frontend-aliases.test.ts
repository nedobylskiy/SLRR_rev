import test from 'node:test';import assert from 'node:assert/strict';
import {jv,SlrrJvm} from 'slrr-jvm';
import {registerFrontendAliases} from '../src/runtime/frontend-aliases';

for(const modern of [false,true])test(`Frontend aliases follow ${modern?'build 940':'older MWM'} declarations`,async()=>{
  const source=`package java.render; class Frontend {
    static int inputQueue=5;static int largeFont=24;static int mediumFont=17;static int smallFont=11;
    static final int SFX_OK=128;
    ${modern?'static int largeFont_strong=25;static float largeFont_scale=1.5;static int SFX_NOTIF=129;':''}
  }`;
  const jvm=new SlrrJvm({resolveImport:({className})=>className==='java.render.Frontend'?{path:'Frontend.java',source}:null});
  const copied=await registerFrontendAliases(jvm),alias=jv('class','java.game.Frontend');
  assert.equal(jvm.get(alias,'largeFont').value,24);assert.equal(jvm.get(alias,'SFX_OK').value,128);
  assert.equal(copied.includes('largeFont_strong'),modern);
  if(modern){assert.equal(jvm.get(alias,'largeFont_strong').value,25);assert.equal(jvm.get(alias,'largeFont_scale').value,1.5);}
  else assert.throws(()=>jvm.get(alias,'largeFont_strong'),/Missing Java field/,'absent fields are not replaced with invented values');
});
test('Frontend initializer failures are not hidden by compatibility filtering',async()=>{
  const source='package java.render; class Frontend {static int largeFont=missingInitializer();}';
  const jvm=new SlrrJvm({resolveImport:()=>({path:'Frontend.java',source})});
  await assert.rejects(registerFrontendAliases(jvm),/missingInitializer/);
});
