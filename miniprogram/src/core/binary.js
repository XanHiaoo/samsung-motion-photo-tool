// Generated from web/src/core/binary.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.utf8 = utf8;
exports.ascii = ascii;
exports.concatBytes = concatBytes;
exports.readBe16 = readBe16;
exports.readBe32 = readBe32;
exports.readLe32 = readLe32;
exports.writeBe16 = writeBe16;
exports.writeLe32 = writeLe32;
exports.findAscii = findAscii;
exports.formatBytes = formatBytes;
exports.normalizedStem = normalizedStem;
function utf8(value) {
    // Mini Program runtimes do not consistently provide TextEncoder.
    const bytes = [];
    for (const character of value) {
        let point = character.codePointAt(0);
        if (point >= 0xd800 && point <= 0xdfff)
            point = 0xfffd;
        if (point < 0x80)
            bytes.push(point);
        else if (point < 0x800)
            bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        else if (point < 0x10000)
            bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        else
            bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    }
    return new Uint8Array(bytes);
}
function ascii(bytes, start, length) {
    let result = '';
    const end = Math.min(bytes.length, start + length);
    for (let index = start; index < end; index += 1)
        result += String.fromCharCode(bytes[index]);
    return result;
}
function concatBytes(...parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}
function readBe16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
}
function readBe32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}
function readLe32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}
function writeBe16(value) {
    const output = new Uint8Array(2);
    new DataView(output.buffer).setUint16(0, value, false);
    return output;
}
function writeLe32(value) {
    const output = new Uint8Array(4);
    new DataView(output.buffer).setUint32(0, value, true);
    return output;
}
function findAscii(bytes, needle, from = 0, limit = bytes.length) {
    const target = utf8(needle);
    const end = Math.min(limit, bytes.length) - target.length;
    outer: for (let index = Math.max(0, from); index <= end; index += 1) {
        for (let inner = 0; inner < target.length; inner += 1) {
            if (bytes[index + inner] !== target[inner])
                continue outer;
        }
        return index;
    }
    return -1;
}
function formatBytes(value) {
    if (value === null)
        return '—';
    if (value < 1024)
        return `${value} B`;
    if (value < 1024 ** 2)
        return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(2)} MB`;
}
function normalizedStem(fileName) {
    return fileName.replace(/\.[^.]+$/, '').replace(/(?:_MP|\.LIVE)$/i, '').toLowerCase();
}
