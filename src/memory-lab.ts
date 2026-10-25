import type { Assets } from './assets';
import { PartAssemblyRuntime, type AssemblyWorld } from './runtime/part-assembly';
import { createPartDemo, describeAssembly, partSourcePaths } from './runtime/part-demo';
import { parseSdat, serializeSdat } from './formats/sdat';

export async function mountMemoryLab(container: HTMLElement, assets: Assets, current: () => boolean): Promise<() => void> {
  const sources = await Promise.all(partSourcePaths.map(async path => new TextDecoder('windows-1252').decode(await assets.read(path))));
  if (!current()) return () => {};
  const runtime = new PartAssemblyRuntime(); sources.forEach(source => runtime.registerSource(source));
  const original = createPartDemo(runtime), root = original.root!;
  let restored: AssemblyWorld | undefined, buffer: Uint8Array | undefined;
  container.innerHTML = `<h2>Vehicle → buffer → vehicle</h2>
    <p>Original Java methods from Part, Chassis, Tyre, and ShockAbsorber execute from the selected installation. The test assembly has 10 parts and test-defined slots; it is not a stock vehicle loaded from CFG.</p>
    <div class="memory-controls"><label>Brake balance<input id="memory-brake" type="number" min="0" max="1" step="0.01" value="0.67"></label><label>First tire pressure<input id="memory-pressure" type="number" min="0.1" max="10" step="0.1" value="1.8"></label></div>
    <div class="memory-buttons"><button id="memory-save">1. Serialize</button><button id="memory-restore" disabled>2. Restore from buffer</button><button id="memory-rollback" disabled>Test error rollback</button></div>
    <p id="memory-result">Assembly ready: chassis + 4 tires + 4 shock absorbers + body panel. No disk operations are used.</p>
    <pre id="memory-counts"></pre><details><summary>Original method trace</summary><pre id="memory-trace"></pre></details><details><summary>Restored tree and parameters</summary><pre id="memory-state"></pre></details>`;
  const element = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const save = element<HTMLButtonElement>('memory-save'), restore = element<HTMLButtonElement>('memory-restore'), rollback = element<HTMLButtonElement>('memory-rollback');
  const result = element('memory-result'), trace = element('memory-trace');
  const counts = () => { const c = runtime.liveCounts; element('memory-counts').textContent = `Live worlds: ${c.worlds} · Parts: ${c.parts} · Resources: ${c.resources}`; };
  const guard = (work: () => void) => { try { work(); } catch (e) { result.textContent = `Error: ${e instanceof Error ? e.message : e}`; } finally { counts(); } };
  save.onclick = () => guard(() => {
    const brake = Number(element<HTMLInputElement>('memory-brake').value), pressure = Number(element<HTMLInputElement>('memory-pressure').value);
    if (!Number.isFinite(brake) || brake < 0 || brake > 1 || !Number.isFinite(pressure) || pressure <= 0 || pressure > 10) throw new Error('Check brake balance and tire pressure');
    root.setFloat('brake_balance', brake); root.slots[0].child!.setFloat('inflation', pressure);
    buffer = runtime.serialize(root); restore.disabled = false; rollback.disabled = false;
    result.textContent = `Uint8Array created: ${buffer.length} bytes. It contains the part tree, subclass parameters, package table, and transient paint data. The buffer stays in memory.`;
    trace.textContent = runtime.trace.join('\n');
  });
  restore.onclick = () => guard(() => {
    if (!buffer) throw new Error('Create a buffer first');
    restored = runtime.restore(buffer, restored);
    const loadTrace = [...runtime.trace];
    const state = describeAssembly(restored.root!), equivalent = JSON.stringify(state) === JSON.stringify(describeAssembly(root));
    const encoded = runtime.serialize(restored.root!); const identical = encoded.length === buffer.length && encoded.every((b, i) => b === buffer![i]);
    if (!equivalent || !identical) throw new Error('The part tree or re-encoded buffer differs');
    result.textContent = `Independent instance restored: ${restored.parts.size} parts. Parameters and connections match; re-encoding is byte-identical. The original vehicle remains intact.`;
    trace.textContent = loadTrace.join('\n'); element('memory-state').textContent = JSON.stringify(state, null, 2);
  });
  rollback.onclick = () => guard(() => {
    if (!buffer) throw new Error('Create a buffer first');
    const before = JSON.stringify(describeAssembly(root)), countsBefore = JSON.stringify(runtime.liveCounts), damaged = parseSdat(buffer);
    new DataView(damaged.payload.buffer).setFloat32(damaged.payload.length - 4, NaN, true);
    let error = '';
    try { runtime.restore(serializeSdat(damaged), original); } catch (e) { error = String(e); }
    if (!error || original.disposed || JSON.stringify(describeAssembly(root)) !== before || JSON.stringify(runtime.liveCounts) !== countsBefore) throw new Error('Restore was not atomic');
    result.textContent = 'Rollback verified: an error in the final field stopped loading after parts were created. Temporary objects were released; the original vehicle is unchanged.';
    trace.textContent = error;
  });
  counts();
  return () => { original.dispose(); restored?.dispose(); buffer = undefined; save.onclick = null; restore.onclick = null; rollback.onclick = null; };
}
