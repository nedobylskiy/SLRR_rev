import { readFile } from 'node:fs/promises';
import { Assets } from '../src/assets';
import { MechanicalSystem } from '../src/engine/mechanical-system';
import { PartFactory } from '../src/engine/world';
import { gameRoot, relativeGamePath, safeGamePath, walk } from './game-files';

const reference = JSON.parse(await readFile(new URL('../benchmarks/baiern-coupesport-2.5/reference.json', import.meta.url), 'utf8'));
const assets = new Assets((await walk(gameRoot)).map(path => ({ path: relativeGamePath(path), size: 0 })),
  async path => new Uint8Array(await readFile(await safeGamePath(path))));
const built = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 }, { mechanical: true });

try {
  const mechanics = new MechanicalSystem(built.root);
  const block = mechanics.block?.definition.mechanics?.values ?? {};
  const crank = mechanics.crank?.definition.mechanics?.values ?? {};
  const gearbox = mechanics.transmission?.definition.mechanics?.values ?? {};
  const observed = {
    cylinders: block.cylinders ?? null,
    boreMm: block.bore ?? null,
    strokeMm: crank.stroke ?? null,
    displacementCc: Math.round(mechanics.displacement * 1e6),
    idleRpm: block.rpm_idle ?? null,
    redlineRpm: block.RPM_limit ?? null,
    drive: mechanics.drive,
    forwardRatios: [1, 2, 3, 4, 5].map(index => gearbox[`ratio[${index}]`] ?? null),
    reverseRatio: gearbox['ratio[7]'] ?? null,
    finalDriveRatio: gearbox.end_ratio ?? null,
  };
  const target = {
    cylinders: reference.engine.cylinders,
    boreMm: reference.engine.boreMm,
    strokeMm: reference.engine.strokeMm,
    displacementCc: reference.engine.displacementCc,
    idleRpm: reference.engine.idleRpm,
    redlineRpm: reference.engine.redlineRpm,
    drive: 'DT_RWD',
    forwardRatios: reference.transmission.forwardRatios,
    reverseRatio: -reference.transmission.reverseRatioMagnitude,
    finalDriveRatio: reference.transmission.finalDriveRatio,
  };
  const comparisons = Object.fromEntries(Object.entries(target).map(([key, value]) => [key, {
    game: value, assembled: observed[key as keyof typeof observed],
  }]));
  const hpPerLiter = reference.engine.peakFlywheelPowerHp / (reference.engine.displacementCc / 1000);
  const kgPerNm = reference.chassis.massKg / reference.engine.peakFlywheelTorqueNm;
  const requiredTorqueNmAtPeakPower = reference.engine.peakFlywheelPowerHp * 745.699872 /
    (reference.engine.peakPowerRpm * 2 * Math.PI / 60);
  const modeledTorqueNm = mechanics.estimateFlywheelTorqueAt(reference.engine.peakTorqueRpm);
  const modeledPowerHp = mechanics.estimateFlywheelTorqueAt(reference.engine.peakPowerRpm) *
    (reference.engine.peakPowerRpm * 2 * Math.PI / 60) / 745.699872;
  console.log(JSON.stringify({
    vehicle: reference.vehicle,
    installedParts: built.world.parts.size,
    stockWarnings: built.warnings,
    comparisons,
    dynoTargets: {
      torqueAt4500Rpm: { gameNm: reference.engine.peakFlywheelTorqueNm, currentModelNm: Number(modeledTorqueNm.toFixed(1)) },
      powerAt6250Rpm: { gameHp: reference.engine.peakFlywheelPowerHp, currentModelHp: Number(modeledPowerHp.toFixed(1)) },
    },
    vehicleMassKg: reference.chassis.massKg,
    notYetReproducedTrackTargets: reference.testTrackResults,
    screenshotConsistency: {
      displayedHpPerLiter: reference.displayedDerivedValues.hpPerLiter,
      calculatedHpPerLiter: Number(hpPerLiter.toFixed(2)),
      displayedKgPerNm: reference.displayedDerivedValues.kgPerNm,
      calculatedKgPerNm: Number(kgPerNm.toFixed(2)),
      requiredTorqueNmAt6250For194Hp: Number(requiredTorqueNmAtPeakPower.toFixed(1)),
      displayedPeakTorqueNm: reference.engine.peakFlywheelTorqueNm,
    },
  }, null, 2));
} finally { built.world.dispose(); }
