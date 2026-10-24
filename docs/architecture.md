# Архитектура нового движка

## Реализовано

Приложение TypeScript + Vite + Three.js/WebGL 2. Чистые бинарные парсеры не зависят от DOM и используются браузером и Node CLI. Локальный сервер выдаёт только разрешённые типы ресурсов, привязан к 127.0.0.1 и проверяет реальный путь после разрешения symlink. Он не пишет в игру и не выдаёт EXE/DLL. Статическая сборка работает с выбранной пользователем папкой, без локального API.

| Модуль | Ответственность |
|---|---|
| `src/binary.ts` | Чтение LE с контролем границ |
| `src/formats/rpk.ts` | Таблицы RPAK, текстовые RDB/RSD |
| `src/formats/scx.ts` | Геометрия SCX v3/v4 |
| `src/formats/tufa.ts` | TUFA, типизированные CONS, методы, TREE |
| `src/formats/sdat.ts` | SDAT envelope, embedded blobs, заголовок Vehicle |
| `src/formats/cfg.ts` | Поднабор CFG, слоты, stockpart, body/wheel, неизвестные команды |
| `src/engine/world.ts` | Фабрика ресурсов, экземпляры мира, дерево слотов, матрицы, lifecycle |
| `src/engine/part-host.ts` | Четыре Part native для обхода настоящего CFG-мира через script handles |
| `src/engine/slot-frames.ts` | Поза typed-крепления: root, steering, wheel |
| `src/engine/driving-demo.ts` | Управляемая плоская кинематическая модель, одинаковая в браузере и Node |
| `src/assets.ts` | VFS, нормализация путей, pack-local resource graph |
| `src/render/viewer.ts` | GPU-геометрия, камера, текстуры, освобождение объектов |
| `src/runtime/tree-machine.ts` | Проверенный минимальный leaf-поднабор TREE |
| `src/runtime/native-registry.ts` | Descriptor-aware native calls, контракт runDLL |
| `src/runtime/memory-file.ts` | Примитивный поток в памяти |
| `src/runtime/java-source.ts` | Ограниченный интерпретатор выбранных Java-методов |
| `src/runtime/part-assembly.ts` | Host Part/save/load и транзакционное восстановление в памяти |
| `src/runtime/vehicle-state.ts` | Проверяемый SRVS snapshot codec |
| `src/runtime/fixed-clock.ts` | Фиксированный шаг с явным backlog |
| `tools/` | Воспроизводимые исследования и проверки корпуса |

Появился [первый CFG-мир](engine-world.md) с рендером сборки. Snapshot codec, native registry и [Part source runtime](part-runtime.md) ещё требуют интеграции с ним. Физика и общий запуск скриптов отсутствуют.

## Целевая структура — проектное решение

Данные ресурсов → world model → simulation → snapshots. Renderer подписывается на world state, но не является владельцем gameplay. Та же simulation должна запускаться в Node без камеры и WebGL для серверных тестов.

VM получает host API через NativeRegistry. Ключ — class+method+descriptor. Неизвестная native-функция завершает вызов диагностикой, а не возвращает успешный ноль. По мере реализации API вести покрытие: missing, stub, tested, compatible. Нельзя подменить таблицу coverage количеством зарегистрированных пустых функций.

ResourceManager должен разделить immutable assets, mutable instances и transient-generated textures. Стабильный ResourceKey хранит полный нормализованный путь пакета и local ID; manifest хранит хеши пакетов, скриптов, CFG и геометрии. Порядок загрузки не должен влиять на сетевую идентичность.

World model хранит машину как дерево установленных деталей с явными ID и связями слотов. Жизненный цикл: allocated → configured → attached → active → removed. Физическое тело, VM-instance и render proxy имеют явного владельца. При dispose освобождаются не только JS-ссылки, но и GPU/physics/audio resources.

Для рендера Three.js остаётся заменяемым backend. Сначала воспроизводятся исходные геометрия/UV/material slots, затем добавляются normal/reflection/layers/paint. Exact appearance не должен тормозить проверку семантики скриптов и состояния автомобиля.

## Полная физика — ещё не реализована

Основное требование — деформируемые детали и разрушаемые крепления. [Прототип оригинального капота](hood-prototype.md) уже проверяет остаточную деформацию, отрыв трёх опор и падение на пол через собственный XPBD-каркас. Он изолирован от driving demo и логического дерева EngineWorld; общего автомобильного solver ещё нет. [Аудит найденного реверса и проектное направление](deformable-physics.md). Предположение, что оригинальный SLRR использовал именно node-beam, пока не подтверждено.

Есть [пробная поездка](mounts-and-driving.md) с плоской bicycle-кинематикой и анимацией экземпляров; это не solver столкновений/подвески и не исполнение оригинального drivetrain. Полные native-физика и игровая логика остаются следующими этапами.

Перед выбором backend нужны единицы, оси, описание suspension/tyre/engine API и тесты. Возможен WASM-backend; TypeScript продолжит владеть игровыми правилами. Собственная физика не гарантирует совпадения старого поведения. Начальный критерий — управляемая машина с воспроизводимыми native getters/setters, затем сравнение торможения/ускорения/подвески.

## Исполнение скриптов

Ближайший путь — TREE reference interpreter с трассировкой и fail-closed поведением. Сначала вызовы и поля, затем массивы и контроль потока, class initialization и GC, затем File/Part.save/load. После этого рассматривается lowering в JS/WASM ради скорости. Ошибки видны с class, method, source и op.

Обработка `.java` — отдельный compiler frontend со специфическим resource literal синтаксисом и integer truthiness. Прямой `javac` не является совместимым решением. Возможность сторонней JVM требует адаптера TUFA/исходников и native library; она не отменяет работу над host API.

## Граница Windows DLL

WebGL работает в браузере, произвольную Win32 DLL браузер загрузить не может. Для переносимых модов нужно JS/WASM-представление их функций. Для Windows-расширений возможен desktop host с явным перечнем экспортов и определённым ABI. Он остаётся необязательным backend; сервер и чистый браузер не должны зависеть от указателей 32-битного EXE.

`LegacyDllBridge` сейчас поддерживает только зарегистрированные синхронные JS capability-функции с тем же строковым контрактом. Самостоятельного Win32 FFI backend нет.
