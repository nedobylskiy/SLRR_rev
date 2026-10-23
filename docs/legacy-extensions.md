# Старые расширения, DLL и версии EXE

Исследованы только чтением: установленный EXE, присланный промежуточный EXE, `Downloads/dllcall` и `Downloads/Object.java`. Запуск старого FFI/EXE не выполнялся. Исходники частной DLL в публичный репозиторий не скопированы; сохранены хеши и описание API.

## Бинарники

| Артефакт | Размер | SHA-256 |
|---|---:|---|
| Промежуточный EXE из Downloads | 2441216 | 4052c78d499a765f3b063080f836db4ecfbae67d798bf1229b6357a2711afdb8 |
| EXE установленной игры | 2446848 | f44fb88a4335c657e20701cdb84afb8d1d85f7c3aceb93d30113e6e6e44fefc2 |
| libcall.dll в установке и Downloads | 1397055 | 3c45b26a08ab3af8c6e474b79ca1463a8d57eb87aaae1cbdcd6c0e3d39b9d7eb |

Оба EXE — PE32 x86, image base 0x400000. Промежуточный EXE: COFF symbol table/count = 0, debug directory отсутствует, RSDS/NB10/PDB-ссылка не найдены. Установленный EXE содержит debug entry type 13 (COFF groups), **не** таблицу имён функций и не PDB. Это не исключает полезных строк/RTTI, но полных debug symbols не обнаружено.

Строки runDLL, runMethod и libcall.dll найдены в обоих EXE. Само наличие строки не доказывает правильность реализации функции. Адреса из стороннего разбора относятся к его сборке; между этими двумя EXE даже расположение секций отличается.

Воспроизведение:

```powershell
python tools/inspect-pe.py '<path-to-exe>' '<path-to-libcall.dll>'
```

Результат первоначального сравнения: `reports/pe-comparison.json`.

## Подтверждённый API

По скриншоту автора и установленному Object.class:

```java
public native String runDLL(String dll, String function, String format, String[] args);
public native int runMethod(String method, int arg);
public native int runMethod(String method, float arg);
public native int runMethod(String method, Object arg);
public native int runMethod(String method);
```

Авторское описание на скриншоте говорит о вызове из экземпляра любого класса и поддержке одного аргумента у runMethod. Пример — вызов `updateVariables` на player.car. Реальное dispatch и корректность типов в EXE ещё не дизассемблированы.

`Object.java` из Downloads содержит runDLL, GC-методы и equals, но не runMethod. В его API есть hashCode, которого нет в установленном class; в class есть errorVM/osdCommand/handleOsdEvent. Не заменять установленный Object.class компиляцией этого файла без согласования версий.

В Chassis Java установленной игры объявлен `getAngvel()`. Это полезный native getter угловой скорости для будущего сетевого snapshot, но setter, frame of reference и единицы ещё требуют проверки.

## ABI libcall

`dll.h`: экспорт C `char* callFunction(char* library, char* function, char* prototype, char** argv)`. `.def` подтверждает экспорт `callFunction @1`. Используются LoadLibrary/GetProcAddress и libffi. Прототип — `resultType:argType;argType`; без двоеточия — вызов без аргументов. Аргументы передаются строками и конвертируются в int/uint/uint64/float/double/pointer; прочие имена трактуются как string/pointer.

В примере `main.cpp` функция DLL объявлена как `__stdcall`, тогда как экспорт в header не задаёт этот calling convention. Соответствие компиляторных настроек нужно проверить отдельно. Сам вызываемый DLL-экспорт использует FFI_DEFAULT_ABI; Win32 stdcall/cdecl нельзя смешивать без описания ABI.

## Обнаруженные дефекты исходника dllmain.cpp

Это статические находки, **не объяснение заявленной владельцем утечки сохранения автомобиля**:

| Место | Проблема |
|---|---|
| 84–102 | values[i] получает адрес локальной tmp внутри ветки; к ffi_call время жизни закончено |
| 104–106 | pointer argument кладётся как сам адрес, хотя libffi нужен адрес хранилища значения указателя |
| 92 | uint64 разбирается через atoi, возможна потеря старших битов |
| 116–118 | ffi_arg используется для всех return types; float/double требуют правильного типизированного хранения, для double/uint64 x86 буфер может быть слишком мал |
| 122–123 | new[] освобождается через delete, а не delete[] |
| 124 | удаляется указатель на глобальный ffi_type_*, не принадлежащий функции |
| 52, 118 | нет проверки успешности LoadLibrary и GetProcAddress перед вызовом |
| 52 | нет симметричного FreeLibrary; многократная загрузка увеличивает refcount модуля |
| 153–169 | strdup создаёт возвращаемый буфер без явно описанного освобождения в ABI; uint выводится как signed int; float/double получаются числовым приведением ffi_arg вместо чтения корректного результата |

Для старого моста нужна отдельная исправленная реализация с RAII, хранилищем аргументов достаточного времени жизни, union/variant результата, проверенным ABI и экспортом free-result. Установленная DLL не изменялась.

## Новый движок

`NativeRegistry` различает перегрузки по descriptor. `LegacyDllBridge` сохраняет строковый контракт runDLL для явно зарегистрированных JS-экспортов. Неизвестная capability выдаёт ошибку. Этот модуль не исполняет Windows DLL в браузере и не эмулирует произвольные старые указатели.
