const { clipRange } = require('../../features/video-flow/clip');

function atPosition(x, bounds, duration) {
  if (!bounds || !(bounds.width > 0) || !Number.isFinite(bounds.left) || !Number.isFinite(x) || !(duration > 0)) return null;
  return Math.max(0, Math.min(duration, (x - bounds.left) / bounds.width * duration));
}

function moveHandle(range, edge, seconds, duration, step = 0.05) {
  const minimum = Math.min(0.1, duration);
  const snapped = Math.round(seconds / step) * step;
  return edge === 'start'
    ? clipRange(duration, Math.min(snapped, range.end - minimum), range.end)
    : clipRange(duration, range.start, Math.max(snapped, range.start + minimum));
}

function nearestHandle(seconds, range, preferred) {
  const startDistance = Math.abs(seconds - range.start), endDistance = Math.abs(seconds - range.end);
  if (Math.abs(startDistance - endDistance) < 1e-8) return preferred || 'start';
  return startDistance < endDistance ? 'start' : 'end';
}

module.exports = { atPosition, moveHandle, nearestHandle };
