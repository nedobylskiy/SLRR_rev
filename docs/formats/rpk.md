# RPK / RPAK and RDB

Implementation: `src/formats/rpk.ts`. Complete table traversal of all 147 local RPKs has been confirmed. Getting Started: [public C++ RPAK reconstruction](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Core/Platform/rpak.cpp); specific fields are checked against local RDBs and bytes.

All multibyte numbers are little-endian. The RPK here is a resource container and dependency graph, not a ZIP with models. Payload can be text or inline binary blocks.

## Heading

|Bias|Type|Meaning|
|---:|---|---|
| 0 | char[4] | `RPAK` |
| 4 | u32 | 0x200 |
| 8 | u32 |Number of group A dependencies|
| 12 | u32 |Number of group B dependencies|
| 16 | records[sum] |Dependencies 64 bytes|

Dependency entry: u32 ID, char[56] path with NUL, u32 trailer. The upper 16 bits of the ID specify the external package number in the links of this container. The last dword is saved without interpretation.

After the dependencies there are four u32: the size of the record table in bytes, the number of records, two service values. Then the table itself is variable length. The parser requires an exact match of the end of the table and checks the payload boundaries of each resource.

## Resource record

|From the start of recording|Type|Purpose|
|---:|---|---|
| +0 | u32 | super/parent resource ID |
| +4 | u32 |type ID of this resource|
| +8 | u8 | typeof |
| +9 | u8 | flags |
| +10 | f32 |isparentcompatible; mapped to RDB|
| +14 | u32 |Absolute payload offset in the file|
| +18 | u32 |Payload size|
| +22 | u8 |Size of alias including terminating NUL in observed records|
| +23 | bytes[n] | alias |
|further| f32[12] |Present when flags & 1; transform is stored without interpretation for now|

The statement that +10 is just padding is found in external parses, but in the local `maps.rpk` it is float 1.0 and corresponds to `isparentcompatible 1.00` in `maps.rdb`.

## ID and link resolution

Inside the RPK: `high16=0` is the current package, `high16!=0` is the dependency through its table. `low16` - local ID. The global IDs of the running game depend on the load order; they cannot be transferred between clients.

The new engine uses the `{pack: normalizedPath, localId}` pair. The session manifest must additionally check the content hash. Basename is not sufficient: mods can have the same name in different directories.

Source Java has literals of the form `frontend:0x0000C10Cr` - this is a language extension and not valid regular Java syntax. A separate packet resolution step is needed.

Typical chain: part life → `render` → `mesh` → `sourcefile ...scx`. `texture` occurs multiple times and sets the order of the material texture table. Losing duplicate fields breaks indexes. `src/assets.ts` enables this circuit and detects loops.

Frequent typesof visible in `system.rdb`: 5 mesh, 7 texture, 8 game type, 9 physics body, 14 render object. These are context types; The full semantics of the remaining values must be checked with the base package.

## RDB

`<FILE name > ... </FILE>` text blocks, including `external_links`, `.res` and `.rsd`. `.res` contains metadata (typeof, superid, typeid, alias), `.rsd` contains resource properties. This is not general purpose XML: existing files contain comments, duplicate names and identifiers.

`parseRdb` preserves blocks and property order. While it serves the inspector, it is not a reversible RDB→RPK compiler. The resdecode/resconvert supplied with the game is in `modding_tools/Resource tools`; their presence does not mean that they are used by the new engine.

## Restrictions

Built-in map geometry/collisions, inheritance properties, and general traversal hierarchies are not yet enforced. Text `sourcefile` is read; binary POLY/PHYS do not pretend to be text RSD. The transform format and the remaining flag bits require separate checking.
