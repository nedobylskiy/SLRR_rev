import test from 'node:test';
import assert from 'node:assert/strict';
import {mapObjectCategory} from '../src/render/map-object-category';

test('stock aliases separate trees, streetlights, bins and street furniture from architecture',()=>{
  for(const alias of ['lamp','lamp_base','lamp_ad','lamp_lane1_hold','kislampa','korbelampa','trafficlamp','trafficlamp_body','villanyoszlop','pozna'])assert.equal(mapObjectCategory(alias),'streetlights',alias);
  for(const alias of ['kuka_a','kuka_c_fedo','trash_bin','dustbin'])assert.equal(mapObjectCategory(alias),'bins',alias);
  for(const alias of ['pad','telefon','tuzcsap','lada_a','tabla_100','reklam1fa','korlat_a','kontener','utlezaro','balratabla'])assert.equal(mapObjectCategory(alias),'small-props',alias);
  for(const alias of ['fa06a','fa12c','tree','palm'])assert.equal(mapObjectCategory(alias),'trees',alias);
  for(const alias of ['road','walk','wall123','12x6_ketszintteraszos','area_18_egyedi','hotel_001_egyedi','facade'])assert.equal(mapObjectCategory(alias),undefined,alias);
});
