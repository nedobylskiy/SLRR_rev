import test from 'node:test';
import assert from 'node:assert/strict';
import {OsdLayer} from '../src/osd/osd-layer';
import type {Assets} from '../src/assets';

class Element {
  style:Record<string,string>={};className='';textContent='';tabIndex=0;hidden=false;clientWidth=1280;clientHeight=720;
  classes=new Set<string>();classList={add:(...names:string[])=>names.forEach(name=>this.classes.add(name))};
  children:Element[]=[];append(...children:Element[]){this.children.push(...children);}remove(){}
}

test('moving right/left anchored OSD texts preserves intrinsic width while zero-sized widgets stay zero-sized',()=>{
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldObserver=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class{observe(){}disconnect(){}}});
  try{
    const layer=new OsdLayer(new Element() as unknown as HTMLElement,{} as Assets);
    const title=layer.createText('TIME: ','right',.86,-.98),clock=layer.createText('12:00 pm','left',.86,-.98);
    for(const text of [title,clock])text.setBounds(.46,-.98,0,0,2);
    assert.equal(title.node.style.left,clock.node.style.left);assert.equal(title.node.style.top,clock.node.style.top);
    assert.equal(title.node.style.width,'max-content','right-alignment transform must use the rendered text width');
    assert.equal(clock.node.style.width,'max-content');assert.equal(title.node.style.height,'auto');
    assert.ok((title.node as unknown as Element).classes.has('osd-align-right'));
    clock.setText('11:59 pm');clock.setBounds(.86,-.98,0,0,2);assert.equal(clock.node.style.width,'max-content');
    assert.equal(title.node.textContent,'TIME: ');
    const widget=layer.createNativeElement(new Element() as unknown as HTMLElement,0,0,.2,.1,1);
    widget.setBounds(0,0,0,0,1);assert.equal(widget.node.style.width,'0%');assert.equal(widget.node.style.height,'0%');
    layer.dispose();
  }finally{
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');
    if(oldObserver)Object.defineProperty(globalThis,'ResizeObserver',oldObserver);else Reflect.deleteProperty(globalThis,'ResizeObserver');
  }
});
