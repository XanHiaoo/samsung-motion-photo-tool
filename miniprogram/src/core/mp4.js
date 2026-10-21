// Generated from web/src/core/mp4.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findMp4Start = findMp4Start;
exports.parseTopLevelAtoms = parseTopLevelAtoms;
exports.detectVideoFormat = detectVideoFormat;
exports.detectCodec = detectCodec;
exports.parseDuration = parseDuration;
const binary_1 = require("./binary");
function findMp4Start(bytes, from = 0) {
    let cursor = from;
    while (cursor < bytes.length - 12) {
        const ftyp = (0, binary_1.findAscii)(bytes, 'ftyp', cursor);
        if (ftyp < 4)
            return null;
        const start = ftyp - 4;
        const size = (0, binary_1.readBe32)(bytes, start);
        if (size >= 8 && start + size <= bytes.length)
            return start;
        cursor = ftyp + 4;
    }
    return null;
}
function parseTopLevelAtoms(bytes, start = 0, end = bytes.length) {
    const atoms = [];
    let offset = start;
    while (offset + 8 <= end) {
        let size = (0, binary_1.readBe32)(bytes, offset);
        const type = (0, binary_1.ascii)(bytes, offset + 4, 4);
        let header = 8;
        if (size === 1) {
            if (offset + 16 > end)
                break;
            const high = (0, binary_1.readBe32)(bytes, offset + 8);
            const low = (0, binary_1.readBe32)(bytes, offset + 12);
            const combined = high * 2 ** 32 + low;
            if (!Number.isSafeInteger(combined))
                break;
            size = combined;
            header = 16;
        }
        else if (size === 0) {
            size = end - offset;
        }
        if (size < header || offset + size > end)
            break;
        atoms.push({ type, offset, size });
        offset += size;
    }
    return atoms;
}
function detectVideoFormat(bytes, start) {
    const brand = (0, binary_1.ascii)(bytes, start + 8, 4);
    if (brand === 'qt  ')
        return 'MOV/QuickTime';
    if ((0, binary_1.ascii)(bytes, start + 4, 4) === 'ftyp')
        return 'MP4';
    return 'Unknown';
}
function detectCodec(bytes, start, end) {
    const codecs = [
        ['avc1', 'H.264 / AVC'],
        ['avc3', 'H.264 / AVC'],
        ['hvc1', 'H.265 / HEVC'],
        ['hev1', 'H.265 / HEVC'],
        ['av01', 'AV1'],
    ];
    for (const [needle, label] of codecs) {
        if ((0, binary_1.findAscii)(bytes, needle, start, end) >= 0)
            return label;
    }
    return null;
}
function parseDuration(bytes, start, end) {
    const mvhd = (0, binary_1.findAscii)(bytes, 'mvhd', start, end);
    if (mvhd < 0 || mvhd + 24 >= end)
        return null;
    const version = bytes[mvhd + 4];
    if (version === 0) {
        const timescale = (0, binary_1.readBe32)(bytes, mvhd + 16);
        const duration = (0, binary_1.readBe32)(bytes, mvhd + 20);
        return timescale ? duration / timescale : null;
    }
    if (version === 1 && mvhd + 36 < end) {
        const timescale = (0, binary_1.readBe32)(bytes, mvhd + 24);
        const high = (0, binary_1.readBe32)(bytes, mvhd + 28);
        const low = (0, binary_1.readBe32)(bytes, mvhd + 32);
        const duration = high * 2 ** 32 + low;
        return timescale && Number.isSafeInteger(duration) ? duration / timescale : null;
    }
    return null;
}
