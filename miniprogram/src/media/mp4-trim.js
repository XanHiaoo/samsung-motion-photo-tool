// Stream-copy ordinary MP4 tracks. Keep decoding preroll and use edit lists for
// the selected presentation interval, so B frames and audio stay synchronized.
const MAX_SAMPLES = 500000;
const u32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p);
const i32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(p);
const text = (b, p, n) => String.fromCharCode.apply(null, b.subarray(p, p + n));
const number64 = (b, p) => {
  const n = u32(b, p) * 4294967296 + u32(b, p + 4);
  if (!Number.isSafeInteger(n)) throw new Error('视频包含过大的时间戳或偏移。');
  return n;
};
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  parts.forEach(p => { out.set(p, offset); offset += p.length; });
  return out;
}
function words(values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}
function box(type, ...parts) {
  const data = concat(parts);
  return concat([words([data.length + 8]), Uint8Array.from(type, c => c.charCodeAt(0)), data]);
}
function full(type, version, ...parts) { return box(type, Uint8Array.from([version, 0, 0, 0]), ...parts); }
function boxes(bytes, start = 0, end = bytes.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw new Error('视频容器不完整。');
    let size = u32(bytes, offset), header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new Error('视频容器不完整。');
      size = number64(bytes, offset + 8); header = 16;
    } else if (!size) size = end - offset;
    if (size < header || offset + size > end) throw new Error('视频容器位置无效。');
    result.push({ type: text(bytes, offset + 4, 4), start: offset, end: offset + size, payload: offset + header });
    offset += size;
  }
  return result;
}
function required(list, type) {
  const found = list.find(b => b.type === type);
  if (!found) throw new Error(`此视频缺少 ${type} 信息，暂不支持直接裁剪。`);
  return found;
}
function bounded(b, p, n) {
  if (p < b.payload || p + n > b.end) throw new Error('视频轨道表不完整。');
}
function count(bytes, b, width, start = b.payload + 8) {
  bounded(b, b.payload, 8);
  const n = u32(bytes, b.payload + 4);
  if (n > MAX_SAMPLES) throw new Error('视频轨道过长，请先缩短视频。');
  bounded(b, start, n * width);
  return n;
}
function timing(bytes, b) {
  const v = bytes[b.payload];
  if (v > 1) throw new Error('不支持此视频的时间格式。');
  const p = b.payload + (v ? 20 : 12);
  bounded(b, p, v ? 12 : 8);
  const scale = u32(bytes, p);
  if (!scale) throw new Error('视频时间基准无效。');
  return { scale, duration: v ? number64(bytes, p + 4) : u32(bytes, p + 4) };
}
function withDuration(bytes, b, duration, track = false) {
  const out = bytes.slice(b.start, b.end);
  const version = bytes[b.payload];
  if (version > 1) throw new Error('不支持此视频的时间格式。');
  const p = b.payload - b.start + (track ? (version ? 28 : 20) : (version ? 24 : 16));
  if (p + (version ? 8 : 4) > out.length || !Number.isSafeInteger(duration) || duration < 0) throw new Error('视频时长无效。');
  const view = new DataView(out.buffer);
  if (version) { view.setUint32(p, Math.floor(duration / 4294967296)); view.setUint32(p + 4, duration >>> 0); }
  else {
    if (duration > 0xffffffff) throw new Error('视频时长超出支持范围。');
    view.setUint32(p, duration);
  }
  return out;
}
function runs(values) {
  const result = [];
  values.forEach(value => {
    const last = result[result.length - 1];
    if (last && last[1] === value) last[0] += 1;
    else result.push([1, value]);
  });
  return result;
}
function timeTable(type, values) {
  const entries = runs(values);
  return full(type, type === 'ctts' && values.some(n => n < 0) ? 1 : 0, words([entries.length, ...entries.flat()]));
}
function expandTimes(bytes, b, sampleCount, signed) {
  const n = count(bytes, b, 8);
  const result = [];
  for (let i = 0; i < n; i += 1) {
    const p = b.payload + 8 + i * 8, length = u32(bytes, p);
    if (result.length + length > sampleCount) throw new Error('视频时间表与帧数不一致。');
    const value = signed ? i32(bytes, p + 4) : u32(bytes, p + 4);
    for (let j = 0; j < length; j += 1) result.push(value);
  }
  if (result.length !== sampleCount) throw new Error('视频时间表与帧数不一致。');
  return result;
}
function parseTrack(bytes, trak, movieScale, mdats) {
  const children = boxes(bytes, trak.payload, trak.end);
  const tkhd = required(children, 'tkhd'), mdia = required(children, 'mdia');
  const media = boxes(bytes, mdia.payload, mdia.end);
  const hdlr = required(media, 'hdlr');
  bounded(hdlr, hdlr.payload + 8, 4);
  const kind = text(bytes, hdlr.payload + 8, 4);
  if (kind !== 'vide' && kind !== 'soun') return null;
  const mdhd = required(media, 'mdhd'), clock = timing(bytes, mdhd);
  const minf = required(media, 'minf'), info = boxes(bytes, minf.payload, minf.end);
  const stbl = required(info, 'stbl'), table = boxes(bytes, stbl.payload, stbl.end);
  const stsd = required(table, 'stsd'), descriptions = boxes(bytes, stsd.payload + 8, stsd.end);
  if (!descriptions.length || descriptions.some(d => !['avc1', 'avc3', 'hvc1', 'hev1', 'mp4a'].includes(d.type))) {
    throw new Error('直接裁剪支持 H.264 / HEVC 视频与 AAC 音频，请换用兼容的 MP4。');
  }
  const stsz = required(table, 'stsz');
  bounded(stsz, stsz.payload, 12);
  const sampleSize = u32(bytes, stsz.payload + 4), n = u32(bytes, stsz.payload + 8);
  if (!n || n > MAX_SAMPLES) throw new Error('视频帧数无效或过多。');
  if (!sampleSize) bounded(stsz, stsz.payload + 12, n * 4);
  const durations = expandTimes(bytes, required(table, 'stts'), n, false);
  const ctts = table.find(b => b.type === 'ctts');
  const compositions = ctts ? expandTimes(bytes, ctts, n, bytes[ctts.payload] === 1) : new Array(n).fill(0);
  const stco = table.find(b => b.type === 'stco') || required(table, 'co64');
  const chunkCount = count(bytes, stco, stco.type === 'co64' ? 8 : 4);
  const stsc = required(table, 'stsc'), entryCount = count(bytes, stsc, 12);
  const entries = [];
  for (let i = 0; i < entryCount; i += 1) {
    const p = stsc.payload + 8 + i * 12;
    entries.push({ chunk: u32(bytes, p), samples: u32(bytes, p + 4), description: u32(bytes, p + 8) });
  }
  if (!entries.length || entries[0].chunk !== 1 || entries.some((e, i) => !e.samples || e.chunk > chunkCount
      || (i && e.chunk <= entries[i - 1].chunk) || e.description !== entries[0].description)
      || entries[0].description < 1 || entries[0].description > descriptions.length) throw new Error('暂不支持此视频的混合轨道描述。');
  const syncBox = table.find(b => b.type === 'stss'), sync = new Set();
  if (syncBox) {
    const syncCount = count(bytes, syncBox, 4);
    for (let i = 0; i < syncCount; i += 1) sync.add(u32(bytes, syncBox.payload + 8 + i * 4) - 1);
  }
  const samples = [];
  let dts = 0, entry = 0;
  for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
    while (entry + 1 < entries.length && entries[entry + 1].chunk <= chunk) entry += 1;
    const p = stco.payload + 8 + (chunk - 1) * (stco.type === 'co64' ? 8 : 4);
    let offset = stco.type === 'co64' ? number64(bytes, p) : u32(bytes, p);
    if (samples.length + entries[entry].samples > n) throw new Error('视频块表与帧数不一致。');
    for (let j = 0; j < entries[entry].samples; j += 1) {
      const i = samples.length, size = sampleSize || u32(bytes, stsz.payload + 12 + i * 4);
      if (!size || !durations[i] || !mdats.some(b => offset >= b.payload && offset + size <= b.end)) throw new Error('视频帧位置无效。');
      samples.push({ offset, size, duration: durations[i], composition: compositions[i], dts,
        pts: dts + compositions[i], sync: !syncBox || sync.has(i) });
      offset += size; dts += durations[i];
    }
  }
  if (samples.length !== n) throw new Error('视频块表与帧数不一致。');
  let delay = 0, mediaStart = 0, segmentDuration = clock.duration / clock.scale * movieScale;
  const edts = children.find(b => b.type === 'edts');
  if (edts) {
    const elst = required(boxes(bytes, edts.payload, edts.end), 'elst');
    const version = bytes[elst.payload], width = version ? 20 : 12;
    if (version > 1) throw new Error('不支持此视频的编辑时间线。');
    const editCount = count(bytes, elst, width);
    let mediaSegments = 0;
    for (let i = 0; i < editCount; i += 1) {
      const p = elst.payload + 8 + i * width;
      const duration = version ? number64(bytes, p) : u32(bytes, p);
      const m = p + (version ? 8 : 4);
      const empty = i32(bytes, m) === -1 && (!version || u32(bytes, m + 4) === 0xffffffff);
      const time = empty ? -1 : version ? number64(bytes, m) : i32(bytes, m);
      if (u32(bytes, p + width - 4) !== 65536 || (empty && mediaSegments) || (!empty && (++mediaSegments > 1 || time < 0))) {
        throw new Error('暂不支持含变速或多段编辑的视频。');
      }
      if (empty) delay += duration;
      else { mediaStart = time; segmentDuration = duration; }
    }
    if (!mediaSegments) return null;
  }
  return { children, tkhd, mdia, media, mdhd, minf, info, stsd, kind, clock,
    delay, mediaStart, segmentDuration, samples, hasSync: !!syncBox, description: entries[0].description };
}
function select(track, start, end, movieScale) {
  const begin = Math.max(start, track.delay), finish = Math.min(end, track.delay + track.segmentDuration);
  if (finish <= begin) return null;
  const from = track.mediaStart + (begin - track.delay) * track.clock.scale / movieScale;
  const to = track.mediaStart + (finish - track.delay) * track.clock.scale / movieScale;
  let first = track.samples.findIndex(s => s.pts + s.duration > from && s.pts < to), last = -1;
  if (first < 0) return null;
  for (let i = first; i < track.samples.length; i += 1) {
    const s = track.samples[i];
    if (s.pts < to && s.pts + s.duration > from) last = i;
  }
  if (track.kind === 'vide') {
    while (first >= 0 && !track.samples[first].sync) first -= 1;
    if (first < 0) throw new Error('所选片段前没有可用的关键帧，请换一个起点。');
  }
  const samples = track.samples.slice(first, last + 1);
  const offset = Math.round(from - samples[0].dts);
  if (offset < 0 || offset > 0x7fffffff) throw new Error('此视频时间线暂不支持直接裁剪。');
  return { ...track, samples, leading: Math.round(begin - start), presentation: Math.round(finish - begin), offset };
}
function buildTrack(bytes, t, chunkOffset) {
  const sampleBytes = t.samples.reduce((n, s) => n + s.duration, 0);
  const stbl = box('stbl', bytes.subarray(t.stsd.start, t.stsd.end), timeTable('stts', t.samples.map(s => s.duration)),
    ...(t.samples.some(s => s.composition) ? [timeTable('ctts', t.samples.map(s => s.composition))] : []),
    full('stsc', 0, words([1, 1, t.samples.length, t.description])),
    full('stsz', 0, words([0, t.samples.length, ...t.samples.map(s => s.size)])),
    full('stco', 0, words([1, chunkOffset])),
    ...(t.hasSync ? [full('stss', 0, words([t.samples.filter(s => s.sync).length,
      ...t.samples.map((s, i) => s.sync ? i + 1 : 0).filter(Boolean)]))] : []));
  const minf = box('minf', ...t.info.map(b => b.type === 'stbl' ? stbl : bytes.subarray(b.start, b.end)));
  const mdia = box('mdia', ...t.media.map(b => b.type === 'mdhd' ? withDuration(bytes, b, sampleBytes)
    : b.type === 'minf' ? minf : bytes.subarray(b.start, b.end)));
  const editValues = t.leading ? [2, t.leading, 0xffffffff, 65536, t.presentation, t.offset, 65536]
    : [1, t.presentation, t.offset, 65536];
  const edts = box('edts', full('elst', 0, words(editValues)));
  return box('trak', withDuration(bytes, t.tkhd, t.leading + t.presentation, true), edts, mdia);
}

function trimMp4(bytes, startSeconds, endSeconds) {
  const top = boxes(bytes), moov = required(top, 'moov'), children = boxes(bytes, moov.payload, moov.end);
  if (top.some(b => b.type === 'moof') || children.some(b => b.type === 'mvex')) throw new Error('暂不支持分片 MP4，请换用普通 MP4 视频。');
  const mvhd = required(children, 'mvhd'), clock = timing(bytes, mvhd);
  const start = Math.round(startSeconds * clock.scale), end = Math.min(clock.duration, Math.round(endSeconds * clock.scale));
  if (![startSeconds, endSeconds].every(Number.isFinite) || start < 0 || end <= start || start >= clock.duration) throw new Error('请选择有效的视频片段。');
  if (end - start > 0xffffffff) throw new Error('所选片段的时间范围过大，请缩短后重试。');
  const mdats = top.filter(b => b.type === 'mdat');
  const tracks = children.filter(b => b.type === 'trak').map(b => parseTrack(bytes, b, clock.scale, mdats))
    .filter(Boolean).map(t => select(t, start, end, clock.scale)).filter(Boolean);
  if (!tracks.some(t => t.kind === 'vide')) throw new Error('所选片段没有可用的视频轨道。');
  const ftyp = box('ftyp', Uint8Array.from('isom', c => c.charCodeAt(0)), words([512]),
    Uint8Array.from('isomiso2mp41mp42', c => c.charCodeAt(0)));
  const movie = offsets => box('moov', withDuration(bytes, mvhd, end - start), ...tracks.map((t, i) => buildTrack(bytes, t, offsets[i] || 0)));
  let metadata = movie([]), offset = ftyp.length + metadata.length + 8;
  const offsets = tracks.map(t => { const p = offset; offset += t.samples.reduce((n, s) => n + s.size, 0); return p; });
  metadata = movie(offsets);
  const mediaParts = tracks.flatMap(t => t.samples.map(s => bytes.subarray(s.offset, s.offset + s.size)));
  return { bytes: concat([ftyp, metadata, box('mdat', concat(mediaParts))]), startSeconds: start / clock.scale,
    durationSeconds: (end - start) / clock.scale };
}

module.exports = { trimMp4 };
