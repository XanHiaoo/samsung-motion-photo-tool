const test = require('node:test');
const assert = require('node:assert/strict');

const { chooseVideoFromAlbum, isVideoPickerCanceled } = require('../src/platform/video-picker');
const { inspectVideoSource } = require('../src/platform/video-info');
const { captureVideoFrameToJpeg } = require('../src/platform/video-frame');
const { createCaptureDiagnostics, formatCaptureDiagnostics } = require('../src/platform/capture-diagnostics');

test('video picker returns local video metadata and identifies cancellation', async (t) => {
  t.after(() => { delete global.wx; });
  global.wx = {
    chooseMedia(options) {
      assert.deepEqual(options.sizeType, ['original']);
      options.success({
        tempFiles: [{
          tempFilePath: 'wxfile://tmp/clip.mp4',
          name: 'family-video.mp4',
          size: 2 * 1024 * 1024,
          duration: 12.8,
          width: 1920,
          height: 1080,
          thumbTempFilePath: 'wxfile://tmp/thumb.jpg',
        }],
      });
    },
  };

  const video = await chooseVideoFromAlbum();
  assert.equal(video.path, 'wxfile://tmp/clip.mp4');
  assert.equal(video.name, 'family-video.mp4');
  assert.equal(video.durationSeconds, 12.8);
  assert.equal(video.sizeLabel, '2.0 MB');
  assert.equal(video.resolutionLabel, '1920 × 1080');
  assert.equal(video.thumbnailPath, 'wxfile://tmp/thumb.jpg');
  assert.equal(isVideoPickerCanceled({ errMsg: 'chooseMedia:fail cancel' }), true);
});

test('video inspection accepts an MP4 ftyp box and reports display orientation', async (t) => {
  t.after(() => { delete global.wx; });
  const header = Buffer.alloc(24);
  header.writeUInt32BE(24, 0);
  header.write('ftyp', 4, 'ascii');
  header.write('isom', 8, 'ascii');
  header.writeUInt32BE(0, 12);
  header.write('isom', 16, 'ascii');
  header.write('mp42', 20, 'ascii');
  const headerBytes = Uint8Array.from(header);

  global.wx = {
    getVideoInfo(options) {
      options.success({
        type: 'mp4', width: 1080, height: 1920, duration: 8.25, fps: 30, orientation: 'left',
      });
    },
    getFileSystemManager() {
      return { readFile: (options) => options.success({ data: headerBytes }) };
    },
  };

  const info = await inspectVideoSource('wxfile://tmp/clip.mp4');
  assert.deepEqual(info, {
    width: 1080,
    height: 1920,
    displayWidth: 1920,
    displayHeight: 1080,
    durationSeconds: 8.25,
    fps: 30,
    orientation: 'left',
    containerType: 'mp4',
  });
});

test('video inspection accepts QuickTime/MOV containers for local remuxing', async (t) => {
  t.after(() => { delete global.wx; });
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16, 0);
  header.write('ftyp', 4, 'ascii');
  header.write('qt  ', 8, 'ascii');
  const headerBytes = Uint8Array.from(header);

  global.wx = {
    getVideoInfo(options) { options.success({ type: 'mov', width: 10, height: 10, duration: 1 }); },
    getFileSystemManager() {
      return { readFile: (options) => options.success({ data: headerBytes }) };
    },
  };

  assert.equal((await inspectVideoSource('wxfile://tmp/clip.mov')).containerType, 'mov');
});

test('frame capture exports an oriented JPEG and always releases the decoder', async (t) => {
  t.after(() => { delete global.wx; });
  const record = { calls: [], imageBytes: null, exportSize: null };
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext() {
      return {
        clearRect() {},
        save() {},
        translate() {},
        rotate() {},
        scale() {},
        drawImage() {},
        restore() {},
        createImageData(width, height) {
          return { data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(imageData) { record.imageBytes = Array.from(imageData.data); },
      };
    },
  });
  const sourceCanvas = makeCanvas();
  const outputCanvas = makeCanvas();
  const backing = Uint8Array.from([99, 1, 2, 3, 4, 5, 6, 7, 8, 99]);
  const decoder = {
    async start(options) { record.calls.push(['start', options]); return { width: 1, height: 2 }; },
    async seek(milliseconds) { record.calls.push(['seek', milliseconds]); },
    getFrameData() {
      return { data: backing.subarray(1, 9), width: 1, height: 2, pkPts: 1200, pkDts: 1100 };
    },
    async stop() { record.calls.push(['stop']); },
    async remove() { record.calls.push(['remove']); },
  };
  global.wx = {
    canIUse: () => false,
    createVideoDecoder: () => decoder,
    canvasToTempFilePath(options) {
      record.exportSize = [options.width, options.height];
      options.success({ tempFilePath: 'wxfile://tmp/cover.jpg' });
    },
  };

  const result = await captureVideoFrameToJpeg(
    'wxfile://tmp/clip.mp4', 1.25, 'right', sourceCanvas, outputCanvas,
  );

  assert.equal(result.path, 'wxfile://tmp/cover.jpg');
  assert.equal(result.width, 2);
  assert.equal(result.height, 1);
  assert.equal(result.rawPts, 1200);
  assert.equal(result.rawDts, 1100);
  assert.equal(result.decoderWidth, 1);
  assert.equal(result.decoderHeight, 2);
  assert.deepEqual(record.exportSize, [2, 1]);
  assert.deepEqual(record.imageBytes, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(record.calls, [['start', { source: 'wxfile://tmp/clip.mp4' }], ['seek', 1250], ['stop'], ['remove']]);
  assert.equal(sourceCanvas.width, 1);
  assert.equal(sourceCanvas.height, 1);
  assert.equal(outputCanvas.width, 1);
  assert.equal(outputCanvas.height, 1);
});

test('frame capture rejects oversized frames and still releases the decoder', async (t) => {
  t.after(() => { delete global.wx; });
  const calls = [];
  const decoder = {
    async start() { return {}; },
    async seek() {},
    getFrameData() { return { data: new Uint8Array(0), width: 5000, height: 3000 }; },
    async stop() { calls.push('stop'); },
    async remove() { calls.push('remove'); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  global.wx = { createVideoDecoder: () => decoder };

  await assert.rejects(
    captureVideoFrameToJpeg('wxfile://tmp/clip.mp4', 0, 'up', canvas, { ...canvas }),
    (error) => error.code === 'VIDEO_FRAME_TOO_LARGE',
  );
  assert.deepEqual(calls, ['stop', 'remove']);
});

test('frame capture attaches the failing decoder stage for device diagnostics', async (t) => {
  t.after(() => { delete global.wx; });
  const calls = [];
  const decoder = {
    async start() { return {}; },
    async seek() { throw Object.assign(new Error('seek failed'), { errMsg: 'seek:fail codec unsupported' }); },
    getFrameData() { throw new Error('must not read a frame after seek fails'); },
    async stop() { calls.push('stop'); },
    async remove() { calls.push('remove'); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  global.wx = { createVideoDecoder: () => decoder };

  await assert.rejects(
    captureVideoFrameToJpeg('wxfile://tmp/clip.mp4', 3, 'up', canvas, { ...canvas }),
    (error) => error.frameStage === 'decoder-seek'
      && error.errMsg === 'seek:fail codec unsupported',
  );
  assert.deepEqual(calls, ['stop', 'remove']);
});

test('frame capture tags failures across decoder, canvas, and JPEG export stages', async (t) => {
  t.after(() => { delete global.wx; });
  const scenarios = [
    { name: 'decoder creation', stage: 'decoder-create' },
    { name: 'decoder start', stage: 'decoder-start' },
    { name: 'decoder seek', stage: 'decoder-seek' },
    { name: 'frame read', stage: 'frame-read' },
    { name: 'frame validation', stage: 'frame-validation' },
    { name: 'canvas render', stage: 'canvas-render' },
    { name: 'JPEG export', stage: 'jpeg-export' },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const fail = (stage) => stage === scenario.stage;
      const decoder = {
        async start() {
          if (fail('decoder-start')) throw new Error('simulated HEVC start failure');
          return { width: 1, height: 1 };
        },
        async seek() {
          if (fail('decoder-seek')) throw new Error('simulated HEVC seek failure');
        },
        getFrameData() {
          if (fail('frame-read')) throw new Error('simulated frame read failure');
          return {
            data: fail('frame-validation') ? new Uint8Array(3) : new Uint8Array(4),
            width: 1,
            height: 1,
          };
        },
        async stop() {},
        async remove() {},
      };
      const sourceContext = {
        createImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData() {},
      };
      const outputContext = {
        clearRect() {}, save() {}, translate() {}, rotate() {}, scale() {}, drawImage() {}, restore() {},
      };
      const sourceCanvas = { getContext: () => (fail('canvas-render') ? null : sourceContext) };
      const outputCanvas = { getContext: () => outputContext };
      global.wx = {
        canIUse: () => false,
        createVideoDecoder: () => (fail('decoder-create') ? null : decoder),
        canvasToTempFilePath(options) {
          if (fail('jpeg-export')) options.fail(new Error('simulated JPEG export failure'));
          else options.success({ tempFilePath: 'wxfile://tmp/cover.jpg' });
        },
      };

      await assert.rejects(
        captureVideoFrameToJpeg('wxfile://tmp/clip.mp4', 3, 'up', sourceCanvas, outputCanvas),
        (error) => error.frameStage === scenario.stage,
      );
    });
  }
});

test('capture diagnostics are copyable and redact local file paths', () => {
  const error = Object.assign(new Error('decode failed: wxfile://tmp/private-video.mp4'), {
    frameStage: 'decoder-start',
    code: 'VIDEO_DECODER_START_FAILED',
    frameDetails: { frameWidth: 3840, frameHeight: 2160 },
  });
  const diagnostics = createCaptureDiagnostics(error, {
    requestedSeconds: 3,
    video: { size: 77453000, durationSeconds: 4.6 },
    videoInfo: { containerType: 'mp4', width: 3840, height: 2160, fps: 30, orientation: 'up' },
    runtime: { device: { model: 'SM-S918B', platform: 'android' } },
  });

  assert.equal(diagnostics.stage, 'decoder-start');
  assert.equal(diagnostics.video.width, 3840);
  assert.equal(diagnostics.requestedSeconds, 3);
  assert.match(diagnostics.error, /\[本地文件\]/);
  assert.doesNotMatch(formatCaptureDiagnostics(diagnostics), /private-video\.mp4/);
  assert.equal(
    createCaptureDiagnostics(new Error('file read failed /data/user/0/wx/cache/video.mp4'), {}).error,
    'file read failed [本地文件]',
  );
  assert.match(formatCaptureDiagnostics(diagnostics), /SM-S918B/);
});

test('video page converts a decoder failure into a clipboard-ready diagnostic', async (t) => {
  const originals = {
    wx: global.wx,
    Page: global.Page,
    getApp: global.getApp,
    consoleError: console.error,
  };
  t.after(() => {
    global.wx = originals.wx;
    global.Page = originals.Page;
    global.getApp = originals.getApp;
    console.error = originals.consoleError;
    delete require.cache[require.resolve('../src/pages/video/index.js')];
  });

  let pageDefinition;
  let copiedText = '';
  const toasts = [];
  const decoderCalls = [];
  global.getApp = () => ({ globalData: { layoutInsets: {} } });
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    canIUse: () => false,
    createVideoDecoder: () => ({
      async start() {
        decoderCalls.push('start');
        throw new Error('playerStart failed');
      },
      async remove() { decoderCalls.push('remove'); },
    }),
    getDeviceInfo: () => ({ brand: 'samsung', model: 'SM-S918B', platform: 'android', system: 'Android 15' }),
    getAppBaseInfo: () => ({ version: '8.0.60', SDKVersion: '3.17.3' }),
    setClipboardData(options) {
      copiedText = options.data;
      options.success();
    },
    showToast(options) { toasts.push(options); },
  };
  console.error = () => {};

  const pagePath = require.resolve('../src/pages/video/index.js');
  delete require.cache[pagePath];
  require(pagePath);
  const canvas = { getContext() { return {}; } };
  const page = Object.assign({}, pageDefinition, {
    isUnloading: false,
    frameRequestId: 0,
    data: {
      video: { path: 'wxfile://tmp/private-video.mp4', size: 77453000, durationSeconds: 4.6 },
      videoInfo: {
        width: 3840, height: 2160, durationSeconds: 4.6, fps: 30, orientation: 'up', containerType: 'mp4',
      },
      sliderMaxSeconds: 4.55,
      flow: { status: 'ready', coverTimeSeconds: 0 },
      coverPreviewPath: '',
    },
    setData(update) { this.data = Object.assign({}, this.data, update); },
    async initializeFrameCanvases() {
      this.sourceCanvas = canvas;
      this.outputCanvas = canvas;
      return true;
    },
  });

  await page.captureCoverAt(3);

  const report = JSON.parse(page.data.coverDiagnosticText);
  assert.equal(page.data.capturingCover, false);
  assert.equal(report.stage, 'decoder-start');
  assert.equal(report.code, null);
  assert.equal(report.error, 'playerStart failed');
  assert.equal(report.requestedSeconds, 3);
  assert.equal(report.video.width, 3840);
  assert.equal(report.runtime.device.model, 'SM-S918B');
  assert.match(page.data.coverError, /H\.264 MP4/);
  assert.doesNotMatch(page.data.coverDiagnosticText, /private-video\.mp4/);
  assert.deepEqual(decoderCalls, ['start', 'remove']);

  page.copyCaptureDiagnostics();
  assert.equal(copiedText, page.data.coverDiagnosticText);
  assert.deepEqual(toasts, [{ title: '诊断信息已复制', icon: 'success' }]);
});
