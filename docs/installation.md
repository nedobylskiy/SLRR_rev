# Device of the investigated installation

There are 25105 files in total. Full quantities and sizes are reproduced by `npm run audit`.

|Extension|Quantity|Purpose/level of confirmation|
|---|---:|---|
| `.java` | 3454 |Sources of game logic and mods|
| `.class` | 2921 |TUFA, not a standard JVM classfile|
| `.rpk` | 147 |All have RPAK version 0x200|
| `.rdb` | 118 |Textual representation of resource descriptions|
| `.scx` | 6033 |3532 INVO v3, 2500 INVO v4, 1 file of length 0|
| `.scy` | 35 |Additional models; the parser has not yet been specifically tested on this entire corpus|
| `.cfg` | 3194 |Text parameters of parts, slots, physical objects|
| `.dds` | 3296 |Textures|
| `.png` | 1685 |Textures and interface|
| `.tex` | 866 |Lists of textures next to models|
| `.wav` | 337 |Sounds|

## Layers

`system/scripts/{lang,io,net,render,sound,util}` contains the core class library, primarily in TUFA. The Java sources of this system library were not found in the examined `system`.

`sl/Scripts/game/src` contains management of career, garage, tracks, interface, car. Additional modes are found in `Gamemodes`.

`parts/scripts` contains a hierarchy of parts, engine, chassis, body. Many nodes implement their own `save/load`, so a generic Java field dump is not a replacement for part serialization.

`cars/racers/*_data` contains configurations, models, and classes for specific vehicles. `maps`, `misc`, and `objects` connect world resources and geometry through RPK; not every map has a separate nonempty SCX.

`save` contains SDAT and coloring side images. For multiplayer, these images should be considered as separate data, not just texture ID values.

`multibot` is present in the installation, but the directory name in itself is not proof of the presence of the network mod sources.

## What remains beyond the Java border

Native declarations and resource properties `native` associate scripts with physics, world objects, models, camera, input, sound, file operations and lifecycle. Removing game Java does not restore these functions. Even a full-fledged standard JVM requires re-implementing the native API and a specific language dialect.

The study was carried out without changing the installation, running its EXE, running resdecode/resconvert and writing saves.
