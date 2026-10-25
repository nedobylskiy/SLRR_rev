# Java dialect, TUFA and TREE

`.class` in this game is not a standard Java classfile. All 2921 local files have `TUFA`, not `CAFEBABE`. There are 2993 classes: one file can contain several consecutive TUFA blocks. Implementation: `src/formats/tufa.ts`.

## Container

Each section: tag char[4], payload size u32 LE, payload[size]. The first section is `TUFA`, size 4, then the u32 version. Found 0x11ae1 (5 files), 0x24f5c (159), 0x24f9d (2757). These are format/compiler versions, not proof of the game version.

Next CONS, FILD, MTHD, CLSS, TREE in the order they occur. The next `TUFA` starts the next class. The parser checks the length of sections and does not look for magic lines inside the payload.

## CONS - pool of constants

At the beginning u32 count. Each entry begins with **explicit u32 kind**:

| kind | Payload |
|---:|---|
| 0 |u32 text length without NUL, bytes[length], NUL|
| 1 |u32 scalar bits; precise semantics requires analysis of usage|
| 2 |u32 scalar bits; precise semantics requires analysis of usage|
| 3 | u32 package-string index, u32 local resource ID |
| 4 |u32 string index for class name|
| 5 | u32 class reference, u32 name-and-type reference |
| 6 |Two u32 reference; difference from 5 requires checking native/VM paths|
| 7 | u32 name-string index, u32 descriptor-string index |

After kind 4 **there is no required zero padding**: the next zero word is often the kind 0 of the next line. The public C++ parser uses heuristics to try to compensate for this. Our parser reads types directly: all CONS of the local corpus are consumed exactly, without any leftovers. Short strings `I`, `F`, `log` cannot be guessed by their length.

The string encoding is currently interpreted as Windows-1252. For non-ASCII mods, the code page must be checked separately.

## CLSS

The first five u32: service fields, class reference at +8, superclass reference at +12, interface data further. To obtain the name, class reference kind 4 is resolved to the string kind 0. Unknown fields are stored in the raw section and are not used as dummy access flags.

## MTHD

Two sequentially written sections: u32 number of entries of the first; records 20 bytes; u32 number of records of the second; records are 20 bytes. Each entry is flags, name index, descriptor index, TREE index, local count (five u32).

In external parsing there is a heuristic with an alternative order of fields. It was not required on the studied body. The purpose of the sections must be determined by the source compiler/disassembly; We don’t arbitrarily call them constructor/native.

In the installed Object, `wait` and `runDLL` have flags=0x41, `equals`=0x1, static native methods like Integer.toString have 0x49. This confirms the native bit 0x40 and static bit 0x8 for these classes; the remaining bits should not be automatically borrowed from JVMS. The usual `finalize`, `osdCommand` also have an empty TREE; emptiness does not prove native.

Descriptors are similar to JVM, but use dots in fully qualified names. The constructor can have `()` without returning `V`. The signature is included in the native call key: the name `runMethod` cannot be used to select an overload.

## TREE

u32 tree count; further for each u32 node count and nodes of variable length: op u8, source/service field u16, optional operand u32. Field u16 matches the source lines in the tested examples; it cannot be considered a register index.

Nodes have 7 bytes for op:

```text
01 02 03 06 07 08 09 0A 0B 0D 0E 0F 11 12 14 15 16 17
19 1A 1B 1C 1E 1F 25 26 27 2E
```

The remaining nodes encountered are 3 bytes. The table is based on [public reconstruction](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/include/tree_op_flags.inc) and verified by accurate consumption of all TREE sections. Their semantics **not** coincide with Java bytecode. Even the op names in some older research tools contradict later implementations of the same project.

### First verified launch

`src/runtime/tree-machine.ts` executes a small set of leaf expressions. `npm run verify:vm` loads the **original** `system/scripts/lang/Object.class` and executes it `equals` without replacing the call with a JavaScript function by name:

```text
equals(self)  → 1
equals(other) → 0
equals(null)  → 0
```

For this, load local 0x01, block marker 0x03, operator selector 0x07 with operand=7 (equality), expression evaluate 0x28 and return 0x2b are confirmed. Additionally, direct numbers, strings and null are implemented; a full run of their semantics is still necessary. An unknown opcode stops the call **before** the body is executed. There is no silent skipping of commands or selection of arguments by method name.

This is not the execution of all game logic. There are no fields, VM/GC objects, dispatch inheritance, calls, arrays, loops, scheduler Java threads and `.java` compilation. NativeRegistry is still a separate contract; native game functions are not implemented.

## Submitted by Object.java

The hash and size are in `docs/reports/user-source-metadata.json`; The sent source itself has not been copied to the public repository.

Declares root `java.lang.Object`, wait/notify/notifyAll, toString, hashCode, enableGC/disableGC, runDLL and equals with an int returned. It does not have runMethod, errorVM, osdCommand, handleOsdEvent. The installed class has these methods, but hashCode is missing. This means that the found source cannot certainly be considered the exact source version of the installed Object.class.

The comments about an empty finalize and a required constructor provide a guide to compatibility, but do not in themselves reveal the GC algorithm. The new engine should not use disableGC as a fix for the serialization leak.

## Why not just a third party JVM

[Doppio](https://github.com/plasma-umass/doppio) - browser JVM; [CheerpJ](https://github.com/leaningtech/cheerpj-meta) is a runtime environment for regular Java applications in the browser. Their descriptions do not state support for Invictus TUFA/TREE. You will need to either convert TUFA to standard bytecode, or source normalization and compilation, plus your own native API system library. Having a browser-JVM by itself does not solve this project.

The current choice is your own decoder and gradual confirmation of TREE semantics. The possibility of a WASM interpreter or translation into JS remains open after checking for correctness.
