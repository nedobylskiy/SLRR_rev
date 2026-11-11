import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {jv} from 'slrr-jvm';import {Assets} from '../src/assets';import {bootGame} from '../src/runtime/game-boot';import {gameRoot,walk,relativeGamePath,safeGamePath} from './game-files';
const assets=new Assets((await walk(gameRoot)).map(p=>({path:relativeGamePath(p),size:0})),async p=>new Uint8Array(await readFile(await safeGamePath(p))));
const result=await bootGame(assets,event=>{if(event.level==='error')console.error(event.message);});assert.ok(!result.error,result.error?.message);
try{
 const mover=await result.jvm.constructAsync('java.util.resource.Dummy',[]),node=result.gameTypes.get(mover)!;assert.ok(node);node.position={x:0,y:0,z:0};
 for(const [name,left,top,size,x,z,modulo]of [['city',-23.482,-24.45,5.828,8,8,8],['test_track',-7.957,-15.996,2.64,6,8,10]]as const){
  const pack=`maps/${name}/smallmap.rpk`,rid=(id:number)=>result.gameTypes.remountSavedResource(pack,id);
  const nav=await result.jvm.constructAsync('java.game.Navigator',[jv('float',left),jv('float',top),jv('float',size),rid(1),rid(2),rid(5),jv('int',x),jv('int',z),jv('int',modulo)]);
  await result.jvm.invokeAsync(nav,'show');const player=await result.jvm.constructAsync('java.util.resource.RenderRef',[result.gameTypes.remountSavedResource('frontend.rpk',0x5c)]);await result.jvm.invokeAsync(nav,'addMarker',[player,mover]);
  await result.jvm.invokeAsync(nav,'updateNavigator',[mover,jv('int',0)]);const frame=result.navigator.frames(16/9).at(-1)!;assert.ok(frame);assert.equal(frame.tiles.length,x*z);assert.equal(frame.markers.length,1);
  const paths=new Set<string>();for(const tile of frame.tiles){const type=tile.renderType!,replacements=new Map<number,number>(),packs=new Map(type.resourceReplacementPacks);for(const [before,after]of type.resourceReplacements){const clone=result.gameTypes.getByResourceId(after),identity=clone&&result.gameTypes.resolveRenderResource(clone);replacements.set(before,identity?.id??after);if(identity)packs.set(before,identity.pack);}const model=await assets.modelForResource(tile.renderResource!.pack,tile.renderResource!.id,new Set(),{replacements,replacementPacks:packs,sourcePacks:type.resourceReplacementSourcePacks});paths.add(model.textures[0]);assert.ok(assets.byPath.has(model.textures[0].replaceAll('\\','/').toLowerCase()));}
  result.navigator.mode='heading';node.orientation.y=.7;assert.equal(result.navigator.frames(16/9).at(-1)!.yaw,.7);result.navigator.mode='java';await result.jvm.invokeAsync(nav,'hide');assert.equal(result.navigator.frames(16/9).length,0);await result.jvm.invokeAsync(nav,'finalize');console.log(JSON.stringify({map:name,tiles:x*z,uniqueTextures:paths.size,markers:1,hide:true,mode:true}));
 }
}finally{result.dispose();}
