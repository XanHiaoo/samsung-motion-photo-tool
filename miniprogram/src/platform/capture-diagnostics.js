function redactErrorMessage(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '未知错误')
    .replace(/(?:wxfile|file):\/\/[^\s'\"]+/gi, '[本地文件]')
    .replace(/[A-Za-z]:\\[^\s'\"]+/g, '[本地文件]')
    .replace(/\/(?:data|private|storage|tmp|Users)\/[^\s'\"]+/gi, '[本地文件]');
  return message.slice(0, 240);
}

function createCaptureDiagnostics(error, context) {
  const details = context || {};
  const video = details.video || {};
  const videoInfo = details.videoInfo || {};

  return {
    capturedAt: new Date().toISOString(),
    stage: error && error.frameStage || 'unknown',
    code: error && error.code || null,
    error: redactErrorMessage(error),
    requestedSeconds: Number.isFinite(details.requestedSeconds) ? details.requestedSeconds : null,
    video: {
      container: videoInfo.containerType || null,
      width: Number(videoInfo.width || video.width) || null,
      height: Number(videoInfo.height || video.height) || null,
      durationSeconds: Number(videoInfo.durationSeconds || video.durationSeconds) || null,
      fps: Number(videoInfo.fps) || null,
      orientation: videoInfo.orientation || null,
      sizeBytes: Number(video.sizeBytes || video.size) || null,
    },
    runtime: details.runtime || {},
    frame: error && error.frameDetails || null,
  };
}

function formatCaptureDiagnostics(diagnostics) {
  return JSON.stringify(diagnostics, null, 2);
}

module.exports = {
  createCaptureDiagnostics,
  formatCaptureDiagnostics,
};
