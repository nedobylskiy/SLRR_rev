# Источники и происхождение сведений

Дата проверки ссылок: 24 октября 2026. Первичное доказательство для поддерживаемых структур — локальные файлы и воспроизводимые проверки. Внешние репозитории использованы как ориентиры, а не как гарантия корректности.

## Публичные разборы

1. [EliasFD3S/slrr-reverse](https://github.com/EliasFD3S/slrr-reverse), исследованный commit `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7`. Реконструкция на C++, MIT. Полезны [RPAK](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Core/Platform/rpak.cpp), [TUFA](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Core/Jvm/tufa.cpp), [TREE widths](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/include/tree_op_flags.inc), [SDAT/native File](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/IO/IO_part1.inc). Содержит heuristics и incomplete/stub пути: не является исходным движком разработчика.
2. [nonamesex/io_invo_scx](https://github.com/nonamesex/io_invo_scx), commit `7bcc34e51a3cb40369cc28db2950ab27f9587078`. Blender import SCX v3/v4 и [ImHex schema](https://github.com/nonamesex/io_invo_scx/blob/7bcc34e51a3cb40369cc28db2950ab27f9587078/imhex/scx.hexpat). В исследованном checkout отдельная лицензия не найдена; его исходник в новый проект не копировался. Собственный parser основан на проверке структуры локальных файлов.
3. [imagecode-git/slrr-javas](https://github.com/imagecode-git/slrr-javas) — опубликованные игровые Java. README описывает embedded VM и компиляцию scripts. Наличие этих Java не означает публикацию полного native engine.
4. [imagecode-git/slrr-tools](https://github.com/imagecode-git/slrr-tools) — инструменты проекта; обнаруженный репозиторий в основном содержит workshop tools. Не принят за библиотеку декодирования RPK.
5. [CookiePLMonster/SLRR-Proofix](https://github.com/CookiePLMonster/SLRR-Proofix) — отдельный проект исправлений, полезен для будущего сопоставления binary behavior. Его код в текущую реализацию не переносился.
6. [Connor-Moyle/blender-slrr-scx-importer](https://github.com/Connor-Moyle/blender-slrr-scx-importer) — дополнительный импортёр; просмотрен как источник сравнения. Его собственные эвристики и отличия тегов не перенесены в decoder.
7. [nedobylskiy/SLRRMultiplayer](https://github.com/nedobylskiy/SLRRMultiplayer) — обнаруженный публичный проект старого мода. Не считается доказательством, что нужные исходники сетевой реализации получены. Целевой репозиторий нового проекта: [nedobylskiy/SLRR_rev](https://github.com/nedobylskiy/SLRR_rev).

## Варианты JVM

[Doppio](https://github.com/plasma-umass/doppio) и [CheerpJ](https://github.com/leaningtech/cheerpj-meta) проверены как примеры browser Java runtimes. Поддержка TUFA ими не установлена. Технический выбор описан в `formats/tufa.md`, не является рекомендацией купить/лицензировать стороннюю платформу.

## Локальные первичные материалы

Установленные RPK/RDB, SCX, TUFA, CFG, Java; 139 SDAT; два разных EXE; `libcall.dll`; `Downloads/dllcall/{dllmain.cpp,dll.h,main.cpp}`; присланный `Object.java`; скриншот с авторским описанием runDLL/runMethod. Хеши сохранены в reports, содержимое сохранений не публикуется.

Дополнительный сторонний материал: переданный [рабочий архив Elias](elias-workspace-archive.md) с [прямой ссылкой на ZIP](https://drive.google.com/file/d/1jBThp7EfOokCvFS4ku7k6HihiGmYl7XP/view?usp=drivesdk). Его база IDA и комментарии дают новые гипотезы о native ABI, колёсной таблице и физическом шаге; игровые файлы из архива не публикуются в этом репозитории. Снимок отличается от обоих локальных EXE по SHA-256.

## Права и границы публикации

MIT notice внешней реконструкции сохранён в `THIRD_PARTY_NOTICES.md`, поскольку сведения о binary layouts и часть работы по TREE опираются на неё. Установленные npm зависимости сохраняют собственные лицензии. Игровые ресурсы, бинарники и частные исходники не добавлены в Git.

Сообщение владельца о передаче исходников разработчиком и согласии Activision — контекст задачи. Подтверждающий документ или полный переданный native source в ходе исследования не получены; это не фиксируется как установленный факт о лицензии игры. Публикуется новая реализация и описание наблюдённых форматов.
