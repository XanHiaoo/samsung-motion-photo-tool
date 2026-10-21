const word = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((n, i) => b.writeUInt32BE(n >>> 0, i * 4)); return b; };
const box = (name, ...parts) => { const data = Buffer.concat(parts); return Buffer.concat([word(data.length + 8), Buffer.from(name), data]); };
const full = (name, ...parts) => box(name, word(0), ...parts);
function videoFixture(options = {}) {
  const ftyp = box('ftyp', Buffer.from(options.mov ? 'qt  ' : 'isom'), word(0), Buffer.from('isommp42'));
  const samples = Array.from({ length: 8 }, (_, i) => Buffer.from([i + 1, 7, 8, 9]));
  const media = box('mdat', ...samples);
  const stbl = box('stbl', full('stsd', word(1), box('avc1', Buffer.alloc(78))),
    full('stts', word(1, 8, 1000)), full('stsc', word(1, 1, 8, 1)), full('stsz', word(4, 8)),
    options.co64 ? full('co64', word(1, 0, ftyp.length + 8)) : full('stco', word(1, ftyp.length + 8)),
    full('stss', word(2, 1, 5)));
  const mdia = box('mdia', full('mdhd', word(0, 0, 1000, 8000)), full('hdlr', word(0), Buffer.from('vide')),
    box('minf', full('vmhd', word(0, 0)), box('dinf', full('dref', word(0))), stbl));
  const trak = box('trak', full('tkhd', word(0, 0, 1, 0, 8000)), mdia);
  const moov = box('moov', full('mvhd', word(0, 0, 1000, 8000)), trak, ...(options.fragmented ? [box('mvex')] : []));
  return new Uint8Array(Buffer.concat([ftyp, media, moov]));
}
module.exports = { videoFixture };
