import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assets } from '../src/assets';
import { bootGame, type BootEvent } from '../src/runtime/game-boot';

test('boot executes supplied Init.java and reports the next missing Java method', async () => {
  const path = 'sl/scripts/game/src/Init.java';
  const run = async (method: string) => {
    const source = `package java.game; class Init extends GameType { Init(int id) { Frontend.init(); ${method}(); } }`;
    const assets = new Assets([{ path, size: source.length }], async () => new TextEncoder().encode(source));
    const events: BootEvent[] = [];
    const result = await bootGame(assets, event => events.push(event));
    return { result, events };
  };
  const first = await run('missingOne');
  assert.match(first.result.error?.message ?? '', /Init\.Init \(source line 1\): Java method\/native missing: java\.game\.Init\.missingOne\(\)/);
  assert.ok(first.events.some(event => event.message.includes('Frontend.init')));
  const second = await run('missingTwo');
  assert.match(second.result.error?.message ?? '', /missingTwo/);
  assert.ok(second.events.some(event => event.level === 'error'));
});
