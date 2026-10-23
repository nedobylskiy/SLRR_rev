import './style.css';
import { Assets, isSavedVehiclePath, type Asset } from './assets';
import { parseRpk, entryProperties } from './formats/rpk';
import { parseScx } from './formats/scx';
import { parseTufa } from './formats/tufa';
import { inspectSavedVehicle, serializeSdat } from './formats/sdat';
import { Viewer } from './render/viewer';
import { PartFactory, type EngineWorld } from './engine/world';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><div class="brand"><span class="mark">SL / R</span><div>REDLINE <b>REBUILT</b><small>Independent engine · Research build 0.1</small></div></div><div class="header-right"><span id="connection">Подключение…</span><button id="memory-lab">Поток в памяти</button><label class="button">Открыть папку игры<input id="folder" type="file" webkitdirectory multiple hidden></label></div></header>
<main><aside><div class="eyebrow">ОРИГИНАЛЬНЫЕ РЕСУРСЫ</div><h1>Под капотом.</h1><p class="intro">Ресурсы SLRR в новом окружении. Без запуска оригинального EXE.</p><div id="counts"></div><input id="search" type="search" placeholder="Поиск: Baiern, chassis, GameLogic…" aria-label="Поиск ресурсов"><nav id="filters"><button data-kind="scx" class="active">Модели</button><button data-kind="rpk">Пакеты</button><button data-kind="class">Скрипты</button><button data-kind="cfg">CFG</button><button data-kind="vehicle">Машины</button></nav><div id="list" role="list"></div><div id="list-count"></div></aside>
<section class="workspace"><div class="toolbar"><div><span class="eyebrow" id="format">WEBGL / RESOURCE LAB</span><div id="filename">Выбери ресурс слева</div></div><span class="badge" id="state">Ожидание</span></div><div id="viewport"></div><div id="inspector" hidden></div><div class="scene-help" id="scene-help">ЛКМ — вращение &nbsp; · &nbsp; Колесо — масштаб &nbsp; · &nbsp; ПКМ — перемещение</div><div class="detail"><div class="eyebrow">ДИАГНОСТИКА</div><div id="details">Загрузка каталога игры…</div></div></section></main><footer><span>TYPE SCRIPT / WEBGL 2</span><span>Геометрия и ресурсы: оригинальная установка · Игровая логика ещё не запускается</span><span id="total"></span></footer>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let assets: Assets, kind = 'scx', viewer: Viewer | undefined, sequence = 0, disposeMemoryLab: (() => void) | undefined;
let engineWorld: EngineWorld | undefined;
const worldButton = textElement('button', 'Собрать Baiern');
el('memory-lab').before(worldButton);
worldButton.onclick = () => { void openWorld('cars/racers/Baiern.rpk', 6); };
async function openWorld(pack: string, id: number) {
  if (!assets) return;
  const request = ++sequence;
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  engineWorld?.dispose(); engineWorld = undefined; viewer?.clear();
  el('filename').textContent = `${pack} : 0x${id.toString(16)} · сборка CFG`; el('format').textContent = 'ENGINE / WORLD'; status('Сборка…');
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  try {
    const built = await new PartFactory(assets).stock({ pack, id });
    if (request !== sequence) { built.world.dispose(); return; }
    engineWorld = built.world;
    const warnings = viewer ? await viewer.showWorld(built.world, assets) : ['WebGL недоступен'];
    if (request !== sequence) return;
    el('details').textContent = `${built.world.parts.size} объектов · ${built.root.definition.cfgPath}\nСборка по stockpart/slot/attach, включая вложенные детали. Java-конструкторы и физика ещё не запускаются.\n${[...built.warnings, ...warnings].join('\n')}`;
    status('Мир собран');
  } catch (error) { if (request === sequence) { engineWorld?.dispose(); engineWorld = undefined; viewer?.clear(); status('Ошибка сборки', true); el('details').textContent = String(error); } }
}
try { viewer = new Viewer(el('viewport')); }
catch (e) { el('details').textContent = `WebGL недоступен: ${e}`; }

function status(text: string, error = false) { el('state').textContent = text; el('state').classList.toggle('error', error); }
function textElement(tag: string, text: string, className?: string) {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
}

async function connect() {
  try {
    const response = await fetch('/api/game/index');
    if (!response.ok) throw new Error(await response.text());
    const files: Asset[] = await response.json();
    attach(new Assets(files, async path => {
      const result = await fetch(`/api/game/file?path=${encodeURIComponent(path)}`);
      if (!result.ok) throw new Error(await result.text());
      return new Uint8Array(await result.arrayBuffer());
    }), 'Локальная установка');
    const example = files.find(f => /baiern_data\/meshes\/chassis\.scx$/i.test(f.path)) ?? files.find(f => /steeringwheel_4spoke_01\.scx$/i.test(f.path));
    if (assets.byPath.has('cars/racers/baiern.rpk')) await openWorld('cars/racers/Baiern.rpk', 6);
    else if (example) await openAsset(example);
  } catch (e) {
    el('connection').textContent = 'Выбери папку игры';
    el('details').textContent = `Каталог игры недоступен. Выбери установленную игру кнопкой «Открыть папку игры». ${e}`;
    status('Нет каталога', true);
  }
}

function attach(source: Assets, label: string) {
  assets = source; el('connection').textContent = label;
  el('counts').replaceChildren(...['scx', 'rpk', 'class'].map(ext => {
    const card = document.createElement('div'); card.append(textElement('b', source.files.filter(f => f.path.toLowerCase().endsWith(`.${ext}`)).length.toLocaleString('ru')), textElement('span', ext.toUpperCase())); return card;
  }));
  el('total').textContent = `${source.files.length.toLocaleString('ru')} файлов`;
  renderList();
}

function renderList() {
  if (!assets) return;
  const q = el<HTMLInputElement>('search').value.toLowerCase().trim();
  const files = assets.files.filter(f => (kind === 'vehicle' ? isSavedVehiclePath(f.path) : f.path.toLowerCase().endsWith(`.${kind}`)) && f.path.toLowerCase().includes(q));
  const list = el('list'); list.replaceChildren();
  for (const file of files.slice(0, 250)) {
    const button = document.createElement('button'); button.className = 'asset'; button.title = file.path;
    button.append(textElement('span', file.path.split('/').at(-1)!), textElement('small', file.path.split('/').slice(0, -1).join('/')));
    button.onclick = () => { for (const child of list.children) child.classList.remove('selected'); button.classList.add('selected'); void openAsset(file); };
    list.append(button);
  }
  el('list-count').textContent = files.length > 250 ? `${files.length} найдено · показаны первые 250` : `${files.length} найдено`;
}

async function companionTextures(path: string) {
  const texPath = path.replace(/\.sc[xy]$/i, '.tex');
  if (!assets.byPath.has(texPath.toLowerCase())) return [];
  const prefix = path.slice(0, path.lastIndexOf('/') + 1);
  return new TextDecoder('windows-1252').decode(await assets.read(texPath)).split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(t => assets.byPath.has(t.replaceAll('\\', '/').toLowerCase()) ? t : prefix + t);
}

async function showModel(path: string, textures: string[] = [], request = sequence) {
  const model = parseScx(await assets.read(path));
  if (request !== sequence) return;
  el('viewport').hidden = false; el('inspector').hidden = true; el('scene-help').hidden = false;
  const resolvedTextures = textures.length ? textures : await companionTextures(path);
  if (request !== sequence) return;
  const warnings = viewer ? await viewer.show(model, assets, resolvedTextures) : ['WebGL недоступен'];
  if (request !== sequence) return;
  const vertices = model.meshes.reduce((n, m) => n + m.positions.length / 3, 0), faces = model.meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  el('details').textContent = `INVO v${model.version} · ${model.meshes.length} материалов · ${vertices.toLocaleString('ru')} вершин · ${faces.toLocaleString('ru')} треугольников\n${path}\n${warnings.join('\n') || 'Геометрия проверена. Масштаб подогнан для просмотра; физика и сборка автомобиля ещё не реализованы.'}`;
  status(viewer ? 'Модель загружена' : 'Нет WebGL', !viewer);
}

async function openAsset(file: Asset) {
  engineWorld?.dispose(); engineWorld = undefined; viewer?.clear();
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  const request = ++sequence;
  el('filename').textContent = file.path; el('format').textContent = (isSavedVehiclePath(file.path) ? 'SDAT' : file.path.split('.').at(-1)!.toUpperCase()) + ' / ORIGINAL ASSET';
  status('Загрузка…'); el('details').textContent = '';
  try {
    if (/\.scx$/i.test(file.path)) { await showModel(file.path, [], request); return; }
    const bytes = await assets.read(file.path);
    if (request !== sequence) return;
    const inspector = el('inspector'); inspector.replaceChildren(); inspector.hidden = false;
    el('viewport').hidden = true; el('scene-help').hidden = true;
    if (/\.rpk$/i.test(file.path)) {
      const pack = parseRpk(bytes);
      inspector.append(textElement('h2', 'Дерево ресурсов'), textElement('p', `RPAK 0x${pack.version.toString(16)} · ${pack.entries.length} записей · ${pack.dependencies.length} зависимостей`));
      const deps = document.createElement('pre'); deps.textContent = pack.dependencies.map(d => `${(d.id >>> 16).toString(16).padStart(4, '0')} → ${d.path}`).join('\n'); inspector.append(deps);
      const filter = document.createElement('input'); filter.placeholder = 'Фильтр по alias или ID'; inspector.append(filter);
      const table = document.createElement('div'); inspector.append(table);
      const draw = () => {
        table.replaceChildren(); const q = filter.value.toLowerCase();
        for (const entry of pack.entries.filter(e => `${e.alias} 0x${e.typeId.toString(16).padStart(8, '0')}`.toLowerCase().includes(q)).slice(0, 400)) {
          const row = document.createElement('details');
          row.append(textElement('summary', `0x${entry.typeId.toString(16).padStart(8, '0')}  ${entry.alias}  · type ${entry.type} · ${entry.size} B`));
          const props = entryProperties(entry);
          row.append(textElement('pre', props.length ? props.map(p => `${p.key} ${p.value}`).join('\n') : entry.data.length ? 'Бинарный payload: декодер этого типа пока отсутствует.' : 'Пустой payload'));
          if (props.some(p => p.key === 'native' && /^(car|part)\s/i.test(p.value))) {
            const spawn = textElement('button', 'Создать в мире');
            spawn.onclick = () => { void openWorld(file.path, entry.typeId); }; row.append(spawn);
          }
          if (props.some(p => ['mesh', 'render'].includes(p.key) || p.key === 'sourcefile' && /\.scx$/i.test(p.value))) {
            const button = textElement('button', 'Открыть связанную модель');
            button.onclick = async () => {
              const nextRequest = ++sequence;
              try { const target = await assets.modelForResource(file.path, entry.typeId); if (nextRequest === sequence) await showModel(target.path, target.textures, nextRequest); }
              catch (e) { el('details').textContent = String(e); status('Нет модели', true); }
            }; row.append(button);
          }
          table.append(row);
        }
      }; filter.oninput = draw; draw();
      el('details').textContent = pack.warnings.join('\n') || 'Таблица ресурсов разобрана полностью. Раскрой запись, чтобы увидеть свойства и перейти к модели.';
    } else if (isSavedVehiclePath(file.path)) {
      const saved = inspectSavedVehicle(bytes), encoded = serializeSdat(saved.sdat);
      const identical = encoded.length === bytes.length && encoded.every((v, i) => v === bytes[i]);
      inspector.append(textElement('h2', saved.name ?? 'Автомобиль без имени'));
      inspector.append(textElement('p', `SDAT type ${saved.sdat.type} · Vehicle v${saved.version} · Part v${saved.partVersion}`));
      inspector.append(textElement('pre', JSON.stringify({ chassis: saved.chassis, textureId: saved.textureId, meshId: saved.meshId, wear: saved.wear, tear: saved.tear, adjustedPosition: saved.adjustedPosition, adjustedRotation: saved.adjustedRotation }, null, 2)));
      inspector.append(textElement('h3', 'Таблица ресурсов для переноса'));
      inspector.append(textElement('pre', [...saved.sdat.packs].map(([id, path]) => `${id} → ${path}`).join('\n')));
      inspector.append(textElement('p', `${saved.sdat.unsaved.length} transient ресурсов · ${saved.sdat.payload.length} байт данных Java`));
      el('details').textContent = `${identical ? 'Decode → encode в памяти: все байты совпали.' : 'ВНИМАНИЕ: обратное кодирование отличается.'}\nБез записи на диск и вызовов старого EXE. Раскрыт заголовок автомобиля и контейнер; дерево деталей внутри payload пока не декодируется.`;
    } else if (/\.class$/i.test(file.path)) {
      for (const cls of parseTufa(bytes)) {
        inspector.append(textElement('h2', cls.name), textElement('p', `extends ${cls.superName || '—'} · TUFA 0x${cls.version.toString(16)} · ${cls.constants.length} констант · ${cls.trees.length} деревьев`));
        for (const method of cls.methods) {
          const details = document.createElement('details'), tree = cls.trees[method.tree];
          details.append(textElement('summary', `${method.name}${method.signature} · ${tree?.length ?? 0} узлов · flags 0x${method.flags.toString(16)}`));
          details.append(textElement('pre', tree?.map((n, i) => `${i.toString().padStart(4)}  op=0x${n.op.toString(16).padStart(2, '0')}  source=${n.source}${n.operand === undefined ? '' : `  operand=0x${n.operand.toString(16).padStart(8, '0')}`}`).join('\n') || 'Тело отсутствует: native/abstract/declaration candidate. Требуется проверка флагов.'));
          inspector.append(details);
        }
      }
      el('details').textContent = 'Структура TUFA и TREE разобрана. Опкоды показаны без предположений о семантике. Исполнение игровой логики пока не реализовано.';
    } else {
      inspector.append(textElement('pre', new TextDecoder('windows-1252').decode(bytes)));
      el('details').textContent = `${file.size.toLocaleString('ru')} байт · исходный текст, только чтение`;
    }
    status('Ресурс разобран');
  } catch (e) {
    if (request !== sequence) return;
    el('details').textContent = String(e); status('Формат не поддержан', true);
  }
}

el('search').oninput = renderList;
el('filters').onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-kind]'); if (!button) return;
  kind = button.dataset.kind!; for (const b of el('filters').children) b.classList.toggle('active', b === button); renderList();
};
el<HTMLInputElement>('folder').onchange = event => {
  const files = [...((event.target as HTMLInputElement).files ?? [])]; if (!files.length) return;
  const map = new Map(files.map(f => [f.webkitRelativePath.split('/').slice(1).join('/'), f]));
  attach(new Assets([...map].map(([path, f]) => ({ path, size: f.size })), async p => new Uint8Array(await map.get(p)!.arrayBuffer())), 'Выбранная папка');
  status('Каталог подключён');
};
void connect();
el('memory-lab').onclick = async () => {
  if (!assets) { status('Нет каталога', true); return; }
  const request = ++sequence;
  engineWorld?.dispose(); engineWorld = undefined; viewer?.clear();
  disposeMemoryLab?.(); disposeMemoryLab = undefined;
  el('viewport').hidden = true; el('scene-help').hidden = true;
  const inspector = el('inspector'); inspector.hidden = false; inspector.replaceChildren(textElement('p', 'Чтение оригинальных Java-методов…'));
  el('filename').textContent = 'Part.save/load · MemoryFile'; el('format').textContent = 'SOURCE RUNTIME / MEMORY STREAM'; status('Загрузка исходников…');
  try {
    const { mountMemoryLab } = await import('./memory-lab');
    if (request !== sequence) return;
    const dispose = await mountMemoryLab(inspector, assets, () => request === sequence);
    if (request !== sequence) { dispose(); return; }
    disposeMemoryLab = dispose; status('Поток готов');
    el('details').textContent = 'Оригинальные исходные методы исполняет ограниченный Java-интерпретатор. TUFA этих методов ещё не исполняется. Данные сборки проходят через собственную модель слотов и поток в памяти.';
  } catch (e) { if (request === sequence) { status('Ошибка исходников', true); el('details').textContent = String(e); } }
};
if (import.meta.hot) import.meta.hot.dispose(() => { sequence++; engineWorld?.dispose(); disposeMemoryLab?.(); viewer?.dispose(); });
