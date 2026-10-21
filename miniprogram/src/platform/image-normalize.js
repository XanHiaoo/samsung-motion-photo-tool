const { drawOrientedFrame, canvasToJpeg } = require('./video-frame');
const MAX_PIXELS = 10000000;
function getImageInfo(path) {
  return new Promise((resolve, reject) => wx.getImageInfo({ src: path, success: resolve,
    fail: () => reject(new Error('当前微信无法读取此图片，请换用 JPEG 或 PNG 后重试。')) }));
}
function loadImage(canvas, path) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法解码此图片，请换用 JPEG 或 PNG。'));
    image.src = path;
  });
}
async function normalizeImage(path, sourceCanvas, outputCanvas, targetSize) {
  const info = await getImageInfo(path);
  const width = Number(info.width), height = Number(info.height);
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('图片过大，请缩小到 1000 万像素以内后重试。');
  const type = String(info.type || '').toLowerCase();
  if ((type === 'jpeg' || type === 'jpg') && !targetSize) return { path, width, height, temporary: false };
  if (!sourceCanvas || !outputCanvas) throw new Error('图片画布未准备好，请稍后重试。');
  let resultPath;
  try {
    const image = await loadImage(sourceCanvas, info.path || path);
    sourceCanvas.width = width; sourceCanvas.height = height;
    const context = sourceCanvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let size = drawOrientedFrame(sourceCanvas, outputCanvas, width, height, info.orientation || 'up');
    if (targetSize) {
      const w = Math.round(targetSize.width), h = Math.round(targetSize.height);
      if (!(w > 0 && h > 0 && w * h <= MAX_PIXELS)) throw new Error('目标封面尺寸过大或无效。');
      sourceCanvas.width = w; sourceCanvas.height = h;
      const target = sourceCanvas.getContext('2d');
      const scale = Math.max(w / size.width, h / size.height);
      const sw = w / scale, sh = h / scale;
      target.fillStyle = '#ffffff'; target.fillRect(0, 0, w, h);
      target.drawImage(outputCanvas, (size.width - sw) / 2, (size.height - sh) / 2, sw, sh, 0, 0, w, h);
      resultPath = await canvasToJpeg(sourceCanvas, w, h);
      size = { width: w, height: h };
    } else resultPath = await canvasToJpeg(outputCanvas, size.width, size.height);
    return { path: resultPath, width: size.width, height: size.height, temporary: true };
  } finally {
    sourceCanvas.width = 1; sourceCanvas.height = 1; outputCanvas.width = 1; outputCanvas.height = 1;
  }
}
module.exports = { normalizeImage };
