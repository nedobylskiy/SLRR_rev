/** Master volume for in-game sound effects, independent of the music channel. */
export let gameSoundVolume = 1;

export function setGameSoundVolume(value: number) {
  if (!Number.isFinite(value)) throw new Error('Invalid game sound volume');
  gameSoundVolume = Math.max(0, Math.min(1, value));
}

/** Keep stationary wheelspin audible; soften tire squeal as vehicle speed rises. */
export function skidLoudness(speedMps: number) {
  return 1 - 0.55 * Math.max(0, Math.min(1, (Math.abs(speedMps) - 8) / 22));
}
