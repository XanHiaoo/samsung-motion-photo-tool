function clipRange(duration, start = 0, end = duration) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) throw new Error('视频时长无效。');
  const minimum = Math.min(0.1, total);
  const a = Math.max(0, Math.min(total - minimum, Number(start) || 0));
  const b = Math.max(a + minimum, Math.min(total, Number(end) || total));
  return { start: a, end: b, duration: b - a };
}
function coverInClip(seconds, range) {
  return Math.max(range.start, Math.min(range.end - Math.min(0.05, range.duration * 0.01), Number(seconds) || 0));
}
module.exports = { clipRange, coverInClip };
