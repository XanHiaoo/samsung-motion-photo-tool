const test = require('node:test');
const assert = require('node:assert/strict');
const { trimMp4 } = require('../src/media/mp4-trim');
const { parseDuration, detectVideoFormat } = require('../src/core/mp4');
const { videoFixture } = require('./mp4-fixture.cjs');
const { clipRange, coverInClip } = require('../src/features/video-flow/clip');
const { convertQueue } = require('../src/features/batch-flow/queue');

test('inline clip keeps a decodable sync prefix, removes unused media and sets presentation duration', () => {
  const input = videoFixture();
  const result = trimMp4(input, 1.25, 3.5);
  const out = Buffer.from(result.bytes);
  assert.equal(result.durationSeconds, 2.25);
  assert.equal(parseDuration(result.bytes, 0, result.bytes.length), 2.25);
  const mediaStart = out.indexOf('mdat') + 4;
  assert.deepEqual(out.subarray(mediaStart), Buffer.from([1,7,8,9,2,7,8,9,3,7,8,9,4,7,8,9]));
  const edit = out.indexOf('elst');
  assert.equal(out.readUInt32BE(edit + 12), 2250);
  assert.equal(out.readUInt32BE(edit + 16), 1250);
  const chunk = out.indexOf('stco');
  assert.equal(out.readUInt32BE(chunk + 12), mediaStart);
  assert.deepEqual(input, videoFixture());
});

test('clip near the end starts from the later keyframe and handles 64-bit chunk offsets', () => {
  const result = trimMp4(videoFixture({ co64: true }), 5, 8);
  const out = Buffer.from(result.bytes), media = out.indexOf('mdat') + 4;
  assert.equal(out[media], 5);
  assert.equal(out.subarray(media).length, 16);
  assert.equal(parseDuration(result.bytes, 0, result.bytes.length), 3);
});

test('MOV remux writes an MP4 brand and preserves sample payloads', () => {
  const result = trimMp4(videoFixture({ mov: true }), 0, 8);
  assert.equal(detectVideoFormat(result.bytes, 0), 'MP4');
  const out = Buffer.from(result.bytes);
  assert.equal(out.subarray(out.indexOf('mdat') + 4).length, 32);
});

test('rejects fragmented, truncated and invalid clip intervals instead of exporting a whole video', () => {
  assert.throws(() => trimMp4(videoFixture({ fragmented: true }), 1, 2), /分片/);
  assert.throws(() => trimMp4(videoFixture().subarray(0, 40), 1, 2));
  assert.throws(() => trimMp4(videoFixture(), 4, 2), /有效/);
  assert.throws(() => trimMp4(videoFixture(), NaN, 2), /有效/);
});

test('cover stays within the selected range, including short videos', () => {
  const range = clipRange(8, 1.25, 3.5);
  assert.equal(coverInClip(0, range), 1.25);
  assert.ok(coverInClip(8, range) < 3.5);
  const short = clipRange(0.04, 3, 0);
  assert.equal(short.start, 0);
  assert.equal(short.end, 0.04);
});

test('batch isolates invalid inputs, keeps successful outputs and retries only pending entries', async () => {
  const initial = [1,2,3].map(id => ({ id, status: 'pending' }));
  const calls = [];
  let result = await convertQueue(initial, async item => {
    calls.push(item.id); if (item.id === 2) throw new Error('普通图片没有视频'); return { path: `/out${item.id}` };
  });
  assert.deepEqual(result.map(i => i.status), ['success','error','success']);
  assert.deepEqual(initial.map(i => i.status), ['pending','pending','pending']);
  result[1].status = 'pending';
  result = await convertQueue(result, async item => { calls.push(item.id); return { path: '/retry' }; });
  assert.deepEqual(calls, [1,2,3,2]);
  assert.equal(result[0].output.path, '/out1');
  assert.equal(result[1].output.path, '/retry');
});

test('batch cancellation returns the interrupted item to pending and can resume', async () => {
  const result = await convertQueue([1,2].map(id => ({id, status:'pending'})), async () => {
    const error = new Error('cancel'); error.code = 'MOTION_PHOTO_CANCELED'; throw error;
  });
  assert.deepEqual(result.map(i => i.status), ['pending','pending']);
});
