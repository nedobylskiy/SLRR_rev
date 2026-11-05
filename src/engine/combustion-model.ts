/** Recovered combustion cycle, adapted from nicolas-found42/sl-remastered
 * src/dyno_model.cpp @ 7aa574d. See docs/physics-reverse-port.md.
 * Float32 state stores; JavaScript expression evaluation is not x87 bit parity. */
export interface CombustionCurve { torque: number[]; power: number[] }
export enum Word {
  crank = 0,
  piston = 1,
  rod = 3,
  vmin = 4,
  cylinders = 5,
  burnTime = 7,
  burnSpeed = 8,
  density = 9,
  heatCapacity = 10,
  intakePressure = 11,
  exhaustPressure = 12,
  intakeTemperature = 13,
  exhaustTemperature = 14,
  mixtureHeat = 15,
  exhaustHeat = 16,
  intakeMinimum = 17,
  exhaustMinimum = 18,
  intakeMaximum = 19,
  exhaustMaximum = 20,
  thermalTime = 21,
  rpmLimit = 22,
  bore = 23,
  stroke = 24,
  displacement = 25,
  area = 26,
  sweptVolume = 27,
  vmax = 28,
  compression = 29,
  speedLimit = 30,
  intakeDensity = 31,
  exhaustDensity = 32,
  dt = 33,
  rpm = 34,
  maximumRpm = 35,
  spark = 36,
  intakeOpen = 37,
  intakeClose = 38,
  exhaustOpen = 39,
  exhaustClose = 40,
  intakeStart = 41,
  intakeDuration = 42,
  intakeShift = 43,
  intakeRpm0 = 44,
  intakeRpm1 = 45,
  exhaustStart = 46,
  exhaustDuration = 47,
  exhaustShift = 48,
  exhaustRpm0 = 49,
  exhaustRpm1 = 50,
  sparkStart = 51,
  sparkShift = 52,
  sparkRpm0 = 53,
  sparkRpm1 = 54,
  turboMultiplier = 55,
  turboOptimum = 56,
  turboPlateau = 57,
  turboRange = 58,
  turboPressure = 59,
  wastePressure = 60,
  mixtureRatio = 61,
  fuelLimit = 62,
  airLimit = 63,
  intakeValve = 64,
  exhaustValve = 65,
  burned = 66,
  ignitionTime = 67,
  wallTemperature = 68,
  ambientTemperature = 69,
  heatLoss = 70,
  otherHeat = 71,
  elapsed = 72,
  period = 73,
  angularSpeed = 74,
  angle = 75,
  pistonPosition = 76,
  volume = 77,
  gasDensity = 78,
  mass = 79,
  pressure = 80,
  temperature = 81,
  fuelHeat = 82,
  airFraction = 83,
  fuelFraction = 84,
  effectiveHeat = 85,
  effectivePressure = 86,
  effectiveTemperature = 87,
  effectiveDensity = 88,
  effectiveBurnTime = 89,
  fuelUsed = 90,
  airUsed = 91,
  pistonSpeed = 92,
  work = 94,
  previousWork = 95,
  frictionPower = 96,
  meanPressure = 97,
  torque = 98,
  horsepower = 99,
  grossPower = 100,
  netPower = 101,
  fuelConsumption = 102,
  airConsumption = 103,
  specificConsumption = 104,
  efficiency = 105,
  peakPressure = 106,
  peakTorque = 107,
  peakHorsepower = 108,
  peakGrossPower = 109,
  peakNetPower = 110,
  peakPressureRpm = 111,
  peakTorqueRpm = 112,
  peakHorsepowerRpm = 113,
  peakGrossRpm = 114,
  peakNetRpm = 115
}
const floatPower = (x: number, exponent: number) => Math.fround(Math.pow(Math.fround(x), Math.fround(exponent)));
// FUN_004b68c0. The reset's volume expression has the opposite sign from
// the advancing crank expression; retaining that grouping matters at TDC.
function resetCycle(s: Float32Array) {
  s[Word.fuelHeat] = s[Word.effectiveHeat];
  s[Word.pressure] = s[Word.effectivePressure];
  for (const field of [Word.elapsed, Word.angle, Word.intakeValve, Word.exhaustValve, Word.burned, Word.heatLoss,
                     Word.otherHeat, Word.work, Word.previousWork, Word.meanPressure, Word.grossPower,
                     Word.fuelUsed, Word.airUsed])
    s[field] = 0;
  s[Word.temperature] = s[Word.effectiveTemperature];
  const position = s[Word.crank] + Math.sqrt(s[Word.rod] * s[Word.rod]);
  s[Word.pistonPosition] = position;
  s[Word.volume] = ((position - s[Word.rod]) - s[Word.crank]) * s[Word.area] + s[Word.vmin];
  s[Word.gasDensity] = s[Word.effectiveDensity];
  s[Word.mass] = s[Word.volume] * s[Word.effectiveDensity];
}

// Newer FUN_004f5980 computes the reciprocal once before the air fraction.
function mixture(s: Float32Array) {
  s[Word.fuelFraction] = 1.0 / (s[Word.mixtureRatio] + 1.0);
  s[Word.airFraction] = s[Word.fuelFraction] * s[Word.mixtureRatio];
  s[Word.intakeDensity] = s[Word.intakePressure] * 9.86923259915784e-6 * s[Word.density];
  s[Word.exhaustDensity] = s[Word.exhaustPressure] * 9.86923259915784e-6 * s[Word.density];
}

// FUN_004b6670 resets the model's constants, not its allocation or all state.
function reset(s: Float32Array) {
  s[Word.crank] = 0.05317499861121178;
  s[Word.piston] = 0.04899999871850014;
  s[Word.rod] = 0.15;
  s[Word.vmin] = 0.0001;
  s[Word.cylinders] = 4;
  s[Word.burnTime] = 0.003;
  s[Word.burnSpeed] = 0.00005;
  s[2] = 1.0290000438690186;
  s[6] = 1;
  s[Word.density] = 1.2928999662399292;
  s[Word.mixtureHeat] = 1000000;
  s[Word.exhaustHeat] = 0;
  s[Word.heatCapacity] = 712;
  s[Word.intakePressure] = 101325;
  s[Word.exhaustPressure] = 111457.5;
  s[Word.intakeTemperature] = s[Word.exhaustTemperature] = 293.15;
  s[Word.intakeMinimum] = s[Word.exhaustMinimum] = 0.005;
  s[Word.intakeMaximum] = s[Word.exhaustMaximum] = 0.8;
  s[Word.thermalTime] = 95;
  s[Word.wallTemperature] = s[Word.ambientTemperature] = 353.15;
  s[Word.mixtureRatio] = 14;
  s[Word.spark] = s[Word.sparkStart] = 0.48;
  s[Word.intakeOpen] = s[Word.intakeStart] = 0.001;
  s[Word.intakeClose] = 0.25;
  s[Word.exhaustOpen] = s[Word.exhaustStart] = 0.75;
  s[Word.exhaustClose] = 0.99;
  s[Word.sparkShift] = -0.05;
  s[Word.sparkRpm0] = 2000;
  s[Word.sparkRpm1] = 5000;
  s[Word.intakeDuration] = 0.249;
  s[Word.exhaustDuration] = 0.24000000953674316;
  for (const field of [Word.intakeShift, Word.intakeRpm0, Word.intakeRpm1, Word.exhaustShift,
                     Word.exhaustRpm0, Word.exhaustRpm1, Word.elapsed, Word.angle, Word.turboPlateau])
    s[field] = 0;
  s[Word.rpm] = 1000;
  s[Word.turboMultiplier] = 20;
  s[Word.turboOptimum] = 85000;
  s[Word.turboRange] = 30000;
  s[Word.turboPressure] = 0;
  s[Word.wastePressure] = 3;
  mixture(s);
  resetCycle(s);
  for (const field of [Word.peakGrossPower, Word.peakNetPower, Word.peakPressure, Word.peakGrossRpm,
                     Word.peakNetRpm, Word.peakPressureRpm, Word.fuelUsed, Word.airUsed])
    s[field] = 0;
  s[Word.dt] = s[Word.period] * 0.005;
  s[Word.airLimit] = s[Word.fuelLimit] = 100;
}

// FUN_004b69a0, after the wrapper has copied script values.
function geometry(s: Float32Array) {
  s[Word.effectiveHeat] = s[Word.mixtureHeat];
  s[Word.bore] = s[Word.piston] + s[Word.piston];
  s[Word.effectivePressure] = s[Word.intakePressure];
  s[Word.speedLimit] = 45;
  s[Word.effectiveTemperature] = s[Word.intakeTemperature];
  s[Word.effectiveDensity] = s[Word.intakeDensity];
  s[Word.stroke] = s[Word.crank] + s[Word.crank];
  s[Word.area] = s[Word.piston] * s[Word.piston] * 3.1415927410125732;
  s[Word.sweptVolume] = s[Word.area] * s[Word.stroke];
  s[Word.vmax] = s[Word.sweptVolume] + s[Word.vmin];
  s[Word.compression] = s[Word.vmax] / s[Word.vmin];
  s[Word.maximumRpm] = (45.0 / s[Word.crank]) * 9.549296379089355;
  s[Word.pistonSpeed] = s[Word.angularSpeed] * s[Word.crank];
  s[Word.displacement] = s[Word.sweptVolume] * s[Word.cylinders];
}

function advanceTiming(s: Float32Array, start: Word, shift: Word, low: Word, high: Word) {
  const span = s[high] - s[low];
  if (span <= 0)
    return s[start];
  const fraction = (s[Word.rpm] - s[low]) / span;
  if (fraction < 0)
    return s[start];
  if (fraction > 1)
    return s[shift] + s[start];
  return fraction * s[shift] + s[start];
}

// FUN_004b6bf0: preparation occurs once per sampled RPM, before cycle reset.
function prepare(s: Float32Array) {
  mixture(s);
  s[Word.spark] = advanceTiming(s, Word.sparkStart, Word.sparkShift, Word.sparkRpm0, Word.sparkRpm1);
  s[Word.intakeOpen] = advanceTiming(s, Word.intakeStart, Word.intakeShift, Word.intakeRpm0, Word.intakeRpm1);
  s[Word.intakeClose] = s[Word.intakeDuration] + s[Word.intakeOpen];
  s[Word.exhaustOpen] = advanceTiming(s, Word.exhaustStart, Word.exhaustShift, Word.exhaustRpm0, Word.exhaustRpm1);
  s[Word.exhaustClose] = s[Word.exhaustDuration] + s[Word.exhaustOpen];
  s[Word.effectivePressure] = s[Word.intakePressure];
  s[Word.effectiveHeat] = s[Word.mixtureHeat];
  s[Word.effectiveTemperature] = s[Word.intakeTemperature];
  s[Word.effectiveDensity] = s[Word.intakeDensity];
  if (s[Word.turboMultiplier] > 0 && s[Word.turboRange] > 0) {
    let boost = Math.abs(s[Word.rpm] * s[Word.turboMultiplier] - s[Word.turboOptimum]);
    if (s[Word.turboPlateau] <= boost) {
      boost = 1.0 - (boost - s[Word.turboPlateau]) / (s[Word.turboRange] - s[Word.turboPlateau]);
      if (boost < 0)
        boost = 0;
    } else {
      boost = 1;
    }
    boost *= s[Word.turboPressure];
    if (s[Word.wastePressure] <= boost)
      boost = s[Word.wastePressure];
    boost = Math.sqrt(boost + 1.0);
    s[Word.effectivePressure] = boost * boost * s[Word.intakePressure];
    s[Word.effectiveTemperature] = s[Word.intakeTemperature] * boost;
    s[Word.effectiveDensity] = s[Word.intakeDensity] * boost;
  }
  if (s[Word.fuelLimit] > 0 && s[Word.fuelLimit] < s[Word.fuelConsumption])
    s[Word.effectiveHeat] = s[Word.mixtureHeat] / (s[Word.fuelConsumption] / s[Word.fuelLimit]);
  if (s[Word.airLimit] > 0 && s[Word.airLimit] < s[Word.airConsumption])
    s[Word.effectivePressure] /= s[Word.airConsumption] / s[Word.airLimit];
  let shortening = s[Word.rpm] * s[Word.burnSpeed];
  if (shortening >= 0.9)
    shortening = 0.9;
  s[Word.effectiveBurnTime] = (1.0 - shortening) * s[Word.burnTime];
}

// FUN_004b7020 uses a strict opening and closing interval for the valves.
function valveOpen(s: Float32Array, open: Word, close: Word) {
  const after = s[open] * s[Word.period] < s[Word.elapsed];
  if (s[close] <= s[open])
    return after || s[Word.elapsed] < s[close] * s[Word.period];
  return after && s[Word.elapsed] < s[close] * s[Word.period];
}

// Newer FUN_004f50e0 adds the cylinder, mixture and thermal guards absent in
// older FUN_004b7020. Returns the native integer cycle transition separately.
function step(s: Float32Array) {
  if (s[Word.vmin] < 0)
    s[Word.vmin] = 0;
  if (s[Word.vmax] < 0)
    s[Word.vmax] = 0;
  const oldVolume = s[Word.volume] < 0 ? 0.0 : s[Word.volume];
  const oldPressure = s[Word.pressure];
  const oldTemperature = s[Word.temperature], oldBurned = s[Word.burned];
  s[Word.elapsed] = s[Word.dt] + s[Word.elapsed];
  const completed = s[Word.period] <= s[Word.elapsed];
  if (completed) {
    s[Word.elapsed] -= s[Word.period];
    s[Word.previousWork] = s[Word.work];
    s[Word.work] = 0;
    const swept = s[Word.vmax] - s[Word.vmin];
    s[Word.meanPressure] = swept <= 1e-8 ? 0.0 : s[Word.previousWork] / swept;
    const pressureWork = s[Word.meanPressure] * swept;
    s[Word.torque] = s[Word.cylinders] * pressureWork * 0.125;
    s[Word.grossPower] = s[Word.rpm] * pressureWork * 0.01666666753590107 * s[Word.cylinders];
    s[Word.frictionPower] = s[Word.rpm] * s[Word.rpm] * s[Word.rpm] * 2e-8;
    s[Word.netPower] = s[Word.grossPower] - s[Word.frictionPower];
    s[Word.horsepower] = s[Word.netPower] * 0.001341;
  }
  s[Word.angle] = s[Word.angle] + s[Word.angularSpeed] * s[Word.dt];
  if (s[Word.angle] > 12.566370964050293)
    s[Word.angle] -= 12.566370964050293;
  const sine = Math.sin(s[Word.angle]);
  // 004f52e3/004f52ec multiply sin(angle)*radius once, then square it.
  const transverse = sine * s[Word.crank];
  const position = Math.sqrt(s[Word.rod] * s[Word.rod] - transverse * transverse) +
                         Math.cos(s[Word.angle]) * s[Word.crank];
  s[Word.pistonPosition] = position;
  s[Word.volume] = ((s[Word.crank] + s[Word.rod]) - position) * s[Word.area] + s[Word.vmin];
  if (s[Word.volume] < 1e-7) {
    s[Word.volume] = 1e-7;
    return completed;
  }
  const inverseVolume = 1.0 / s[Word.volume];
  // Newer 004f5381/004f539d supply the Float32 ratio in XMM0, and
  // 0059ab6c/00593704 supply 1.3/0.3 in XMM1 to the Float32 pow helper.
  s[Word.pressure] = floatPower(inverseVolume * oldVolume, 1.3) * oldPressure;
  const temperatureRatio = inverseVolume * oldVolume;
  const temperaturePower = floatPower(temperatureRatio, 0.3);
  s[Word.temperature] = temperaturePower * oldTemperature;
  s[Word.intakeValve] = s[valveOpen(s, Word.intakeOpen, Word.intakeClose) ? Word.intakeMaximum : Word.intakeMinimum];
  s[Word.exhaustValve] = s[valveOpen(s, Word.exhaustOpen, Word.exhaustClose) ? Word.exhaustMaximum : Word.exhaustMinimum];
  const ignition = s[Word.spark] * s[Word.period];
  let end = ignition + s[Word.effectiveBurnTime];
  s[Word.ignitionTime] = ignition;
  if (end > s[Word.period])
    end -= s[Word.period];
  const burning = end <= ignition ? ignition < s[Word.elapsed] || s[Word.elapsed] <= end
                                       : ignition < s[Word.elapsed] && s[Word.elapsed] <= end;
  s[Word.burned] = burning ? (s[Word.elapsed] - ignition) / s[Word.effectiveBurnTime]
                      : (oldBurned <= 0 ? 0.0 : 1.0);
  if (s[Word.burned] > 0) {
    // The numerator deliberately uses mass before the denominator's clamp.
    const oldMass = s[Word.mass];
    if (s[Word.mass] < 1e-7)
      s[Word.mass] = 1e-7;
    if (s[Word.temperature] < 1e-7)
      s[Word.temperature] = 1e-7;
    const burnEnergy = s[Word.fuelHeat] * oldMass;
    const nextTemperature = ((s[Word.burned] - oldBurned) * burnEnergy) /
                                      (s[Word.heatCapacity] * s[Word.mass]) +
                                  s[Word.temperature];
    s[Word.pressure] = (nextTemperature / s[Word.temperature]) * s[Word.pressure];
    s[Word.temperature] = nextTemperature;
    if (s[Word.burned] >= 1) {
      s[Word.burned] = 0;
      s[Word.fuelHeat] = 0;
    }
  }
  if (s[Word.intakeValve] > 0) {
    let fraction = s[Word.intakeValve] * s[Word.dt] * 1000.0;
    if (fraction >= 1)
      fraction = 1;
    let nextPressure = fraction * (s[Word.effectivePressure] - s[Word.pressure]) + s[Word.pressure];
    if (nextPressure <= 1e-6)
      nextPressure = 1e-6;
    const displaced = (s[Word.volume] * s[Word.pressure]) / nextPressure;
    if (s[Word.volume] <= displaced) {
      s[Word.mass] -= (displaced - s[Word.volume]) * inverseVolume * s[Word.mass];
    } else {
      const added = (nextPressure / s[Word.effectivePressure]) * s[Word.effectiveDensity] * (s[Word.volume] - displaced);
      if (s[Word.mass] < 1e-7)
        s[Word.mass] = 1e-7;
      const nextMass = s[Word.mass] + added;
      const inverseMass = 1.0 / nextMass;
      s[Word.temperature] = (s[Word.effectiveTemperature] * added + s[Word.temperature] * s[Word.mass]) * inverseMass;
      s[Word.fuelHeat] = (s[Word.effectiveHeat] * added + s[Word.fuelHeat] * s[Word.mass]) * inverseMass;
      s[Word.mass] = nextMass;
      s[Word.airUsed] = added * s[Word.airFraction] + s[Word.airUsed];
      s[Word.fuelUsed] = s[Word.fuelFraction] * added + s[Word.fuelUsed];
    }
    s[Word.pressure] = nextPressure;
    if (s[Word.mass] < 0)
      s[Word.mass] = 0;
  }
  if (s[Word.exhaustValve] > 0) {
    let fraction = s[Word.exhaustValve] * s[Word.dt] * 1000.0;
    if (fraction >= 1)
      fraction = 1;
    const nextPressure = fraction * (s[Word.exhaustPressure] - s[Word.pressure]) + s[Word.pressure];
    const displaced = (s[Word.volume] * s[Word.pressure]) / nextPressure;
    if (s[Word.volume] <= displaced) {
      s[Word.mass] -= (displaced - s[Word.volume]) * inverseVolume * s[Word.mass];
    } else {
      const added = (nextPressure / s[Word.exhaustPressure]) * s[Word.exhaustDensity] * (s[Word.volume] - displaced);
      if (s[Word.mass] < 1e-7)
        s[Word.mass] = 1e-7;
      const nextMass = s[Word.mass] + added;
      const inverseMass = 1.0 / nextMass;
      s[Word.temperature] = (s[Word.temperature] * s[Word.mass] + added * s[Word.exhaustTemperature]) * inverseMass;
      s[Word.fuelHeat] = (s[Word.exhaustHeat] * added + s[Word.fuelHeat] * s[Word.mass]) * inverseMass;
      s[Word.mass] = nextMass;
    }
    s[Word.pressure] = nextPressure;
  }
  if (s[Word.mass] < 0)
    s[Word.mass] = 0;
  let fraction = s[Word.dt] / s[Word.thermalTime];
  if (fraction >= 1)
    fraction = 1;
  const difference = s[Word.temperature] - s[Word.wallTemperature];
  const sign = difference == 0 ? 0.0 : (difference < 0 ? -1.0 : 1.0);
  let cooling = difference * difference * sign * fraction;
  if (cooling / difference > 1)
    cooling /= cooling / difference;
  s[Word.heatLoss] += cooling;
  const cooled = s[Word.temperature] - cooling;
  if (s[Word.temperature] < 1e-7)
    s[Word.temperature] = 1e-7;
  s[Word.pressure] = (cooled / s[Word.temperature]) * s[Word.pressure];
  s[Word.temperature] = cooled;
  s[Word.work] = (s[Word.pressure] + oldPressure) * 0.5 * (s[Word.volume] - oldVolume) + s[Word.work];
  return completed;
}

// Newer FUN_004f4560. With dt=period/231 a cycle needs at most 232 steps. The
// explicit bound reports invalid numeric state instead of hanging the game.
function cycle(s: Float32Array) {
  s[Word.fuelUsed] = s[Word.airUsed] = s[Word.heatLoss] = s[Word.otherHeat] = 0;
  let completed = false;
  for (let i = 0; i < 232 && !completed; ++i) {
    completed = step(s);
  }
  if (!completed)
    return false;
  const inversePeriod = 1.0 / s[Word.period];
  s[Word.fuelConsumption] = s[Word.fuelUsed] * inversePeriod * s[Word.cylinders];
  s[Word.airConsumption] = s[Word.airUsed] * inversePeriod * s[Word.cylinders];
  s[Word.efficiency] = (s[Word.airUsed] + s[Word.fuelUsed]) / (s[Word.sweptVolume] * s[Word.density]);
  s[Word.specificConsumption] = (s[Word.fuelConsumption] * 7920.0) / s[Word.horsepower];
  s[Word.heatLoss] = inversePeriod * s[Word.heatLoss];
  return Number.isFinite(s[Word.torque]) && Number.isFinite(s[Word.netPower]);
}

// Newer FUN_004f4640. The integer step truncates maximumRpm/tableSize; the table
// count is integer division, so neither is the floating script step size.
function table(s: Float32Array, stepRpm: number, result: CombustionCurve) {
  for (let field = Word.peakPressure; field <= Word.peakNetRpm; ++field)
    s[field] = 0;
  const count = Math.trunc(Math.trunc(s[Word.maximumRpm]) / stepRpm);
  if (count < 1 || count > 65536)
    return false;
  result.torque = Array(count).fill(0);
  result.power = Array(count).fill(0);
  for (let i = 1; i < count; ++i) {
    s[Word.angle] = s[Word.elapsed] = 0;
    s[Word.rpm] = i * stepRpm;
    s[Word.period] = 120.0 / s[Word.rpm];
    s[Word.angularSpeed] = s[Word.rpm] * 0.10471975803375244;
    s[Word.pistonSpeed] = s[Word.angularSpeed] * s[Word.crank];
    prepare(s);
    s[Word.dt] = s[Word.period] * 0.0043290043249726295;
    resetCycle(s);
    if (!cycle(s))
      return false;
    let previous = s[Word.meanPressure];
    for (let repeat = 0; repeat < 10; ++repeat) {
      if (!cycle(s))
        return false;
      if (Math.abs(previous / s[Word.meanPressure] - 1.0) < 0.05)
        break;
      previous = previous * 0.4 + s[Word.meanPressure] * 0.6;
    }
    if (s[Word.peakGrossPower] < s[Word.grossPower]) {
      s[Word.peakGrossPower] = s[Word.grossPower];
      s[Word.peakGrossRpm] = s[Word.rpm];
    }
    if (s[Word.peakNetPower] < s[Word.netPower]) {
      s[Word.peakNetPower] = s[Word.netPower];
      s[Word.peakHorsepower] = s[Word.netPower] * 0.001341;
      s[Word.peakNetRpm] = s[Word.peakHorsepowerRpm] = s[Word.rpm];
    }
    if (s[Word.peakPressure] < s[Word.meanPressure]) {
      s[Word.peakPressure] = s[Word.meanPressure];
      s[Word.peakPressureRpm] = s[Word.peakTorqueRpm] = s[Word.rpm];
      s[Word.peakTorque] = s[Word.torque];
    }
    result.torque[i] = s[Word.torque];
    result.power[i] = s[Word.netPower];
  }
  s[Word.torque] = s[Word.peakTorque];
  s[Word.grossPower] = s[Word.peakGrossPower];
  s[Word.netPower] = s[Word.peakNetPower];
  return true;
}

export interface CombustionResult {
  rpmStep: number; requestedStep: number; maximumRpm: number;
  torque: number[]; watts: number[]; nitroTorque: number[]; nitroWatts: number[];
  displacement: number; compression: number; maxTorque: number; maxHp: number;
  torqueRpm: number; hpRpm: number;
}
/** Persistent consumption observations and nitrous bank match the native lifetime. */
export class CombustionModel {
  private state = new Float32Array(116);
  private result?: CombustionResult;
  calculate(fields: Readonly<Record<string, number>>, tableSize: number): CombustionResult {
    if (!Number.isFinite(tableSize) || tableSize <= 0) throw new Error('DynoData.calcDyno: invalid table size');
    const s = this.state.slice(); reset(s);
    const get = (name: string, fallback: number) => fields[name] === undefined ? fallback : fields[name];
    const bindings: [Word, string, number][] = [
      [Word.cylinders,'cylinders',4], [Word.vmin,'Vmin',0.00005],
      [Word.intakeMinimum,'in_min',0.005], [Word.intakeMaximum,'in_max',0.8],
      [Word.exhaustMinimum,'out_min',0.005], [Word.exhaustMaximum,'out_max',0.8],
      [Word.intakeStart,'time_in_open',0.001], [Word.intakeClose,'time_in_close',0.25],
      [Word.exhaustStart,'time_out_open',0.75], [Word.exhaustClose,'time_out_close',0.99],
      [Word.burnTime,'time_burn',0.003], [Word.rpmLimit,'RPM_limit',7000],
      [Word.sparkStart,'time_spark_min',0.48], [Word.sparkShift,'time_spark_inc',-0.05],
      [Word.sparkRpm0,'time_spark_RPM0',2000], [Word.sparkRpm1,'time_spark_RPM1',5000],
      [Word.turboMultiplier,'rpm_turbo_mul',16], [Word.turboOptimum,'rpm_turbo_opt',85000],
      [Word.turboRange,'rpm_turbo_range',20000], [Word.turboPressure,'P_turbo_max',0],
      [Word.wastePressure,'P_turbo_waste',10], [Word.mixtureHeat,'mixture_H',1000000],
      [Word.mixtureRatio,'mixture_ratio',14], [Word.airLimit,'max_air_consumption',0],
      [Word.fuelLimit,'max_fuel_consumption',0],
    ];
    for (const [word, name, fallback] of bindings) {
      const value = get(name, fallback);
      if (!Number.isFinite(value)) throw new Error(`DynoData.calcDyno: non-finite ${name}`);
      s[word] = value;
    }
    s[Word.piston] = get('bore',0.082) * 0.5; s[Word.crank] = get('stroke',0.09) * 0.5;
    s[Word.intakeOpen] = s[Word.intakeStart]; s[Word.exhaustOpen] = s[Word.exhaustStart];
    s[Word.intakeDuration] = s[Word.intakeClose] - s[Word.intakeOpen];
    s[Word.exhaustDuration] = s[Word.exhaustClose] - s[Word.exhaustOpen];
    s[Word.turboPlateau] = 0; s[Word.intakeTemperature] = get('intercooling',1) * 293.15;
    if (!(s[Word.crank] >= 0 && s[Word.crank] <= s[Word.rod] && s[Word.piston] >= 0))
      throw new Error('DynoData.calcDyno: unsupported cylinder geometry');
    mixture(s); geometry(s);
    if (get('maxRPM',0) > 0) s[Word.maximumRpm] = get('maxRPM',0);
    const requestedStep = Math.max(s[Word.maximumRpm] / tableSize,1), rpmStep = Math.trunc(requestedStep);
    if (!Number.isFinite(requestedStep) || requestedStep >= 2147483647)
      throw new Error('DynoData.calcDyno: unsupported RPM table range');
    const primary: CombustionCurve = { torque: [], power: [] };
    if (!table(s,rpmStep,primary)) throw new Error('DynoData.calcDyno: non-finite primary combustion cycle');
    const result: CombustionResult = { rpmStep, requestedStep, maximumRpm: s[Word.maximumRpm],
      torque: primary.torque, watts: primary.power,
      nitroTorque: this.result?.nitroTorque ?? [], nitroWatts: this.result?.nitroWatts ?? [],
      displacement: s[Word.displacement], compression: s[Word.compression],
      maxTorque: s[Word.peakTorque], maxHp: s[Word.peakHorsepower],
      torqueRpm: s[Word.peakTorqueRpm], hpRpm: s[Word.peakHorsepowerRpm] };
    s[Word.intakeTemperature] = 293.15;
    if (get('nitro_H',1)-1 > 0.0001 || get('nitro_cooling',1)-1 > 0.0001) {
      const maximum = s[Word.maximumRpm];
      s[Word.mixtureHeat] *= get('nitro_H',1); s[Word.intakeTemperature] *= get('nitro_cooling',1);
      mixture(s); geometry(s); s[Word.maximumRpm] = maximum;
      const nitro: CombustionCurve = { torque: [], power: [] }, step = Math.trunc(maximum/tableSize);
      if (step < 1 || !table(s,step,nitro)) throw new Error('DynoData.calcDyno: invalid nitrous combustion table');
      result.nitroTorque = nitro.torque; result.nitroWatts = nitro.power;
    }
    this.state = s; this.result = result;
    return result;
  }
}
