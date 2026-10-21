// Generated from web/src/core/samsung.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSamsungTrailer = buildSamsungTrailer;
exports.parseSamsungTrailer = parseSamsungTrailer;
const binary_1 = require("./binary");
const MOTION_DATA_MARKER = new Uint8Array([0x00, 0x00, 0x30, 0x0a]);
const MOTION_VERSION_MARKER = new Uint8Array([0x00, 0x00, 0x31, 0x0a]);
const MOTION_DATA_NAME = (0, binary_1.utf8)('MotionPhoto_Data');
const MOTION_VERSION_NAME = (0, binary_1.utf8)('MotionPhoto_Version');
function buildSamsungTrailer(video) {
    const motionHeader = (0, binary_1.concatBytes)(MOTION_DATA_MARKER, (0, binary_1.writeLe32)(MOTION_DATA_NAME.length), MOTION_DATA_NAME);
    const motionTag = (0, binary_1.concatBytes)(motionHeader, video);
    const versionTag = (0, binary_1.concatBytes)(MOTION_VERSION_MARKER, (0, binary_1.writeLe32)(MOTION_VERSION_NAME.length), MOTION_VERSION_NAME, (0, binary_1.utf8)('mpv3'));
    const motionOffset = motionTag.length + versionTag.length;
    const versionOffset = versionTag.length;
    const sefBody = (0, binary_1.concatBytes)((0, binary_1.utf8)('SEFH'), (0, binary_1.writeLe32)(107), (0, binary_1.writeLe32)(2), MOTION_DATA_MARKER, (0, binary_1.writeLe32)(motionOffset), (0, binary_1.writeLe32)(motionTag.length), MOTION_VERSION_MARKER, (0, binary_1.writeLe32)(versionOffset), (0, binary_1.writeLe32)(versionTag.length));
    const sefTail = (0, binary_1.concatBytes)((0, binary_1.writeLe32)(sefBody.length), (0, binary_1.utf8)('SEFT'));
    const bytes = (0, binary_1.concatBytes)(motionTag, versionTag, sefBody, sefTail);
    const motionItemLength = bytes.length - motionHeader.length;
    return {
        bytes,
        negativeVideoOffset: motionItemLength,
        motionItemLength,
        primaryPadding: motionHeader.length,
    };
}
function parseSamsungTrailer(bytes) {
    if (bytes.length < 40 || (0, binary_1.ascii)(bytes, bytes.length - 4, 4) !== 'SEFT')
        return null;
    const sefDataSize = (0, binary_1.readLe32)(bytes, bytes.length - 8);
    const sefStart = bytes.length - 8 - sefDataSize;
    if (sefStart < 0 || (0, binary_1.ascii)(bytes, sefStart, 4) !== 'SEFH')
        return null;
    const fieldCount = (0, binary_1.readLe32)(bytes, sefStart + 8);
    if (fieldCount < 1 || sefStart + 12 + fieldCount * 12 > bytes.length - 8)
        return null;
    for (let index = 0; index < fieldCount; index += 1) {
        const record = sefStart + 12 + index * 12;
        if (bytes[record + 2] !== 0x30 || bytes[record + 3] !== 0x0a)
            continue;
        const negativeOffset = (0, binary_1.readLe32)(bytes, record + 4);
        const fieldSize = (0, binary_1.readLe32)(bytes, record + 8);
        const trailerStart = sefStart - negativeOffset;
        if (trailerStart < 0 || trailerStart + fieldSize > sefStart)
            continue;
        const nameLength = (0, binary_1.readLe32)(bytes, trailerStart + 4);
        if (nameLength > 256 || (0, binary_1.ascii)(bytes, trailerStart + 8, nameLength) !== 'MotionPhoto_Data')
            continue;
        const videoStart = trailerStart + 8 + nameLength;
        const videoSize = fieldSize - 8 - nameLength;
        if (videoSize <= 0 || videoStart + videoSize > sefStart)
            continue;
        return { trailerStart, videoStart, videoSize, sefStart, fieldSize };
    }
    return null;
}
