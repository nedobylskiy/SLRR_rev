/**
 * Client size of an element without a per-frame layout read. Reading clientWidth after any DOM write in the
 * same frame forces a synchronous style and layout pass; render loops ask every frame, so the size is cached
 * and refreshed by one shared ResizeObserver.
 */
const sizes=new WeakMap<Element,{width:number;height:number}>();
let observer:ResizeObserver|undefined;

export function elementSize(element:HTMLElement):{width:number;height:number} {
  let size=sizes.get(element);
  if(size)return size;
  size={width:element.clientWidth,height:element.clientHeight};
  if(typeof ResizeObserver==='undefined')return size;
  sizes.set(element,size);
  observer??=new ResizeObserver(entries=>{
    for(const entry of entries){
      const cached=sizes.get(entry.target);if(!cached)continue;
      const target=entry.target as HTMLElement;
      // clientWidth/Height exclude borders and scrollbars, as the callers expect; layout is fresh here.
      cached.width=target.clientWidth;cached.height=target.clientHeight;
    }
  });
  observer.observe(element);
  return size;
}
