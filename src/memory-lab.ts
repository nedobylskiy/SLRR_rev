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
  container.innerHTML = `<h2>Автомобиль → буфер → автомобиль</h2>
    <p>Исполняются оригинальные Java-методы Part, Chassis, Tyre и ShockAbsorber из выбранной установки. Проверочная сборка содержит 10 деталей; её определения слотов заданы для теста, это не загрузка штатной машины из CFG.</p>
    <div class="memory-controls"><label>Баланс тормозов<input id="memory-brake" type="number" min="0" max="1" step="0.01" value="0.67"></label><label>Давление первой шины<input id="memory-pressure" type="number" min="0.1" max="10" step="0.1" value="1.8"></label></div>
    <div class="memory-buttons"><button id="memory-save">1. Сериализовать</button><button id="memory-restore" disabled>2. Восстановить из буфера</button><button id="memory-rollback" disabled>Проверить откат ошибки</button></div>
    <p id="memory-result">Сборка подготовлена: chassis + 4 шины + 4 амортизатора + кузовная деталь. Дисковые операции отсутствуют.</p>
    <pre id="memory-counts"></pre><details><summary>Трасса оригинальных методов</summary><pre id="memory-trace"></pre></details><details><summary>Восстановленное дерево и параметры</summary><pre id="memory-state"></pre></details>`;
  const element = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const save = element<HTMLButtonElement>('memory-save'), restore = element<HTMLButtonElement>('memory-restore'), rollback = element<HTMLButtonElement>('memory-rollback');
  const result = element('memory-result'), trace = element('memory-trace');
  const counts = () => { const c = runtime.liveCounts; element('memory-counts').textContent = `Активные миры: ${c.worlds} · Детали: ${c.parts} · Ресурсы: ${c.resources}`; };
  const guard = (work: () => void) => { try { work(); } catch (e) { result.textContent = `Ошибка: ${e instanceof Error ? e.message : e}`; } finally { counts(); } };
  save.onclick = () => guard(() => {
    const brake = Number(element<HTMLInputElement>('memory-brake').value), pressure = Number(element<HTMLInputElement>('memory-pressure').value);
    if (!Number.isFinite(brake) || brake < 0 || brake > 1 || !Number.isFinite(pressure) || pressure <= 0 || pressure > 10) throw new Error('Проверь баланс и давление');
    root.setFloat('brake_balance', brake); root.slots[0].child!.setFloat('inflation', pressure);
    buffer = runtime.serialize(root); restore.disabled = false; rollback.disabled = false;
    result.textContent = `Получен Uint8Array: ${buffer.length} байт. Внутри — дерево деталей, параметры подклассов, таблица пакетов и transient-окраска. Буфер хранится только в памяти.`;
    trace.textContent = runtime.trace.join('\n');
  });
  restore.onclick = () => guard(() => {
    if (!buffer) throw new Error('Сначала создай буфер');
    restored = runtime.restore(buffer, restored);
    const loadTrace = [...runtime.trace];
    const state = describeAssembly(restored.root!), equivalent = JSON.stringify(state) === JSON.stringify(describeAssembly(root));
    const encoded = runtime.serialize(restored.root!); const identical = encoded.length === buffer.length && encoded.every((b, i) => b === buffer![i]);
    if (!equivalent || !identical) throw new Error('Дерево или повторный буфер отличаются');
    result.textContent = `Восстановлен независимый экземпляр: ${restored.parts.size} деталей. Параметры и связи совпадают; повторное сохранение побайтно идентично. Исходный автомобиль сохранён.`;
    trace.textContent = loadTrace.join('\n'); element('memory-state').textContent = JSON.stringify(state, null, 2);
  });
  rollback.onclick = () => guard(() => {
    if (!buffer) throw new Error('Сначала создай буфер');
    const before = JSON.stringify(describeAssembly(root)), countsBefore = JSON.stringify(runtime.liveCounts), damaged = parseSdat(buffer);
    new DataView(damaged.payload.buffer).setFloat32(damaged.payload.length - 4, NaN, true);
    let error = '';
    try { runtime.restore(serializeSdat(damaged), original); } catch (e) { error = String(e); }
    if (!error || original.disposed || JSON.stringify(describeAssembly(root)) !== before || JSON.stringify(runtime.liveCounts) !== countsBefore) throw new Error('Нарушена атомарность загрузки');
    result.textContent = 'Откат проверен: ошибка в последнем поле остановила загрузку после создания деталей. Все временные объекты удалены, исходная машина осталась без изменений.';
    trace.textContent = error;
  });
  counts();
  return () => { original.dispose(); restored?.dispose(); buffer = undefined; save.onclick = null; restore.onclick = null; rollback.onclick = null; };
}
