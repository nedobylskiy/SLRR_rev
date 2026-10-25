# Sources and origin of information

Links checked on October 24, 2026. Local files and reproducible checks are the primary evidence for supported structures. External repositories are research references, not guarantees of correctness.

## Public discussions

1. [EliasFD3S/slrr-reverse](https://github.com/EliasFD3S/slrr-reverse), explored by commit `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7`. Reconstruction in C++, MIT. Useful [RPAK](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Core/Platform/rpak.cpp), [TUFA](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Core/Jvm/tufa.cpp), [TREE widths](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/include/tree_op_flags.inc), [SDAT/native File](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/IO/IO_part1.inc). Contains heuristics and incomplete/stub paths: not the developer's original engine.
2. [nonamesex/io_invo_scx](https://github.com/nonamesex/io_invo_scx), commit `7bcc34e51a3cb40369cc28db2950ab27f9587078`. Blender SCX v3/v4 importer and [ImHex schema](https://github.com/nonamesex/io_invo_scx/blob/7bcc34e51a3cb40369cc28db2950ab27f9587078/imhex/scx.hexpat). No separate license was found in the examined checkout, so its source was not copied into this project. Our parser is checked against the local file corpus.
3. [imagecode-git/slrr-javas](https://github.com/imagecode-git/slrr-javas) — published game Java sources. Its README describes the embedded VM and script compilation. These files do not constitute a complete native engine.
4. [imagecode-git/slrr-tools](https://github.com/imagecode-git/slrr-tools) — tools primarily for modding and workshops; this project does not treat it as an RPK decoding library.
5. [CookiePLMonster/SLRR-Proofix](https://github.com/CookiePLMonster/SLRR-Proofix) - separate fix project, useful for future binary behavior mapping. Its code was not transferred to the current implementation.
6. [Connor-Moyle/blender-slrr-scx-importer](https://github.com/Connor-Moyle/blender-slrr-scx-importer) - additional importer; viewed as a source of comparison. Its own heuristics and tag differences are not carried over to the decoder.
7. [nedobylskiy/SLRRMultiplayer](https://github.com/nedobylskiy/SLRRMultiplayer) - discovered public project of the old mod. It is not considered proof that the necessary sources of the network implementation have been obtained. Target repository of the new project: [nedobylskiy/SLRR_rev](https://github.com/nedobylskiy/SLRR_rev).

## JVM options

[Doppio](https://github.com/plasma-umass/doppio) and [CheerpJ](https://github.com/leaningtech/cheerpj-meta) are tested as examples of browser Java runtimes. They do not have TUFA support installed. The technical choice is described in `formats/tufa.md` and is not a recommendation to buy/license a third-party platform.

## Local primary sources

Installed RPK/RDB, SCX, TUFA, CFG, and Java files; 139 SDAT files; two different EXEs; `libcall.dll`; `Downloads/dllcall/{dllmain.cpp,dll.h,main.cpp}`; a supplied `Object.java`; and a screenshot of the author's description of `runDLL/runMethod`. Hashes appear in reports; save contents are not published.

Additional third-party material: the contributed [Elias working archive](elias-workspace-archive.md), available as a [ZIP](https://drive.google.com/file/d/1jBThp7EfOokCvFS4ku7k6HihiGmYl7XP/view?usp=drivesdk). Its IDA database and comments suggest hypotheses about the native ABI, wheel table, and physics data stride. Game files from the archive are not published here. The archived EXE has a different SHA-256 from both local EXEs.

## Rights and boundaries of publication

The MIT notice for external reconstruction is stored in `THIRD_PARTY_NOTICES.md`, since the information about binary layouts and some of the work on TREE rely on it. Dependencies installed by npm retain their own licenses. Game assets, binaries, and private sources are not added to Git.

The owner's message about the transfer of the source code by the developer and the consent of Activision is the context of the task. A supporting document or complete submitted native source was not received during the study; this is not recorded as an established fact about the game's license. A new implementation and description of the observed formats are published.
