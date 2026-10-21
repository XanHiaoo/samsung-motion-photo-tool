// Generated from web/src/core/jpeg.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isJpeg = isJpeg;
exports.parseJpeg = parseJpeg;
exports.makeXmpApp1 = makeXmpApp1;
exports.injectXmp = injectXmp;
const binary_1 = require("./binary");
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
function isJpeg(bytes) {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
function startsWith(bytes, offset, text) {
    const target = (0, binary_1.utf8)(text);
    if (offset + target.length > bytes.length)
        return false;
    return target.every((value, index) => bytes[offset + index] === value);
}
function parseJpeg(bytes) {
    if (!isJpeg(bytes))
        return null;
    const segments = [];
    let position = 2;
    while (position + 1 < bytes.length) {
        if (bytes[position] !== 0xff)
            return null;
        const markerStart = position;
        while (bytes[position] === 0xff)
            position += 1;
        const marker = bytes[position];
        position += 1;
        if (marker === 0xd9)
            return { eoi: position, scanStart: markerStart, segments };
        if (marker === 0xda) {
            if (position + 2 > bytes.length)
                return null;
            const scanStart = markerStart;
            position += (0, binary_1.readBe16)(bytes, position);
            for (let index = position; index + 1 < bytes.length; index += 1) {
                if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
                    return { eoi: index + 2, scanStart, segments };
                }
            }
            return null;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8))
            continue;
        if (position + 2 > bytes.length)
            return null;
        const length = (0, binary_1.readBe16)(bytes, position);
        if (length < 2 || position + length > bytes.length)
            return null;
        const end = position + length;
        segments.push({
            start: markerStart,
            end,
            marker,
            isXmp: marker === 0xe1 && startsWith(bytes, position + 2, XMP_HEADER),
        });
        position = end;
    }
    return null;
}
function makeXmpApp1(xmp) {
    const payload = (0, binary_1.concatBytes)((0, binary_1.utf8)(XMP_HEADER), (0, binary_1.utf8)(xmp));
    if (payload.length + 2 > 0xffff)
        throw new Error('XMP packet exceeds the JPEG APP1 size limit.');
    return (0, binary_1.concatBytes)(new Uint8Array([0xff, 0xe1]), (0, binary_1.writeBe16)(payload.length + 2), payload);
}
function injectXmp(bytes, xmp) {
    const structure = parseJpeg(bytes);
    if (!structure)
        throw new Error('输入图片不是有效的 JPEG。');
    const prefixParts = [bytes.slice(0, 2)];
    let cursor = 2;
    for (const segment of structure.segments) {
        if (segment.start > cursor)
            prefixParts.push(bytes.slice(cursor, segment.start));
        if (!segment.isXmp)
            prefixParts.push(bytes.slice(segment.start, segment.end));
        cursor = segment.end;
    }
    if (cursor < structure.scanStart)
        prefixParts.push(bytes.slice(cursor, structure.scanStart));
    prefixParts.push(makeXmpApp1(xmp));
    prefixParts.push(bytes.slice(structure.scanStart, structure.eoi));
    return (0, binary_1.concatBytes)(...prefixParts);
}
