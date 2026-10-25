# Other formats and boundaries of knowledge

## CFG

Text strings key + values, comments `;` and in some places `//`. One key can be repeated. `slot`, `attach`, `render`, `mesh`, `texture`, mass/inertia, spring/tire parameters and tuning commands form several different grammars, rather than one key-value table.

Implemented an ordered parser for the subset slot/attach/compatible/slottype/stockpart, render/deformable/mesh/texture, body, wheel, steering and maxsteer with number checking. RIDs with suffix r and leading zeros with a value of u32 are supported. The factory combines mounts taking into account aliases, wheel/steering wheel frames and render pose; [details and restrictions](../mounts-and-driving.md). The universal scheme of all CFGs, suspension/compound/bone frames and the full physical meaning of the numbers have not yet been implemented. Unknown commands are stored in diagnostics.

## Images and sound

DDS: container with different formats, not one universal RGBA stream. Three.js DDSLoader reads header and mipmaps; checking hardware compression support is required. PNG/JPEG/TGA are used for models, interface and coloring. In `save`, files with endings `.1`, `.2`, etc. often have a JFIF signature - the extension is not a type.

WAV/MP3 recognized by names/case. The audio subsystem of the new engine has not yet been connected; The future Web Audio backend should replicate channel priorities and positional audio.

## Maps and collisions

Large map RPKs may contain embedded binary data. POLY/PHYS names appear in community research, but their full structure has not been established here. A map's external `.scx` can be an empty placeholder; that alone does not mean the map is empty.

Needed: a directory of chunk tags with dimensions, mapping of built-in render/physics, coordinate system, instancing, spatial index, routes and starting positions. Before this, viewing individual meshes is not the same as loading the route.

## Animation and other data

The installation contains `.bon`, `.skl`, `.smb`, `.vax`, `.vaz`, `.spl`, `.scm`, `.box`, `.matrixdata`, `.ptx`, `.walk`, `.trc`, `.rest`. Their names help identify groups for study, but do not serve as specifications. Own decoders for them have not yet been written. Skeletal chunks of SCX v4 are structurally bypassed, but the bone system and animation are not restored.

For each of the following formats: collect signatures and versions, find the source tool, check the boundaries on the entire corpus, then compare the meaning with the running game. Don't include fictitious schema in production code.
