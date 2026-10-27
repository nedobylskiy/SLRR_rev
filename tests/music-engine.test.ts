import test from 'node:test';
import assert from 'node:assert/strict';
import { jv } from 'slrr-jvm';
import { MUSIC_SET, parseId3, tracksForSet, type MusicEngine } from '../src/audio/music-engine';
import { SoundJavaBridge } from '../src/audio/sound-java';

test('original music-set names select files from the installed folders', () => {
  const files = [
    { path: 'music/Main_Menu/theme.mp3', size: 12 },
    { path: 'music/Roam_Ride/drive.mp3', size: 12 },
    { path: 'music/Misc_Menu/02_Ending.mp3', size: 12 },
    { path: 'music/Misc_Menu/01_EventList.mp3', size: 12 },
    { path: 'music/Main_Menu/readme.txt', size: 12 },
    { path: 'music/Anim_Scene/intro.mp3', size: 12 },
  ];
  assert.deepEqual(tracksForSet(files, MUSIC_SET.MENU).map(f => f.path), ['music/Main_Menu/theme.mp3']);
  assert.deepEqual(tracksForSet(files, MUSIC_SET.DRIVING).map(f => f.path), ['music/Roam_Ride/drive.mp3']);
  assert.deepEqual(tracksForSet(files, MUSIC_SET.MISC).map(f => f.path), ['music/Misc_Menu/01_EventList.mp3', 'music/Misc_Menu/02_Ending.mp3']);
  assert.deepEqual(tracksForSet(files, MUSIC_SET.ANIM).map(f => f.path), ['music/Anim_Scene/intro.mp3']);
});

test('ID3 title, artist, and album are read from MP3 text frames', () => {
  const encoder = new TextEncoder();
  const frame = (id: string, value: string) => {
    const body = new Uint8Array([3, ...encoder.encode(value)]), length = body.length;
    return new Uint8Array([...encoder.encode(id), 0, 0, 0, length, 0, 0, ...body]);
  };
  const frames = [frame('TIT2', 'Track'), frame('TPE1', 'Artist'), frame('TALB', 'Album')];
  const size = frames.reduce((sum, f) => sum + f.length, 0);
  const tag = new Uint8Array([73, 68, 51, 3, 0, 0, 0, 0, 0, size, ...frames.flatMap(f => [...f])]);
  assert.deepEqual(parseId3(tag), { title: 'Track', artist: 'Artist', album: 'Album' });
  assert.equal(parseId3(encoder.encode('not an MP3 header')), null);
});

test('Java Sound calls reach the host and extended readback returns playing metadata', () => {
  const events: string[] = [];
  const music = {
    changeMusicSet: (set: number) => events.push(`set ${set}`),
    nextTrack: () => events.push('next'),
    playPath: (path: string) => events.push(`path ${path}`),
    snapshot: () => ({ track: { title: 'A title', artist: 'An artist', album: 'An album', path: 'music/Main_Menu/a.mp3' },
      positionSeconds: 13.5, durationSeconds: 120, index: 0, count: 1, playing: true }),
  } as unknown as MusicEngine;
  const bridge = new SoundJavaBridge(music);
  assert.equal(bridge.constant('MUSIC_SET_MENU')?.value, 3);
  bridge.call('changeMusicSet', [bridge.constant('MUSIC_SET_MENU')!]);
  bridge.call('nextTrack', []);
  bridge.call('playTrack', [jv('String', 'Music\\Main_Menu\\theme.mp3')]);
  assert.deepEqual(events, ['set 1', 'next', 'path Music\\Main_Menu\\theme.mp3']);
  assert.deepEqual(bridge.call('getTrackTitle', []).value, 'A title');
  assert.deepEqual(bridge.call('getTrackPosition', []).value, 13.5);
  assert.deepEqual(bridge.call('getNowPlaying', []).value, 'music/Main_Menu/a.mp3');
  assert.equal(bridge.call('getTotalTracks', []).value, 1);
  assert.equal(bridge.constant('CHANNEL_MUSIC')?.value, 1);
  assert.throws(() => bridge.call('seekTrack', [jv('float', NaN)]), /numeric/);
});

test('original Java music-set IDs map to the host playlists', () => {
  const sets: number[] = [];
  const bridge = new SoundJavaBridge({ changeMusicSet: (set: number) => sets.push(set) } as unknown as MusicEngine);
  for (const name of ['NONE', 'GARAGE', 'DRIVING', 'RACE', 'MENU', 'MISC', 'ANIM'])
    bridge.call('changeMusicSet', [bridge.constant(`MUSIC_SET_${name}`)!]);
  assert.deepEqual(sets, [MUSIC_SET.NONE, MUSIC_SET.GARAGE, MUSIC_SET.DRIVING,
    MUSIC_SET.RACE, MUSIC_SET.MENU, MUSIC_SET.MISC, MUSIC_SET.ANIM]);
});
