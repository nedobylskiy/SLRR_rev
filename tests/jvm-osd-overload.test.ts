import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';

test('OSD handler and int commands outrank the GameRef/string compatibility overload',async()=>{
  const source=`package demo;
    class GameRef {}
    class Painter extends GameRef {}
    class Main {
      int button(GameRef handler, String suffix) { return 1; }
      int button(Object handler, int command) { return command; }
      int textOnly(String value) { return 7; }
      int run() { return button(new Painter(),64); }
      int fallback() { return textOnly(64); }
    }`;
  const jvm=new SlrrJvm({allowNumericStringArguments:true,resolveImport:()=>({path:'Main.java',source})});
  await jvm.loadClass('demo.GameRef');await jvm.loadClass('demo.Painter');await jvm.loadClass('demo.Main');
  const main=await jvm.constructAsync('demo.Main',[]);
  assert.equal((await jvm.invokeAsync(main,'run')).value,64);
  assert.equal((await jvm.invokeAsync(main,'fallback')).value,7,'compatibility remains available when no Java overload applies');
  assert.equal((await jvm.invokeAsync(main,'button',[await jvm.constructAsync('demo.Painter',[]),jv('String','suffix')])).value,1);
});
