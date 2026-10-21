const app = getApp();
const { getLayoutInsets } = require('../../platform/system-info');
const { createInitialVideoState, VIDEO_FLOW_STATES } = require('../../features/video-flow/state');
const { chooseVideoFromAlbum, isVideoPickerCanceled } = require('../../platform/video-picker');
const { inspectVideoSource } = require('../../platform/video-info');
const { captureVideoFrameToJpeg } = require('../../platform/video-frame');
const { createCaptureDiagnostics, formatCaptureDiagnostics } = require('../../platform/capture-diagnostics');
const { generateMotionPhoto, verifyMotionPhoto } = require('../../media/motion-photo');
const { saveToAlbum, choosePhotoForVerification } = require('../../platform/motion-photo-output');
const { clipRange, coverInClip } = require('./clip');
const { choosePhotos } = require('../../platform/photo-picker');
const { normalizeImage } = require('../../platform/image-normalize');

function getDiagnosticRuntimeInfo() {
  const runtime = {};
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const device = wx.getDeviceInfo() || {};
      runtime.device = {
        brand: device.brand || null,
        model: device.model || null,
        platform: device.platform || null,
        system: device.system || null,
      };
    }
  } catch (_error) {
    // Runtime metadata is optional and must not hide the capture error.
  }
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      const appBase = wx.getAppBaseInfo() || {};
      runtime.wechat = {
        version: appBase.version || null,
        SDKVersion: appBase.SDKVersion || null,
      };
    }
  } catch (_error) {
    // Runtime metadata is optional and must not hide the capture error.
  }
  return runtime;
}

function formatFrameTime(value) {
  const numeric = Number(value);
  const time = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  const minutes = String(Math.floor(time / 60));
  const secondsValue = (time % 60).toFixed(1);
  const minutesLabel = minutes.length < 2 ? `0${minutes}` : minutes;
  const seconds = secondsValue.length < 4 ? `0${secondsValue}` : secondsValue;
  return `${minutesLabel}:${seconds}`;
}

function getErrorMessage(error, fallback, stage) {
  const code = error && error.code;
  const raw = String((error && (error.errMsg || error.message)) || '').trim();

  if (code === 'FRAME_CAPTURE_CANCELED') return '';
  if (/开发者工具|developer tools?/i.test(raw)
      && /(不支持|unsupported|not support|api|调试|debug)/i.test(raw)) {
    return '开发者工具无法运行逐帧取图，请使用已配置 AppID 的微信真机预览。';
  }
  if (code === 'VIDEO_PICKER_UNAVAILABLE' || code === 'VIDEO_DECODER_UNAVAILABLE') {
    return raw || fallback;
  }
  if (code === 'UNSUPPORTED_VIDEO_CONTAINER' || code === 'VIDEO_METADATA_UNAVAILABLE'
      || code === 'FRAME_CANVAS_UNAVAILABLE' || code === 'VIDEO_FRAME_TOO_LARGE'
      || code === 'VIDEO_FRAME_FORMAT_UNSUPPORTED' || code === 'VIDEO_FRAME_TIMEOUT') {
    return raw || fallback;
  }
  if (stage === 'capture' && error && ['decoder-start', 'decoder-seek', 'frame-read'].includes(error.frameStage)) {
    return '无法解码此视频封面。当前先支持 H.264 MP4；请换用 H.264 或较低分辨率的视频再试。';
  }
  if (stage === 'preview') {
    return '视频预览失败。请换用微信可播放的 MP4 视频，或重新选择视频。';
  }
  if (stage === 'capture' && /(decode|codec|解码|video.?decoder|视频解码)/i.test(raw)) {
    return '无法解码此视频封面，请换用 H.264 编码的 MP4 视频。';
  }
  if (/fail(?:ed)?\b|errcode|system error/i.test(raw)) return fallback;
  return raw && raw.length <= 160 ? raw : fallback;
}

function removeTemporaryFile(filePath) {
  if (!filePath) return;
  try {
    wx.getFileSystemManager().unlink({ filePath, fail() {} });
  } catch (_error) {
    // A temp file may already be removed by the runtime.
  }
}

function logSafeRuntimeError(stage, error, sourcePath) {
  let detail = '';
  if (typeof error === 'string') {
    detail = error;
  } else if (error && (error.errMsg || error.message)) {
    detail = String(error.errMsg || error.message);
  } else if (error && typeof error === 'object') {
    try {
      detail = Object.getOwnPropertyNames(error)
        .filter((name) => name !== 'stack' && name !== 'frameStage')
        .map((name) => `${name}=${String(error[name])}`)
        .join(' ');
    } catch (_error) {
      detail = '';
    }
  }
  if (!detail) {
    detail = error && typeof error === 'object'
      ? 'Native API returned an empty error object'
      : String(error || 'Unknown error');
  }
  if (sourcePath) detail = detail.split(sourcePath).join('[selected video]');
  const errorStage = error && error.frameStage ? ` (${error.frameStage})` : '';
  console.warn(`[${stage}]${errorStage} ${detail.slice(0, 300)}`);
}

function removeTemporaryFiles(filePaths, keepPath) {
  const seen = new Set();
  (filePaths || []).forEach((filePath) => {
    if (!filePath || filePath === keepPath || seen.has(filePath)) return;
    seen.add(filePath);
    removeTemporaryFile(filePath);
  });
}

function createVideoPage(options = {}) { return {
  data: {
    manualMode: !!options.manual,
    pageTitle: options.manual ? '照片 + 视频' : '视频生成 Motion Photo',
    photo: null,
    photoFit: false,
    photoError: '',
    clipStartSeconds: 0,
    clipEndSeconds: 0,
    clipStartLabel: '00:00.0',
    clipEndLabel: '00:00.0',
    clipDurationLabel: '00:00.0',
    insets: {},
    flow: createInitialVideoState(),
    video: null,
    videoInfo: null,
    picking: false,
    importStage: 'idle',
    pickingLabel: '选择一个视频',
    importError: '',
    previewStatus: 'idle',
    previewPlaying: false,
    previewError: '',
    coverTimeLabel: '00:00.0',
    sliderMaxSeconds: 0.05,
    coverPreviewPath: '',
    coverFrameInfo: null,
    capturingCover: false,
    coverError: '',
    coverDiagnosticText: '',
    showMotionResult: false,
    outputBusy: false,
    outputInfo: null,
    outputError: '',
    outputStatus: '',
    albumPermissionDenied: false,
  },

  onLoad() {
    this.isUnloading = false;
    this.importRequestId = 0;
    this.frameRequestId = 0;
    this.retiredTemporaryPaths = [];
    this.pendingPreviewSeek = null;
    this.videoReady = false;
    this.setData({
      insets: app.globalData.layoutInsets || getLayoutInsets(),
    });
  },

  onReady() {
    this.initializeFrameCanvases();
  },

  initializeFrameCanvases() {
    if (this.isUnloading) return Promise.resolve(false);
    if (this.sourceCanvas && this.outputCanvas) return Promise.resolve(true);
    if (this.frameCanvasPromise) return this.frameCanvasPromise;

    this.frameCanvasPromise = new Promise((resolve) => {
      try {
        const query = wx.createSelectorQuery();
        query.select('#frame-source-canvas').fields({ node: true });
        query.select('#frame-output-canvas').fields({ node: true });
        query.exec((result) => {
          if (this.isUnloading) {
            this.frameCanvasPromise = null;
            resolve(false);
            return;
          }
          this.sourceCanvas = result && result[0] && result[0].node;
          this.outputCanvas = result && result[1] && result[1].node;
          this.canvasReady = Boolean(this.sourceCanvas && this.outputCanvas);
          if (!this.canvasReady) {
            console.error('[M2] Could not resolve frame canvases', {
              resultCount: result && result.length,
              sourceNode: Boolean(result && result[0] && result[0].node),
              outputNode: Boolean(result && result[1] && result[1].node),
            });
            this.frameCanvasPromise = null;
          }
          resolve(this.canvasReady);
        });
      } catch (error) {
        console.error('[M2] Frame canvas query failed', error);
        this.frameCanvasPromise = null;
        resolve(false);
      }
    });

    return this.frameCanvasPromise;
  },

  goBack() {
    this.pausePreview();
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: '/src/pages/home/index' });
  },

  isCurrentImport(requestId) {
    return !this.isUnloading && requestId === this.importRequestId;
  },

  onChooseVideo() {
    return this.importVideo(chooseVideoFromAlbum);
  },

  async onChoosePhoto() {
    if (this.data.picking || this.data.outputBusy || this.data.capturingCover || this.isUnloading) return;
    this.pausePreview();
    this.setData({ picking: true, photoError: '' });
    let source;
    try {
      source = (await choosePhotos())[0];
      if (this.isUnloading) { removeTemporaryFile(source.path); return; }
      await this.installPhoto(source.path, source.name);
    } catch (error) {
      if (!this.isUnloading && !isVideoPickerCanceled(error)) this.setData({ photoError: getErrorMessage(error, '无法导入此照片，请换用 JPEG 或 PNG。', 'photo') });
      if (source && (!this.data.photo || this.data.photo.sourcePath !== source.path)) removeTemporaryFile(source.path);
    } finally { if (!this.isUnloading) this.setData({ picking: false }); }
  },

  async installPhoto(sourcePath, name) {
    if (!await this.initializeFrameCanvases()) throw new Error('图片画布未准备好，请重试。');
    const target = this.data.photoFit && this.data.videoInfo
      ? { width: this.data.videoInfo.displayWidth, height: this.data.videoInfo.displayHeight } : null;
    const photo = await normalizeImage(sourcePath, this.sourceCanvas, this.outputCanvas, target);
    if (this.isUnloading) { if (photo.path !== sourcePath) removeTemporaryFile(photo.path); removeTemporaryFile(sourcePath); return; }
    const previous = this.data.photo;
    this.clearMotionOutput();
    this.setData({
      photo: Object.assign({}, photo, { sourcePath, name }), coverPreviewPath: photo.path,
      coverFrameInfo: Object.assign({}, photo, { requestedSeconds: this.data.flow.coverTimeSeconds || 0 }), photoError: '',
    });
    if (previous) removeTemporaryFiles([previous.path, previous.sourcePath].filter(p => p !== sourcePath && p !== photo.path));
  },

  async onPhotoFitChange(event) {
    if (this.data.picking || this.data.outputBusy || this.isUnloading) return;
    const previous = this.data.photoFit;
    this.setData({ photoFit: !!event.detail.value, picking: true, photoError: '' });
    try {
      if (this.data.photo) await this.installPhoto(this.data.photo.sourcePath, this.data.photo.name);
    } catch (error) {
      if (!this.isUnloading) this.setData({ photoFit: previous, photoError: getErrorMessage(error, '调整图片失败，请重试。', 'photo') });
    } finally { if (!this.isUnloading) this.setData({ picking: false }); }
  },

  clearMotionOutput() {
    if (this.data.flow.outputPath) removeTemporaryFile(this.data.flow.outputPath);
    this.setData({ showMotionResult: false, outputInfo: null, outputError: '', outputStatus: '', albumPermissionDenied: false,
      flow: Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.READY, outputPath: null, error: null }) });
  },

  async onClipChange(event) {
    if (!this.data.video || this.data.picking || this.data.capturingCover || this.data.outputBusy || this.isUnloading) return;
    const duration = this.data.video.durationSeconds;
    const minimum = Math.min(0.1, duration);
    const edge = event.currentTarget.dataset.edge;
    const value = Number(event.detail.value) || 0;
    const start = edge === 'start' ? Math.min(value, this.data.clipEndSeconds - minimum) : this.data.clipStartSeconds;
    const end = edge === 'end' ? Math.max(value, start + minimum) : this.data.clipEndSeconds;
    return this.applyClipRange(start, end);
  },

  onResetClip() {
    if (!this.data.video || this.data.picking || this.data.capturingCover || this.data.outputBusy) return;
    return this.applyClipRange(0, this.data.video.durationSeconds);
  },

  applyClipRange(start, end) {
    const range = clipRange(this.data.video.durationSeconds, start, end);
    const cover = coverInClip(this.data.flow.coverTimeSeconds, range);
    this.pausePreview(); this.clearMotionOutput();
    this.setData({ clipStartSeconds: range.start, clipEndSeconds: range.end,
      clipStartLabel: formatFrameTime(range.start), clipEndLabel: formatFrameTime(range.end), clipDurationLabel: formatFrameTime(range.duration),
      sliderMaxSeconds: coverInClip(range.end, range),
      flow: Object.assign({}, this.data.flow, { coverTimeSeconds: cover }), coverTimeLabel: formatFrameTime(cover) });
    this.seekPreview(range.start);
    return this.captureCoverAt(cover);
  },

  async importVideo(picker) {
    if (this.data.picking || this.data.capturingCover || this.data.outputBusy || this.isUnloading) return;
    const requestId = ++this.importRequestId;
    this.importFlowBeforeRequest = this.data.flow;
    this.pausePreview();
    const preparingFlow = this.data.video
      ? this.data.flow
      : Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.ANALYZING, error: null });
    this.setData({
      picking: true,
      importStage: 'choosing',
      pickingLabel: '正在打开视频',
      importError: '',
      flow: preparingFlow,
    });

    let video;
    try {
      video = await picker();
    } catch (error) {
      if (!this.isCurrentImport(requestId)) return;
      const canceled = isVideoPickerCanceled(error);
      const message = canceled ? '' : getErrorMessage(
        error,
        '无法打开本机视频选择器，请更新微信后重试。',
        'import',
      );
      const restoredFlow = this.data.video
        ? this.data.flow
        : (this.importFlowBeforeRequest || createInitialVideoState());
      const nextFlow = message && !this.data.video
        ? Object.assign({}, restoredFlow, { status: VIDEO_FLOW_STATES.ERROR, error: message })
        : restoredFlow;
      this.importFlowBeforeRequest = null;
      this.setData({
        picking: false,
        importStage: 'idle',
        pickingLabel: this.data.video ? '更换视频' : '选择一个视频',
        importError: message,
        flow: nextFlow,
      });
      return;
    }

    if (!this.isCurrentImport(requestId)) {
      removeTemporaryFiles([video.path, video.sourceTempPath], this.data.video && this.data.video.path);
      return;
    }
    this.setData({
      importStage: 'analyzing',
      pickingLabel: '正在读取视频信息',
    });

    let videoInfo;
    try {
      videoInfo = await inspectVideoSource(video.path, video);
    } catch (error) {
      if (!this.isCurrentImport(requestId)) {
        removeTemporaryFiles([video.path, video.sourceTempPath], this.data.video && this.data.video.path);
        return;
      }
      const message = getErrorMessage(
        error,
        '无法读取视频信息，请重新选择 MP4 视频。',
        'import',
      );
      removeTemporaryFiles([video.path, video.sourceTempPath], this.data.video && this.data.video.path);
      const baseFlow = this.data.video
        ? this.data.flow
        : (this.importFlowBeforeRequest || createInitialVideoState());
      const nextFlow = this.data.video
        ? baseFlow
        : Object.assign({}, baseFlow, { status: VIDEO_FLOW_STATES.ERROR, error: message });
      this.importFlowBeforeRequest = null;
      this.setData({
        picking: false,
        importStage: 'idle',
        pickingLabel: this.data.video ? '更换视频' : '选择一个视频',
        importError: message,
        flow: nextFlow,
      });
      return;
    }

    if (!this.isCurrentImport(requestId)) {
      removeTemporaryFiles([video.path, video.sourceTempPath], this.data.video && this.data.video.path);
      return;
    }

    const previousVideo = this.data.video;
    const previousPreviewPath = this.data.coverPreviewPath;
    this.retiredTemporaryPaths = (this.retiredTemporaryPaths || []).concat([
      previousVideo && previousVideo.path,
      previousVideo && previousVideo.sourceTempPath,
      previousVideo && previousVideo.thumbnailPath,
      this.data.manualMode ? null : previousPreviewPath,
      this.data.flow && this.data.flow.outputPath,
    ]);
    this.frameRequestId += 1;
    const displayWidth = videoInfo.displayWidth || videoInfo.width;
    const displayHeight = videoInfo.displayHeight || videoInfo.height;
    const durationSeconds = videoInfo.durationSeconds || video.durationSeconds;
    const selectedVideo = Object.assign({}, video, {
      width: displayWidth,
      height: displayHeight,
      durationSeconds,
      durationLabel: formatFrameTime(durationSeconds),
      resolutionLabel: `${displayWidth} × ${displayHeight}`,
    });
    const flow = Object.assign(createInitialVideoState(), {
      status: VIDEO_FLOW_STATES.READY,
      source: video.path,
      durationSeconds,
      width: displayWidth,
      height: displayHeight,
      orientation: videoInfo.orientation,
      fps: videoInfo.fps,
      coverTimeSeconds: 0,
    });

    this.importFlowBeforeRequest = null;
    this.setData({
      video: selectedVideo,
      videoInfo,
      clipStartSeconds: 0,
      clipEndSeconds: durationSeconds,
      clipStartLabel: '00:00.0',
      clipEndLabel: formatFrameTime(durationSeconds),
      clipDurationLabel: formatFrameTime(durationSeconds),
      flow,
      picking: false,
      importStage: 'idle',
      pickingLabel: '更换视频',
      importError: '',
      previewStatus: 'loading',
      previewPlaying: false,
      previewError: '',
      coverTimeLabel: '00:00.0',
      sliderMaxSeconds: Math.max(0, durationSeconds - Math.min(0.05, durationSeconds * 0.01)),
      coverPreviewPath: this.data.manualMode && this.data.photo ? this.data.photo.path : '',
      coverFrameInfo: this.data.manualMode && this.data.photo ? Object.assign({}, this.data.photo, { requestedSeconds: 0 }) : null,
      coverError: '',
      coverDiagnosticText: '',
      capturingCover: false,
      showMotionResult: false,
      outputInfo: null,
      outputError: '',
      outputStatus: '',
      albumPermissionDenied: false,
    }, () => {
      if (this.isUnloading || !this.data.video || this.data.video.path !== video.path) return;
      this.videoReady = false;
      this.pendingPreviewSeek = 0;
      try {
        this.videoContext = wx.createVideoContext('source-video', this);
      } catch (error) {
        this.setData({
          previewStatus: 'error',
          previewError: getErrorMessage(error, '无法初始化视频预览。', 'preview'),
        });
      }
      removeTemporaryFiles(this.retiredTemporaryPaths, video.path);
      this.retiredTemporaryPaths = [];
      if (this.data.manualMode && this.data.photoFit && this.data.photo) {
        this.setData({ picking: true });
        this.installPhoto(this.data.photo.sourcePath, this.data.photo.name)
          .catch(error => { if (!this.isUnloading) this.setData({ photoError: getErrorMessage(error, '调整封面失败，请重新选择照片。', 'photo'), coverFrameInfo: null }); })
          .finally(() => { if (!this.isUnloading) this.setData({ picking: false }); });
      } else this.captureCoverAt(0);
    });
  },

  isCurrentFrameRequest(requestId, sourcePath) {
    return !this.isUnloading
      && requestId === this.frameRequestId
      && Boolean(this.data.video)
      && this.data.video.path === sourcePath;
  },

  onVideoLoadedMetadata() {
    if (this.isUnloading || !this.data.video) return;
    this.videoReady = true;
    this.setData({ previewStatus: this.data.previewError ? 'error' : 'ready' });
    this.applyPendingPreviewSeek();
  },

  onPreviewPlay() {
    if (this.isUnloading) return;
    this.setData({ previewPlaying: true, previewStatus: 'ready', previewError: '' });
  },

  onPreviewPause() {
    if (!this.isUnloading) this.setData({ previewPlaying: false });
  },

  onPreviewEnded() {
    if (!this.isUnloading) this.setData({ previewPlaying: false });
  },

  onPreviewTimeUpdate(event) {
    if (this.isUnloading || !this.data.previewPlaying) return;
    if (Number(event.detail.currentTime) >= this.data.clipEndSeconds - 0.01) {
      this.pausePreview(); this.seekPreview(this.data.clipStartSeconds);
    }
  },

  togglePreviewPlayback() {
    if (this.isUnloading || !this.data.video || this.data.capturingCover || !this.videoContext) return;
    if (this.data.previewPlaying) {
      this.pausePreview();
      return;
    }
    try {
      this.setData({ previewError: '' });
      this.seekPreview(this.data.clipStartSeconds);
      this.videoContext.play();
    } catch (error) {
      const message = getErrorMessage(error, '无法播放此视频，请重新选择。', 'preview');
      this.setData({ previewStatus: 'error', previewError: message, previewPlaying: false });
    }
  },

  pausePreview() {
    if (this.videoContext) {
      try { this.videoContext.pause(); } catch (_error) { /* page may be leaving */ }
    }
    if (!this.isUnloading && this.data.previewPlaying) this.setData({ previewPlaying: false });
  },

  seekPreview(seconds) {
    const target = Math.max(0, Math.min(
      this.data.sliderMaxSeconds,
      Math.max(this.data.clipStartSeconds || 0, Number(seconds) || 0),
    ));
    this.pendingPreviewSeek = target;
    this.applyPendingPreviewSeek();
  },

  applyPendingPreviewSeek() {
    if (!this.videoReady || !this.videoContext || this.pendingPreviewSeek === null) return;
    const target = this.pendingPreviewSeek;
    this.pendingPreviewSeek = null;
    try { this.videoContext.seek(target); } catch (_error) { /* preview can still be used for frame extraction */ }
  },

  onVideoError(event) {
    logSafeRuntimeError('video-preview', event && event.detail, this.data.video && this.data.video.path);
    const message = getErrorMessage(
      event && event.detail,
      '视频预览失败。请换用微信可播放的 MP4 视频，或重新选择视频。',
      'preview',
    );
    if (!this.isUnloading) {
      this.setData({ previewStatus: 'error', previewError: message, previewPlaying: false });
    }
  },

  onCoverChange(event) {
    if (!this.data.video || this.data.capturingCover || this.data.outputBusy || this.data.picking) return;
    const requested = Number(event.detail && event.detail.value) || 0;
    const seconds = Math.max(0, Math.min(this.data.sliderMaxSeconds, Math.round(requested * 20) / 20));
    this.pausePreview();
    this.seekPreview(seconds);
    this.captureCoverAt(seconds);
  },

  async captureCoverAt(seconds) {
    if (!this.data.video || !this.data.videoInfo || this.data.outputBusy || this.data.picking) return;
    if (this.data.manualMode) {
      this.clearMotionOutput();
      this.setData({ coverTimeLabel: formatFrameTime(seconds),
        coverFrameInfo: this.data.photo ? Object.assign({}, this.data.photo, { requestedSeconds: seconds }) : null,
        flow: Object.assign({}, this.data.flow, { coverTimeSeconds: seconds }) });
      return;
    }
    const sourcePath = this.data.video.path;
    const decoderSourcePath = this.data.video.sourceTempPath || sourcePath;
    console.warn(`[video-frame] decoding from ${this.data.video.sourceTempPath ? 'picker temp path' : 'app storage copy'}`);
    const previousPreviewPath = this.data.coverPreviewPath;
    const previousOutputPath = this.data.flow.outputPath;
    const requestId = (this.frameRequestId || 0) + 1;
    this.frameRequestId = requestId;
    const coverTimeSeconds = Math.max(0, Math.min(this.data.sliderMaxSeconds, Number(seconds) || 0));
    const orientation = this.data.videoInfo.orientation;
    const flow = Object.assign({}, this.data.flow, {
      status: VIDEO_FLOW_STATES.WORKING,
      coverTimeSeconds,
      coverPath: null,
      outputPath: null,
      error: null,
    });
    this.setData({
      flow,
      capturingCover: true,
      coverTimeLabel: formatFrameTime(coverTimeSeconds),
      coverPreviewPath: '',
      coverFrameInfo: null,
      coverError: '',
      coverDiagnosticText: '',
      showMotionResult: false,
      outputInfo: null,
      outputError: '',
      outputStatus: '',
      albumPermissionDenied: false,
    });
    if (previousPreviewPath) removeTemporaryFile(previousPreviewPath);
    if (previousOutputPath && previousOutputPath !== previousPreviewPath) removeTemporaryFile(previousOutputPath);

    try {
      const canvasesReady = await this.initializeFrameCanvases();
      if (!this.isCurrentFrameRequest(requestId, sourcePath)) return;
      if (!canvasesReady || !this.sourceCanvas || !this.outputCanvas) {
        const error = new Error('封面处理画布尚未准备好，请稍后重试。');
        error.code = 'FRAME_CANVAS_UNAVAILABLE';
        throw error;
      }
      let frame;
      try {
        frame = await captureVideoFrameToJpeg(
          decoderSourcePath,
          coverTimeSeconds,
          orientation,
          this.sourceCanvas,
          this.outputCanvas,
          () => !this.isCurrentFrameRequest(requestId, sourcePath),
        );
      } catch (error) {
        if (error && error.frameStage === 'decoder-start'
            && this.data.video.sourceTempPath
            && sourcePath !== decoderSourcePath) {
          console.warn('[video-frame] picker temp decoder start failed; retrying app storage copy');
          frame = await captureVideoFrameToJpeg(
            sourcePath,
            coverTimeSeconds,
            orientation,
            this.sourceCanvas,
            this.outputCanvas,
            () => !this.isCurrentFrameRequest(requestId, sourcePath),
          );
        } else {
          throw error;
        }
      }
      if (!this.isCurrentFrameRequest(requestId, sourcePath)) {
        removeTemporaryFile(frame.path);
        return;
      }

      console.warn(`[video-frame] JPEG extracted ${frame.width}x${frame.height} at ${coverTimeSeconds}s`);
      const coverFrameInfo = Object.assign({}, frame, { requestedSeconds: coverTimeSeconds });
      const readyFlow = Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.READY });
      this.setData({
        flow: readyFlow,
        capturingCover: false,
        coverPreviewPath: frame.path,
        coverFrameInfo,
        coverError: '',
      });
    } catch (error) {
      if (!this.isCurrentFrameRequest(requestId, sourcePath)) return;
      const diagnostics = createCaptureDiagnostics(error, {
        requestedSeconds: coverTimeSeconds,
        video: this.data.video,
        videoInfo: this.data.videoInfo,
        runtime: getDiagnosticRuntimeInfo(),
      });
      const diagnosticText = formatCaptureDiagnostics(diagnostics);
      console.error('[M2] Cover frame capture failed', diagnostics);
      const message = getErrorMessage(error, '无法生成封面帧，请重新选择视频或时间点。', 'capture');
      const errorFlow = Object.assign({}, this.data.flow, {
        status: VIDEO_FLOW_STATES.ERROR,
        error: message,
      });
      this.setData({
        flow: errorFlow,
        capturingCover: false,
        coverPreviewPath: '',
        coverFrameInfo: null,
        coverError: message,
        coverDiagnosticText: diagnosticText,
      });
    }
  },

  retryCoverCapture() {
    if (!this.data.video || this.data.capturingCover || this.data.outputBusy || this.data.picking) return;
    this.captureCoverAt(this.data.flow.coverTimeSeconds || 0);
  },

  copyCaptureDiagnostics() {
    const data = this.data.coverDiagnosticText;
    if (!data || typeof wx.setClipboardData !== 'function') {
      wx.showToast({ title: '无法复制诊断信息', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data,
      success: () => wx.showToast({ title: '诊断信息已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    });
  },

  async onGenerateMotionPhoto() {
    const frame = this.data.coverFrameInfo;
    if (!this.data.video || !frame || !frame.path || this.data.capturingCover
        || this.data.outputBusy || this.data.picking || this.data.showMotionResult || this.isUnloading) return;
    this.pausePreview();
    this.setData({
      outputBusy: true, outputError: '', outputStatus: '正在生成并校验动态图…',
      flow: Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.WORKING, error: null }),
    });
    try {
      const output = await generateMotionPhoto({
        videoPath: this.data.video.path,
        coverPath: frame.path,
        coverTimeSeconds: frame.requestedSeconds,
        clipStartSeconds: this.data.clipStartSeconds,
        clipEndSeconds: this.data.clipEndSeconds,
        durationSeconds: this.data.video.durationSeconds,
        shouldCancel: () => this.isUnloading,
      });
      if (this.isUnloading) { removeTemporaryFile(output.path); return; }
      this.setData({
        outputInfo: Object.assign({}, output, { sizeLabel: `${(output.sizeBytes / 1024 / 1024).toFixed(2)} MB` }),
        showMotionResult: true,
        outputStatus: '文件已生成并通过结构校验，可保存到相册。',
        flow: Object.assign({}, this.data.flow, {
          status: VIDEO_FLOW_STATES.SUCCESS, coverPath: frame.path, outputPath: output.path, error: null,
        }),
      });
    } catch (error) {
      if (this.isUnloading) return;
      const message = getErrorMessage(error, '生成失败，请缩短视频后重试。', 'output');
      this.setData({
        outputError: message, outputStatus: '',
        flow: Object.assign({}, this.data.flow, { status: VIDEO_FLOW_STATES.ERROR, error: message }),
      });
    } finally {
      if (!this.isUnloading) this.setData({ outputBusy: false });
    }
  },

  onPreviewCover() {
    const path = this.data.coverPreviewPath;
    if (!path) return;
    wx.previewImage({
      current: path,
      urls: [path],
      fail: (error) => wx.showToast({
        title: getErrorMessage(error, '无法预览封面。', 'preview'),
        icon: 'none',
      }),
    });
  },

  async onSaveMotionPhoto() {
    const path = this.data.flow.outputPath;
    if (!path || this.data.outputBusy || this.isUnloading) return;
    this.setData({ outputBusy: true, outputError: '', outputStatus: '正在保存到相册…', albumPermissionDenied: false });
    try {
      await saveToAlbum(path);
      if (!this.isUnloading) this.setData({ outputStatus: '已保存到相册。可重新导入校验动态数据，并在三星相册确认播放。' });
    } catch (error) {
      if (this.isUnloading) return;
      const denied = /auth|permission|denied|授权|权限/i.test(String(error && (error.errMsg || error.message) || ''));
      this.setData({
        albumPermissionDenied: denied,
        outputStatus: '',
        outputError: denied ? '未获相册写入权限，请在设置中允许后重新保存。'
          : getErrorMessage(error, '保存失败，请重试或导出原文件。', 'output'),
      });
    } finally {
      if (!this.isUnloading) this.setData({ outputBusy: false });
    }
  },

  openAlbumSettings() {
    if (!this.data.outputBusy && typeof wx.openSetting === 'function') wx.openSetting({});
  },

  onExportFile() {
    const output = this.data.outputInfo;
    if (!output || this.data.outputBusy || this.isUnloading) return;
    if (typeof wx.shareFileMessage !== 'function') {
      this.setData({ outputError: '当前微信不支持导出文件，请更新微信后重试。' });
      return;
    }
    this.setData({ outputBusy: true, outputError: '' });
    try { wx.shareFileMessage({
      filePath: output.path,
      fileName: output.name,
      fail: (error) => {
        if (!this.isUnloading && !isVideoPickerCanceled(error)) {
          this.setData({ outputError: '导出失败，请重试。' });
        }
      },
      complete: () => { if (!this.isUnloading) this.setData({ outputBusy: false }); },
    }); } catch (_error) {
      if (!this.isUnloading) this.setData({ outputBusy: false, outputError: '导出失败，请重试。' });
    }
  },

  async onVerifyAlbumPhoto() {
    const expectedPath = this.data.flow.outputPath;
    if (!expectedPath || this.data.outputBusy || this.isUnloading) return;
    this.setData({ outputBusy: true, outputError: '', outputStatus: '' });
    let path;
    try {
      path = await choosePhotoForVerification();
      if (this.isUnloading) return;
      this.setData({ outputStatus: '正在校验相册中的动态图…' });
      await verifyMotionPhoto(path, expectedPath);
      if (!this.isUnloading) this.setData({ outputStatus: '回读校验通过：动态数据完整，视频与本次生成结果一致。请在三星相册确认播放。' });
    } catch (error) {
      if (!this.isUnloading && !isVideoPickerCanceled(error)) {
        this.setData({ outputStatus: '', outputError: getErrorMessage(error, '校验失败，请选择本次保存的原始动态图。', 'output') });
      }
    } finally {
      if (path && path !== expectedPath && path !== this.data.coverPreviewPath) removeTemporaryFile(path);
      if (!this.isUnloading) this.setData({ outputBusy: false });
    }
  },

  onHide() {
    this.pausePreview();
  },

  onUnload() {
    this.isUnloading = true;
    this.importRequestId = (this.importRequestId || 0) + 1;
    this.frameRequestId = (this.frameRequestId || 0) + 1;
    if (this.videoContext) {
      try { this.videoContext.pause(); } catch (_error) { /* page is being destroyed */ }
    }
    const video = this.data.video || {};
    removeTemporaryFiles([
      video.path,
      video.sourceTempPath,
      video.thumbnailPath,
      this.data.coverPreviewPath,
      this.data.coverFrameInfo && this.data.coverFrameInfo.path,
      this.data.flow && this.data.flow.outputPath,
      this.data.photo && this.data.photo.path,
      this.data.photo && this.data.photo.sourcePath,
    ].concat(this.retiredTemporaryPaths || []));
    if (this.sourceCanvas) {
      this.sourceCanvas.width = 1;
      this.sourceCanvas.height = 1;
    }
    if (this.outputCanvas) {
      this.outputCanvas.width = 1;
      this.outputCanvas.height = 1;
    }
    this.sourceCanvas = null;
    this.outputCanvas = null;
    this.videoContext = null;
    this.frameCanvasPromise = null;
  },
}; }
module.exports = { createVideoPage };
