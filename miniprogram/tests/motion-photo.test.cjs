const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { generateMotionPhoto, convertEmbeddedMotionPhoto, verifyMotionPhoto, MAX_SOURCE_BYTES } = require('../src/media/motion-photo');
const { analyzeBytes } = require('../src/core/analyze');
const { saveToAlbum, choosePhotoForVerification } = require('../src/platform/motion-photo-output');
const { videoFixture } = require('./mp4-fixture.cjs');

const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 74, 70, 255, 218, 0, 2, 255, 217]);
const mp4 = Uint8Array.from([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
  105, 115, 111, 109, 109, 112, 52, 50, 0, 0, 0, 12, 109, 100, 97, 116, 1, 2, 3, 4,
]);

function fileSystem(t, hooks = {}) {
  t.after(() => { delete global.wx; });
  const files = new Map([['/video.mp4', mp4.slice()], ['/cover.jpg', jpeg.slice()]]);
  const removed = [];
  const manager = {
    stat(options) {
      const bytes = files.get(options.path);
      if (!bytes) { options.fail(new Error('file not found')); return; }
      options.success({ stats: { size: hooks.statSize || bytes.length } });
    },
    readFile(options) {
      const bytes = files.get(options.filePath);
      if (!bytes) { options.fail(new Error('file not found')); return; }
      // Views with a non-zero offset must not leak neighboring bytes into output.
      const backing = new Uint8Array(bytes.length + 2);
      backing.set(bytes, 1);
      options.success({ data: backing.subarray(1, backing.length - 1) });
    },
    writeFile(options) {
      if (hooks.writeFailure) { options.fail(new Error('disk full')); return; }
      const bytes = new Uint8Array(options.data).slice();
      if (hooks.corrupt) bytes[bytes.length - 1] = 0;
      files.set(options.filePath, bytes);
      if (hooks.onWrite) hooks.onWrite();
      options.success({});
    },
    unlink(options) { removed.push(options.filePath); files.delete(options.filePath); if (options.success) options.success({}); },
  };
  global.wx = { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => manager };
  return { files, removed };
}

const generation = () => ({ videoPath: '/video.mp4', coverPath: '/cover.jpg', coverTimeSeconds: 1.25 });

test('shared core works without browser globals and preserves Unicode UTF-8', () => {
  const context = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/core/binary'), 'utf8'), context);
  const text = '中文封面😀\ud800';
  assert.deepEqual(Array.from(context.exports.utf8(text)), Array.from(new TextEncoder().encode(text)));
});

test('generates, writes, rereads and validates a Samsung Motion Photo with the original video bytes', async (t) => {
  const { files } = fileSystem(t);
  const output = await generateMotionPhoto(generation());
  assert.match(output.name, /_MP\.jpg$/);
  assert.notEqual(output.path, '/cover.jpg');
  const analysis = analyzeBytes(files.get(output.path), output.name);
  assert.equal(analysis.validation.isSamsungCompatible, true);
  assert.equal(analysis.presentationTimestampUs, 1250000);
  assert.equal(analysis.videoSize, mp4.length);
  assert.deepEqual(files.get(output.path).slice(analysis.videoStart, analysis.videoStart + analysis.videoSize), mp4);
  assert.deepEqual(files.get('/cover.jpg'), jpeg);
  files.set('/album.jpg', files.get(output.path).slice());
  assert.equal((await verifyMotionPhoto('/album.jpg', output.path)).timestampUs, 1250000);
});

test('rejects a static album photo after motion data is stripped', async (t) => {
  fileSystem(t);
  const output = await generateMotionPhoto(generation());
  await assert.rejects(verifyMotionPhoto('/cover.jpg', output.path), /动态数据可能已丢失/);
});

test('rejects a different embedded video even when JPEG, XMP and SEF remain valid', async (t) => {
  const { files } = fileSystem(t);
  const output = await generateMotionPhoto(generation());
  const album = files.get(output.path).slice();
  const analysis = analyzeBytes(album, output.name);
  album[analysis.videoStart + analysis.videoSize - 1] ^= 1;
  files.set('/album.jpg', album);
  await assert.rejects(verifyMotionPhoto('/album.jpg', output.path), /视频数据发生变化/);
});

test('rejects corrupted output on disk and deletes the incomplete file', async (t) => {
  const { files, removed } = fileSystem(t, { corrupt: true });
  await assert.rejects(generateMotionPhoto(generation()), /动态数据可能已丢失/);
  assert.equal(removed.length, 1);
  assert.equal(files.size, 2);
});

test('cleans up after a filesystem write failure', async (t) => {
  const { removed } = fileSystem(t, { writeFailure: true });
  await assert.rejects(generateMotionPhoto(generation()), /disk full/);
  assert.equal(removed.length, 1);
});

test('checks size before loading large video bytes', async (t) => {
  const { removed } = fileSystem(t, { statSize: MAX_SOURCE_BYTES + 1 });
  await assert.rejects(generateMotionPhoto(generation()), /文件过大/);
  assert.deepEqual(removed, []);
});

test('page unload during output write cancels generation and releases its file', async (t) => {
  let cancel = false;
  const { files, removed } = fileSystem(t, { onWrite: () => { cancel = true; } });
  await assert.rejects(generateMotionPhoto({ ...generation(), shouldCancel: () => cancel }), { code: 'MOTION_PHOTO_CANCELED' });
  assert.equal(removed.length, 1);
  assert.equal(files.size, 2);
});

test('save and verification picker use the generated path and request an original image', async (t) => {
  fileSystem(t);
  global.wx.saveImageToPhotosAlbum = (options) => {
    assert.equal(options.filePath, '/output_MP.jpg');
    options.success({});
  };
  await saveToAlbum('/output_MP.jpg');
  global.wx.chooseMedia = (options) => {
    assert.deepEqual(options.sizeType, ['original']);
    assert.deepEqual(options.mediaType, ['image']);
    options.success({ tempFiles: [{ tempFilePath: '/album.jpg' }] });
  };
  assert.equal(await choosePhotoForVerification(), '/album.jpg');
});

test('video page generates a real output, prevents repeat clicks, handles denied permission and verifies the saved file', async (t) => {
  const { files } = fileSystem(t);
  const previous = { Page: global.Page, getApp: global.getApp };
  const modulePath = require.resolve('../src/pages/video/index');
  t.after(() => { Object.assign(global, previous); delete require.cache[modulePath]; });
  global.getApp = () => ({ globalData: {} });
  let definition;
  global.Page = (page) => { definition = page; };
  delete require.cache[modulePath];
  require(modulePath);
  const page = Object.assign({}, definition, {
    data: { ...definition.data, video: { path: '/video.mp4', durationSeconds: 2 }, clipStartSeconds: 0, clipEndSeconds: 2, coverPreviewPath: '/cover.jpg',
      coverFrameInfo: { path: '/cover.jpg', requestedSeconds: 1.25 } },
    setData(update) { Object.assign(this.data, update); },
  });
  const work = page.onGenerateMotionPhoto();
  await page.onGenerateMotionPhoto();
  await work;
  assert.equal(page.data.showMotionResult, true);
  assert.equal(page.data.flow.status, 'success');
  assert.equal(page.data.outputBusy, false);
  assert.equal(files.size, 3);
  global.wx.saveImageToPhotosAlbum = (options) => options.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' });
  await page.onSaveMotionPhoto();
  assert.equal(page.data.albumPermissionDenied, true);
  assert.equal(page.data.showMotionResult, true);
  assert.equal(page.data.outputBusy, false);
  global.wx.saveImageToPhotosAlbum = (options) => {
    files.set('/album.jpg', files.get(options.filePath).slice());
    options.success({});
  };
  await page.onSaveMotionPhoto();
  assert.match(page.data.outputStatus, /已保存/);
  assert.equal(page.data.albumPermissionDenied, false);
  global.wx.chooseMedia = (options) => options.success({ tempFiles: [{ tempFilePath: '/album.jpg' }] });
  await page.onVerifyAlbumPhoto();
  assert.match(page.data.outputStatus, /回读校验通过/);
  assert.equal(page.data.outputBusy, false);
  assert.equal(files.has('/album.jpg'), false);
  assert.equal(files.has(page.data.flow.outputPath), true);
});

test('clip output uses the selected interval and stores cover time relative to that interval', async (t) => {
  const { files } = fileSystem(t);
  files.set('/video.mp4', videoFixture());
  const output = await generateMotionPhoto({ ...generation(), coverTimeSeconds: 1.75,
    clipStartSeconds: 1.25, clipEndSeconds: 3.5, durationSeconds: 8 });
  const analysis = analyzeBytes(files.get(output.path), output.name);
  assert.equal(analysis.durationSeconds, 2.25);
  assert.equal(analysis.presentationTimestampUs, 500000);
});

test('batch converts a JPEG with appended video into a checked Samsung file', async (t) => {
  const { files } = fileSystem(t);
  files.set('/embedded.jpg', Uint8Array.from([...jpeg, ...mp4]));
  const output = await convertEmbeddedMotionPhoto({ path: '/embedded.jpg', name: '原始动态照片.jpg' });
  const analysis = analyzeBytes(files.get(output.path), output.name);
  assert.equal(analysis.validation.isSamsungCompatible, true);
  assert.equal(analysis.videoSize, mp4.length);
  assert.equal(analysis.presentationTimestampUs, -1);
  await assert.rejects(convertEmbeddedMotionPhoto({ path: '/cover.jpg' }), /内嵌/);
});

test('batch remuxes a MOV payload and preserves an existing cover timestamp', async (t) => {
  const { files } = fileSystem(t);
  const { muxSamsungMotionPhoto } = require('../src/core/mux');
  files.set('/embedded.jpg', muxSamsungMotionPhoto(jpeg, videoFixture({ mov: true }), { timestampUs: 1500000 }));
  const output = await convertEmbeddedMotionPhoto({ path: '/embedded.jpg' });
  const analysis = analyzeBytes(files.get(output.path), output.name);
  assert.equal(analysis.videoFormat, 'MP4');
  assert.equal(analysis.presentationTimestampUs, 1500000);
  assert.equal(analysis.validation.isSamsungCompatible, true);
});

test('invalid range and a cover outside the selected clip cannot silently export the whole input', async (t) => {
  const { files } = fileSystem(t);
  files.set('/video.mp4', videoFixture());
  await assert.rejects(generateMotionPhoto({...generation(),durationSeconds:8,clipStartSeconds:-1,clipEndSeconds:3}), /时间无效/);
  await assert.rejects(generateMotionPhoto({...generation(),durationSeconds:8,clipStartSeconds:NaN,clipEndSeconds:3}), /时间无效/);
  await assert.rejects(generateMotionPhoto({...generation(),durationSeconds:8,clipStartSeconds:2,clipEndSeconds:3}), /封面时间/);
  assert.equal(files.size,2);
});

test('HEIC batch input uses native JPEG normalization and removes its intermediate cover', async (t) => {
  const { files } = fileSystem(t);
  const heic = Buffer.from(mp4.subarray(0,24)); heic.write('heic',8);
  const container = Buffer.alloc(8); container.writeUInt32BE(mp4.length+8); container.write('mpvd',4);
  files.set('/source.heic',Buffer.concat([heic,container,Buffer.from(mp4)]));
  files.set('/normalized.jpg',jpeg.slice());
  const output=await convertEmbeddedMotionPhoto({path:'/source.heic',name:'motion.heic',normalizeCover:async path=>{
    assert.equal(path,'/source.heic');return {path:'/normalized.jpg'};
  }});
  assert.equal(analyzeBytes(files.get(output.path),output.name).validation.isSamsungCompatible,true);
  assert.equal(files.has('/normalized.jpg'),false);
  assert.equal(files.has('/source.heic'),true);
});
