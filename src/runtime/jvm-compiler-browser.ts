// The compiler package root also exports Node-only file tooling. The browser
// needs only its pure source parser; SLRR-JVM supplies shared float conversion.
export { parseSource } from '../../node_modules/slrr-jvm-compiler/dist/src/source.js';
