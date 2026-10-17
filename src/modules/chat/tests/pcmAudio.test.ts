import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  base64ToPcm16,
  encodeWav,
  floatToPcm16,
  pcm16ToBase64,
  pcm16ToFloat,
  resampleFloat,
  rmsLevel,
} from '@/modules/chat/utils/pcmAudio';

test('rmsLevel of silence is 0 and of a full scale square wave is 1', () => {
  assert.equal(rmsLevel(new Float32Array(10)), 0);
  assert.ok(Math.abs(rmsLevel(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
  assert.equal(rmsLevel(new Float32Array(0)), 0);
});

test('resampleFloat downsamples 48 kHz to 16 kHz by a factor of three', () => {
  const input = new Float32Array(480).map((_, i) => i / 480);
  const output = resampleFloat(input, 48_000, 16_000);
  assert.equal(output.length, 160);
  assert.ok(Math.abs(output[10] - input[30]) < 1e-6);
  assert.equal(resampleFloat(input, 16_000, 16_000), input);
});

test('float and pcm16 round trip, clamping out of range samples', () => {
  const pcm = floatToPcm16(new Float32Array([0, 0.5, -0.5, 2, -2]));
  assert.deepEqual(Array.from(pcm), [0, 16383, -16384, 32767, -32768]);
  assert.ok(Math.abs(pcm16ToFloat(pcm)[1] - 0.5) < 1e-3);
});

test('base64 round trip preserves samples', () => {
  const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
  assert.deepEqual(Array.from(base64ToPcm16(pcm16ToBase64(pcm))), Array.from(pcm));
});

test('encodeWav writes a 16 kHz mono 16 bit header followed by the samples', () => {
  const wav = encodeWav(new Int16Array([1, 2, 3]), 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(wav.length, 50);
  assert.equal(view.getInt16(46, true), 2);
});
