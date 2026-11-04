# Catalog resource identity

Catalog.java walks `parts:0xF229` for suspensions. Its car-pack filtering compares
`ResourceRef.id() >> 16` with `Vehicle.getInfo(GII_TYPE) >> 16` and vehicle-type
root IDs. Resource-tree lookup also relies on the low word identifying the
original local RPK entry.

Previously SDAT remount IDs were a sequential counter at `0x50000000`. Thus
remounting `F229` did not preserve `F229` in the low word; catalog child lookup
could select an unrelated parent or return nothing. Materialized children also
used bare local IDs, collapsing their pack prefixes to zero.

Remounted resource IDs now allocate one high-word namespace per pack in the
`0x5000..0x5fff` range and retain the local entry in the low word. Catalog child
handles and GII_TYPE share this mapping. Resource metadata continues to carry
the original `(pack path, local ID)` for persistence; namespaces are session-local.

Boot indexes car/part RPK metadata before Java enumerates the resource tree,
including dummy/category nodes whose descendants have not been instantiated.
SCX geometry, textures and part constructors remain lazy.

Regression coverage checks cross-pack children with identical local IDs,
remounted category roots, nested traversal, matching chassis pack arithmetic,
and recreating scripted resources from GII_TYPE. A local probe ran the original
Catalog.collectObjectsStep against the installed game resources: Suspensions
collected 100 entries, beginning with the eight Focer WRC/300 entries shown in
the reference. No replacement catalog list or Java filtering code was added.
