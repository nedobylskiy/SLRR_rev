# Old extensions, DLLs and EXE versions

Examined by reading only: installed EXE, sent intermediate EXE, `Downloads/dllcall` and `Downloads/Object.java`. The old FFI/EXE failed to launch. The private DLL sources are not copied to the public repository; hashes and API description are saved.

## Binaries

|Artifact|Size| SHA-256 |
|---|---:|---|
|Intermediate EXE from Downloads| 2441216 | 4052c78d499a765f3b063080f836db4ecfbae67d798bf1229b6357a2711afdb8 |
|EXE of the installed game| 2446848 | f44fb88a4335c657e20701cdb84afb8d1d85f7c3aceb93d30113e6e6e44fefc2 |
|libcall.dll in installation and Downloads| 1397055 | 3c45b26a08ab3af8c6e474b79ca1463a8d57eb87aaae1cbdcd6c0e3d39b9d7eb |

Both EXEs are PE32 x86, image base 0x400000. Intermediate EXE: COFF symbol table/count = 0, debug directory missing, RSDS/NB10/PDB link not found. The installed EXE contains debug entry type 13 (COFF groups), **not** a table of function names and not a PDB. This does not exclude useful strings/RTTI, but full debug symbols are not found.

The lines runDLL, runMethod and libcall.dll are found in both EXEs. The mere presence of a string does not prove that the function is implemented correctly. Addresses from a third-party parsing refer to its assembly; Even the section layout is different between these two EXEs.

Playback:

```powershell
python tools/inspect-pe.py '<path-to-exe>' '<path-to-libcall.dll>'
```

The result of the initial comparison: `reports/pe-comparison.json`.

## Verified API

According to the author's screenshot and the installed Object.class:

```java
public native String runDLL(String dll, String function, String format, String[] args);
public native int runMethod(String method, int arg);
public native int runMethod(String method, float arg);
public native int runMethod(String method, Object arg);
public native int runMethod(String method);
```

The author's description in the screenshot talks about calling any class from an instance and supporting one argument for runMethod. An example is calling `updateVariables` on player.car. The actual dispatch and type correctness in the EXE have not yet been disassembled.

`Object.java` from Downloads contains runDLL, GC methods and equals, but not runMethod. Its API has a hashCode that is not in the installed class; the class contains errorVM/osdCommand/handleOsdEvent. Do not replace installed Object.class by compiling this file without versioning.

In the Chassis Java of the installed game, `getAngvel()` is declared. This is a useful native angular velocity getter for a future network snapshot, but the setter, frame of reference, and units still need to be checked.

## ABI libcall

`dll.h`: export C `char* callFunction(char* library, char* function, char* prototype, char** argv)`. `.def` confirms the export of `callFunction @1`. LoadLibrary/GetProcAddress and libffi are used. Prototype - `resultType:argType;argType`; without colon - call without arguments. Arguments are passed as strings and converted to int/uint/uint64/float/double/pointer; other names are treated as string/pointer.

In the `main.cpp` example, the DLL function is declared as `__stdcall`, while the header export does not specify this calling convention. Compliance of compiler settings must be checked separately. The export DLL itself being called uses FFI_DEFAULT_ABI; Win32 stdcall/cdecl cannot be mixed without an ABI description.

## Detected defects in the source code dllmain.cpp

These are static findings, **not an explanation for the owner's claimed leak of car preservation**:

|Place|Problem|
|---|---|
| 84–102 |values[i] gets the address of the local tmp inside the branch; to ffi_call life time is over|
| 104–106 |pointer argument is put as the address itself, although libffi needs the address of the storage of the pointer value|
| 92 |uint64 is parsed via atoi, high bits may be lost|
| 116–118 |ffi_arg is used for all return types; float/double require proper typed storage, for double/uint64 x86 the buffer may be too small|
| 122–123 |new[] is deallocated via delete, not delete[]|
| 124 |the pointer to the global ffi_type_*, which does not belong to the function, is deleted|
| 52, 118 |no success check for LoadLibrary and GetProcAddress before calling|
| 52 |no symmetrical FreeLibrary; multiple loading increases the module refcount|
| 153–169 |strdup creates a return buffer without explicitly deleting it in the ABI; uint is output as signed int; float/double are obtained by numeric casting ffi_arg instead of reading the correct result|

The old bridge needs a separate fixed implementation with RAII, argument storage of sufficient lifetime, union/variant result, verified ABI and free-result export. The installed DLL was not changed.

## New engine

`NativeRegistry` distinguishes overloads by descriptor. `LegacyDllBridge` saves the runDLL string contract for explicitly registered JS exports. Unknown capability throws an error. This module does not execute Windows DLLs in the browser and does not emulate arbitrary old pointers.
