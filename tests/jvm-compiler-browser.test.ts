import assert from 'node:assert/strict';
import test from 'node:test';
import { floatLiteralBits as compilerFloatLiteralBits } from 'slrr-jvm-compiler';
import { floatLiteralBits } from 'slrr-jvm';

test('shared JVM float conversion matches the SLRR compiler without Node Buffer', () => {
  for (const mode of ['A', 'B', 'C', 'D'] as const)
    for (const literal of ['0.0', '0.1', '0.35', '0.475', '1.0', '205.0', '3.141592653589793', '1.2e-3', '7000'])
      assert.equal(floatLiteralBits(literal, mode), compilerFloatLiteralBits(literal, mode), `${mode} ${literal}`);
});
