import { jv } from 'slrr-jvm';
import type { Assets } from '../assets';
import { entryProperties } from '../formats/rpk';
import type { BootResult } from './game-boot';

/** Debug-only live tree replacement. No car-lot, purchase, money or save calls. */
export async function replaceGarageCarTree(result: BootResult, assets: Assets) {
  const { jvm } = result, logic = jv('class','java.game.GameLogic');
  const garage = jvm.get(logic,'actualState');
  if (garage.value == null || !jvm.isInstance(garage,'java.game.Garage')) throw new Error('Open the garage before replacing the car');
  const player = jvm.get(logic,'player'), previous = jvm.get(player,'car');
  const pack = 'cars/racers/einvagen.rpk';
  const entry = (await assets.pack(pack)).entries.find(entry => entryProperties(entry).some(property =>
    property.key === 'script' && /(?:^|[\\/])Einvagen_110_GTK\.(?:class|java)$/i.test(property.value)));
  if (!entry) throw new Error('Einvagen 110 GTK chassis was not found in the installed game');
  const id = result.gameTypes.remountSavedResource(pack,entry.typeId);
  const vehicle = await jvm.constructAsync('java.game.Vehicle',[player,id,jv('int',0),
    jv('float',1),jv('float',1),jv('float',1),jv('float',1)]);
  let assigned = false;
  try {
    if (jvm.get(vehicle,'chassis').value == null) throw new Error('110 GTK stock assembly has no chassis');
    if (jvm.get(logic,'actualState').value !== garage.value || jvm.get(player,'car').value !== previous.value)
      throw new Error('Garage or current vehicle changed during assembly');
    jvm.set(player,'car',vehicle); assigned = true;
    await jvm.invokeAsync(garage,'lockCar');
    await jvm.invokeAsync(garage,'refreshCarClassString');
  } catch (error) {
    try {
      if (assigned) { jvm.set(player,'car',previous); await jvm.invokeAsync(garage,'lockCar'); }
    } finally { await jvm.invokeAsync(vehicle,'destroy'); }
    throw error;
  }
  if (previous.value != null) await jvm.invokeAsync(previous,'destroy');
  return vehicle;
}
