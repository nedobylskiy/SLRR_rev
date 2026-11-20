import {jv,type SlrrJvm} from 'slrr-jvm';

const fields=['inputQueue','largeFont','mediumFont','smallFont','largeFont_strong','smallFont_strong',
  'largeFont_russian','largeFont_scale','smallFont_scale','largeFont_strong_scale',
  'smallFont_strong_scale','largeFont_russian_scale','defLoadingPic','fadeRes','fadeRes_HD','pointers',
  'SFX_MONEY','SFX_QUESTION','SFX_OK','SFX_WARNING','SFX_NOTIF','SFX_MENU_MOVE','SFX_MENU_BACK','SFX_MENU_SELECT'];

/** The java.game alias bridges the selected installation's Frontend, rather
 * than requiring build-940-only fonts and effects from older game versions. */
export async function registerFrontendAliases(jvm:SlrrJvm){
  const frontend=await jvm.loadClass('java.render.Frontend');
  const declared=new Set([...(frontend?.fields.filter(f=>f.isStatic).map(f=>f.name)??[]),...(frontend?.constants.keys()??[])]);
  const copied:string[]=[];
  for(const name of fields)if(declared.has(name)){
    // Initialization/getter errors remain real failures, not optional-field omissions.
    const value=await jvm.getAsync(jv('class','java.render.Frontend'),name);
    jvm.natives.registerField('java.game.Frontend',name,value);copied.push(name);
  }
  return copied;
}
