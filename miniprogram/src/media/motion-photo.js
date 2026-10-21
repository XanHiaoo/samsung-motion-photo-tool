const { muxSamsungMotionPhoto, outputName } = require('../core/mux');
const { analyzeBytes } = require('../core/analyze');
const { locateEmbeddedMotionParts } = require('../core/embedded');
const { detectVideoFormat, parseDuration } = require('../core/mp4');
const { trimMp4 } = require('./mp4-trim');

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024;
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
let sequence = 0;

function callFile(method, options) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager()[method](Object.assign({}, options, { success: resolve, fail: reject }));
  });
}

function canceled(shouldCancel) {
  if (shouldCancel && shouldCancel()) {
    const error = new Error('操作已取消。');
    error.code = 'MOTION_PHOTO_CANCELED';
    throw error;
  }
}

async function readBytes(filePath, limit) {
  const result = await callFile('stat', { path: filePath });
  const size = result.stats && result.stats.size;
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('文件为空或无法读取。');
  if (size > limit) throw new Error(`文件过大，请使用不超过 ${Math.floor(limit / 1024 / 1024)} MB 的文件。`);
  const file = await callFile('readFile', { filePath, position: 0, length: size });
  const data = file.data;
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : Object.prototype.toString.call(data) === '[object ArrayBuffer]' ? new Uint8Array(data) : null;
  if (!bytes || bytes.length !== size) throw new Error('文件读取不完整，请重新选择。');
  return bytes;
}

function validateMotionPhoto(bytes, expectedVideo, timestampUs) {
  const analysis = analyzeBytes(bytes, 'MotionPhoto_MP.jpg', 'image/jpeg');
  const report = analysis.validation;
  if (!report.isSamsungCompatible || !report.offsetValid || !report.presentationTimestampValid) {
    throw new Error('未检测到完整的 Motion Photo，图片中的动态数据可能已丢失。');
  }
  if (timestampUs !== undefined && analysis.presentationTimestampUs !== timestampUs) {
    throw new Error('封面时间信息发生变化，请重新生成。');
  }
  if (expectedVideo) {
    if (analysis.videoSize !== expectedVideo.length) throw new Error('内嵌视频长度发生变化。');
    for (let index = 0; index < expectedVideo.length; index += 1) {
      if (bytes[analysis.videoStart + index] !== expectedVideo[index]) throw new Error('内嵌视频数据发生变化。');
    }
  }
  return analysis;
}

function prepareVideo(bytes, options = {}) {
  const duration = options.durationSeconds || parseDuration(bytes, 0, bytes.length);
  const start = options.clipStartSeconds === undefined ? 0 : options.clipStartSeconds;
  const end = options.clipEndSeconds === undefined ? duration : options.clipEndSeconds;
  const hasSelection = options.clipStartSeconds !== undefined || options.clipEndSeconds !== undefined;
  if (hasSelection && (!Number.isFinite(duration) || !Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || end <= start || end > duration + 0.05)) throw new Error('视频片段时间无效。');
  const trimmed = start > 0.0001 || (Number.isFinite(end) && Number.isFinite(duration) && end < duration - 0.0001);
  const mov = detectVideoFormat(bytes, 0) === 'MOV/QuickTime';
  if (trimmed || mov) {
    if (!Number.isFinite(duration) || !Number.isFinite(end) || start < 0 || end > duration + 0.05) throw new Error('视频片段时间无效。');
    bytes = trimMp4(bytes, start, end).bytes;
  }
  if (bytes.length > MAX_VIDEO_BYTES) throw new Error('所选视频片段超过 20 MB，请缩短片段后重试。');
  return bytes;
}

async function writeMotionPhoto(cover, video, options) {
  const { timestampUs, shouldCancel } = options;
  canceled(shouldCancel);
  if (cover.length > MAX_COVER_BYTES) throw new Error('封面超过 8 MB，请选择较小的图片。');
  const bytes = muxSamsungMotionPhoto(cover, video, { timestampUs, sourceVideoMime: 'video/mp4' });
  validateMotionPhoto(bytes, video, timestampUs);
  const root = wx.env && wx.env.USER_DATA_PATH;
  if (!root) throw new Error('当前微信环境不支持本地文件输出。');
  const stem = String(options.name || 'MotionPhoto').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 60);
  const name = outputName(`${stem}_${Date.now()}_${++sequence}.mp4`);
  const filePath = `${root}/${name}`;
  try {
    canceled(shouldCancel);
    await callFile('writeFile', { filePath, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    canceled(shouldCancel);
    const written = await readBytes(filePath, MAX_OUTPUT_BYTES);
    if (written.length !== bytes.length) throw new Error('输出文件不完整，请重试。');
    const analysis = validateMotionPhoto(written, video, timestampUs);
    canceled(shouldCancel);
    return { path: filePath, name, sizeBytes: written.length, videoSize: analysis.videoSize, timestampUs };
  } catch (error) {
    try { await callFile('unlink', { filePath }); } catch (_ignored) { /* Best effort cleanup. */ }
    throw error;
  }
}

async function generateMotionPhoto(options) {
  const { videoPath, coverPath, coverTimeSeconds, shouldCancel } = options;
  canceled(shouldCancel);
  const video = prepareVideo(await readBytes(videoPath, MAX_SOURCE_BYTES), options);
  canceled(shouldCancel);
  const cover = await readBytes(coverPath, MAX_COVER_BYTES);
  canceled(shouldCancel);
  const start = options.clipStartSeconds || 0;
  if (!Number.isFinite(coverTimeSeconds) || coverTimeSeconds < start
      || (Number.isFinite(options.clipEndSeconds) && coverTimeSeconds >= options.clipEndSeconds)) throw new Error('封面时间必须位于片段内。');
  return writeMotionPhoto(cover, video, { ...options, timestampUs: Math.round((coverTimeSeconds - start) * 1000000) });
}

async function convertEmbeddedMotionPhoto(options) {
  canceled(options.shouldCancel);
  const bytes = await readBytes(options.path, MAX_SOURCE_BYTES);
  canceled(options.shouldCancel);
  const analysis = analyzeBytes(bytes, options.name || 'input.jpg');
  const ranges = locateEmbeddedMotionParts(analysis);
  const video = prepareVideo(bytes.subarray(ranges.videoStart, ranges.videoEnd));
  let cover;
  if (analysis.staticFormat === 'JPEG') cover = bytes.subarray(0, ranges.imageEnd);
  else {
    if (!options.normalizeCover) throw new Error('此照片需要转换为 JPEG，请在支持该图片格式的设备上重试。');
    const normalized = await options.normalizeCover(options.path);
    try { cover = await readBytes(normalized.path, MAX_COVER_BYTES); }
    finally { if (normalized.path !== options.path) { try { await callFile('unlink', { filePath: normalized.path }); } catch (_ignored) {} } }
  }
  canceled(options.shouldCancel);
  return writeMotionPhoto(cover, video, { ...options, timestampUs: analysis.presentationTimestampUs === null ? -1 : analysis.presentationTimestampUs });
}

async function verifyMotionPhoto(filePath, expectedPath) {
  const bytes = await readBytes(filePath, MAX_OUTPUT_BYTES);
  let expectedVideo;
  let timestampUs;
  if (expectedPath) {
    const expectedBytes = await readBytes(expectedPath, MAX_OUTPUT_BYTES);
    const expected = validateMotionPhoto(expectedBytes);
    expectedVideo = expectedBytes.subarray(expected.videoStart, expected.videoStart + expected.videoSize);
    timestampUs = expected.presentationTimestampUs;
  }
  const analysis = validateMotionPhoto(bytes, expectedVideo, timestampUs);
  return { sizeBytes: bytes.length, videoSize: analysis.videoSize, timestampUs: analysis.presentationTimestampUs };
}

module.exports = { generateMotionPhoto, convertEmbeddedMotionPhoto, verifyMotionPhoto, MAX_VIDEO_BYTES, MAX_SOURCE_BYTES };
