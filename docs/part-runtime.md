# Part.save/load via memory: saved research result

`src/runtime/java-source.ts` parses a limited subset of Java and interprets selected methods without `eval`, `Function`, or access to ambient JS. `src/runtime/part-assembly.ts` implements explicit host operations: instances, slots, resources, File primitives, damage and tuning. **methods from local Java sources** are executed, not TUFA of these methods. This is not a general JVM yet.

`PartAssemblyRuntime.serialize(root)` calls virtual `save` via MemoryFile and outputs SDAT type 2 to Uint8Array. `restore(bytes, replace?)` calls the original `Part.createFromFile` and the virtual `load` in a separate prepared world. Only after a complete read, checking the numbers and the tree, is it registered and replace is destroyed. In case of an error, the prepared objects are released, the old world remains working. Vehicle files are not written to disk.

`npm run verify:parts` reads seven original sources: Part, BodyPart, Chassis, RGearPart, ReciprocatingRGearPart, Tyre, ShockAbsorber. The check creates a **synthetic** assembly of 10 parts with explicit definitions, performs a real initial save/load, compares the tree and bytes, does 1000 restores and checks the immutability of counters. Additionally, rollback at late NaN, standard clamp of the shock absorber and independence of the restored assembly are checked. For the examined set, 1106 bytes are obtained. Report `local/parts-verification.json` includes source SHA and method traces; source bodies are not copied to the repository.

Super/virtual calls, local variables, loops and conditions, arithmetic, typed int/float and the necessary host classes are supported. Instructions, call depth, number of parts, and buffer size are limited. Unknown methods/grammar fails. Custom game class constructors, arrays, and the full Java frontend are not yet supported. The host values for this test are specified explicitly; `forceUpdate` is counted as a challenge, it does not recalculate physics.

This is not a universal save decoder: subclasses with other tails require the execution of their sources and host API. This is also not a full Vehicle v5 file, nor a dynamic race condition, nor a fix for the old EXE leak. Counters check ownership of a given model, but do not replace heap/GPU/physics profiling.

The priority is now [single engine world](engine-world.md). This runtime and check are stored as a compatibility subsystem; integration with the CFG world will require an explicit adapter instead of two independent part models.
