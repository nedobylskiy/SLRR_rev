import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const marker = 'SLRR_PHYSICS|';
const kinds = new Set(['meta', 'engine', 'ratio', 'curve', 'sample', 'shift', 'end']);
const numeric = (value) => value !== undefined && value.trim() !== '' && Number.isFinite(Number(value));
const codes = value => value ? value.split(',').map(Number).filter(Number.isFinite).map(n => String.fromCharCode(n)).join('') : '';

export function parseTelemetry(text) {
  const runs = [], active = new Map(), warnings = [];
  let rejected = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const start = line.indexOf(marker);
    if (start < 0) continue;
    const row = Object.fromEntries(line.slice(start + marker.length).split('|').map(field => {
      const at = field.indexOf('='); return [field.slice(0, at), field.slice(at + 1)];
    }));
    const required = row.kind === 'sample' ? ['seq', 't', 'rpm', 'gear_param6', 'speed_mps']
      : row.kind === 'shift' ? ['seq', 'from', 'to', 't_before', 't_after', 'rpm_before', 'rpm_after']
      : row.kind === 'curve' ? ['rpm', 'torque_nm', 'power_w'] : row.kind === 'ratio' ? ['index', 'ratio'] : [];
    if (row.v !== '1' || !kinds.has(row.kind) || !numeric(row.run) || !required.every(key => numeric(row[key]))) {
      rejected++; if (warnings.length < 30) warnings.push(`Line ${index + 1}: invalid/truncated telemetry row`); continue;
    }
    if (row.kind === 'meta') {
      const run = { key: `${runs.length + 1}:${row.run}`, id: row.run, metadata: row,
        model: codes(row.vehicle_codes), engine: {}, ratios: [], curves: [], samples: [], shifts: [], ended: false };
      runs.push(run); active.set(row.run, run);
    }
    const run = active.get(row.run);
    if (!run) { rejected++; if (warnings.length < 30) warnings.push(`Line ${index + 1}: no preceding metadata for run ${row.run}`); continue; }
    if (row.kind === 'engine') run.engine = { ...row, name: codes(row.engine_codes) };
    if (row.kind === 'ratio') run.ratios.push(row);
    if (row.kind === 'curve') run.curves.push(row);
    if (row.kind === 'sample') run.samples.push(row);
    if (row.kind === 'shift') run.shifts.push(row);
    if (row.kind === 'end') { run.ended = true; active.delete(row.run); }
  }
  return { version: 1, runs, rejected, warnings,
    limitations: ['gear_param6 is the raw documented AI parameter; validate its encoding against the original HUD',
      'shift RPM brackets two samples, not the exact shift instant',
      'dyno curve is a native table read, not delivered wheel torque',
      'parameter/input units and native getters require original-game qualification'] };
}

export function compareTelemetry(reference, candidate) {
  const collect = report => {
    const groups = new Map();
    for (const run of report.runs) {
      // Only compare matching observed configurations; do not pool different
      // cars, ratios or transmission modes into one supposed formula error.
      const key = JSON.stringify([run.metadata.chassis_type, run.engine.engine_type, run.model,
        run.engine.name, run.metadata.transmission_config,
        run.metadata.mass_kg ?? run.metadata.mass_native_raw, run.metadata.mass_source ?? 'legacy_mass_kg',
        run.metadata.final_drive, run.metadata.idle_rpm, run.metadata.redline_rpm,
        run.engine.wear, run.engine.tear, run.ratios.map(row => [row.index, row.ratio])]);
      let group = groups.get(key);
      if (!group) { group = { model: run.model, shifts: new Map(), curves: new Map() }; groups.set(key, group); }
      for (const row of run.shifts) {
        const direction = `${row.from}->${row.to}`, values = group.shifts.get(direction) ?? [];
        values.push(Number(row.rpm_before)); group.shifts.set(direction, values);
      }
      for (const row of run.curves) group.curves.set(row.rpm, Number(row.torque_nm));
    }
    return groups;
  };
  const originals = collect(reference), measured = collect(candidate), matched = [];
  for (const [key, actual] of measured) {
    const expected = originals.get(key); if (!expected) continue;
    const shifts = [];
    for (const [change, values] of actual.shifts) {
      const baseline = expected.shifts.get(change); if (!baseline?.length) continue;
      const mean = array => array.reduce((sum, value) => sum + value, 0) / array.length;
      shifts.push({ change, referenceCount: baseline.length, candidateCount: values.length,
        referenceMeanRPMBefore: mean(baseline), candidateMeanRPMBefore: mean(values), deltaRPM: mean(values) - mean(baseline) });
    }
    const torque = [...actual.curves].filter(([rpm]) => expected.curves.has(rpm)).map(([rpm, nm]) =>
      ({ rpm: Number(rpm), referenceNm: expected.curves.get(rpm), candidateNm: nm, deltaNm: nm - expected.curves.get(rpm) }));
    matched.push({ model: actual.model, configuration: JSON.parse(key), shifts, torque });
  }
  return { matched, unmatchedReferenceConfigurations: originals.size - matched.length,
    unmatchedCandidateConfigurations: measured.size - matched.length,
    note: 'Descriptive deltas only. Control input, slope, load and shift sampling intervals must match before attributing differences to equations.' };
}

export async function stageTelemetry(gameRoot, output) {
  const root = await realpath(resolve(gameRoot)), destination = resolve(output);
  const canonicalDestination = join(await realpath(dirname(destination)), basename(destination));
  const path = relative(root, canonicalDestination);
  if (!path || !path.startsWith('..') && !isAbsolute(path)) throw Error('Output must be outside the original game directory');
  const trackPath = join(root, 'sl/Scripts/game/src/Track.java');
  const original = await readFile(trackPath, 'utf8');
  if (original.includes('PhysicsTelemetry.')) throw Error('Track already contains telemetry hooks; stage from a clean backup');
  let patched = original;
  for (const [pattern, hook] of [
    [/public\s+void\s+animate\s*\(\s*\)\s*\{/g, '\n        PhysicsTelemetry.sample(player.car);'],
    [/public\s+void\s+exit\s*\(\s*GameState\s+\w+\s*\)\s*\{/g, '\n        PhysicsTelemetry.stop();'],
  ]) {
    if ([...original.matchAll(pattern)].length !== 1) throw Error('Expected exactly one Track hook: ' + pattern);
    patched = patched.replace(pattern, match => match + hook);
  }
  await mkdir(destination); // Fresh leaf only; cannot follow an existing output junction.
  const target = join(destination, 'sl/Scripts/game/src');
  await mkdir(target, { recursive: true });
  const logger = await readFile(join(here, 'stock-telemetry/PhysicsTelemetry.java'), 'utf8');
  // Exclusive writes prevent accidentally overwriting an existing staged mod.
  await writeFile(join(target, 'PhysicsTelemetry.java'), logger, { flag: 'wx' });
  await writeFile(join(target, 'Track.java'), patched, { flag: 'wx' });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const manifest = { version: 1, originalTrack: trackPath, originalSHA256: hash(original),
    patchedSHA256: hash(patched), loggerSHA256: hash(logger),
    note: 'Staged only. Original game not modified. Compile/run in an isolated game copy; back up Track.java and Track.class.' };
  await writeFile(join(destination, 'telemetry-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}

function csv(rows) {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return [keys.map(quote).join(','), ...rows.map(row => keys.map(key => quote(row[key])).join(','))].join('\n') + '\n';
}

async function main(args) {
  const option = name => args[args.indexOf(name) + 1];
  if (args[0] === 'stage') {
    if (!args.includes('--game-root') || !args.includes('--output')) throw Error('stage --game-root <installation> --output <new staging folder>');
    console.log(JSON.stringify(await stageTelemetry(option('--game-root'), option('--output')), null, 2)); return;
  }
  if (args[0] !== 'extract' || !args[1] || !args.includes('--output'))
    throw Error('extract <game.log> --output <folder> [--compare <other-game.log>]');
  const report = parseTelemetry(await readFile(args[1], 'utf8')), destination = resolve(option('--output'));
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'summary.json'), JSON.stringify(report, null, 2));
  for (const kind of ['samples', 'shifts', 'curves']) {
    const rows = report.runs.flatMap(run => run[kind].map(row => ({ runKey: run.key, model: run.model, ...row })));
    await writeFile(join(destination, kind + '.csv'), csv(rows));
  }
  if (args.includes('--compare')) {
    const other = parseTelemetry(await readFile(option('--compare'), 'utf8'));
    await writeFile(join(destination, 'comparison.json'), JSON.stringify(compareTelemetry(report, other), null, 2));
  }
  console.log(JSON.stringify({ runs: report.runs.length, samples: report.runs.reduce((n, run) => n + run.samples.length, 0), rejected: report.rejected, output: destination }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
