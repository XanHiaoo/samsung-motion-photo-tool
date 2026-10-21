// Generated from web/src/core/analyze.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeBytes = analyzeBytes;
const binary_1 = require("./binary");
const jpeg_1 = require("./jpeg");
const mp4_1 = require("./mp4");
const samsung_1 = require("./samsung");
const validate_1 = require("./validate");
const xmp_1 = require("./xmp");
function isHeif(bytes) {
    if (bytes.length < 12 || (0, binary_1.ascii)(bytes, 4, 4) !== 'ftyp')
        return false;
    return /^(?:hei[cf]|mif1|msf1|heix)$/i.test((0, binary_1.ascii)(bytes, 8, 4));
}
function analyzeBytes(bytes, fileName, mime = '') {
    var _a, _b, _c, _d;
    const jpeg = (0, jpeg_1.parseJpeg)(bytes);
    const heif = !jpeg && isHeif(bytes);
    const xmp = (0, xmp_1.extractXmp)(bytes);
    const samsung = (0, samsung_1.parseSamsungTrailer)(bytes);
    const xmpVideoLength = (0, xmp_1.xmpNumber)(xmp, 'Item:Length');
    const microVideoOffset = (0, xmp_1.xmpNumber)(xmp, 'Camera:MicroVideoOffset', 'GCamera:MicroVideoOffset');
    const samsungVideoIsMp4 = samsung ? (0, mp4_1.findMp4Start)(bytes, samsung.videoStart) === samsung.videoStart : false;
    let videoStart = samsungVideoIsMp4 ? samsung.videoStart : null;
    let videoSize = samsungVideoIsMp4 ? samsung.videoSize : null;
    if (videoStart === null && heif) {
        const mpvdType = (0, binary_1.findAscii)(bytes, 'mpvd');
        if (mpvdType >= 4) {
            const boxStart = mpvdType - 4;
            const boxSize = (0, binary_1.readBe32)(bytes, boxStart);
            const embeddedStart = mpvdType + 4;
            if (boxSize > 16 && boxStart + boxSize <= bytes.length && (0, mp4_1.findMp4Start)(bytes, embeddedStart) === embeddedStart) {
                videoStart = embeddedStart;
                videoSize = boxSize - 8;
            }
        }
    }
    if (videoStart === null && xmpVideoLength && xmpVideoLength > 8 && xmpVideoLength <= bytes.length) {
        videoStart = bytes.length - xmpVideoLength;
        videoSize = xmpVideoLength;
    }
    else if (videoStart === null && microVideoOffset && microVideoOffset > 8 && microVideoOffset <= bytes.length) {
        videoStart = bytes.length - microVideoOffset;
        videoSize = microVideoOffset;
    }
    if (videoStart === null && (jpeg || heif)) {
        const searchFrom = (_a = jpeg === null || jpeg === void 0 ? void 0 : jpeg.eoi) !== null && _a !== void 0 ? _a : 0;
        const found = (0, mp4_1.findMp4Start)(bytes, searchFrom);
        if (found !== null) {
            videoStart = found;
            videoSize = ((_b = samsung === null || samsung === void 0 ? void 0 : samsung.sefStart) !== null && _b !== void 0 ? _b : bytes.length) - found;
        }
    }
    if (videoStart === null && !jpeg && !heif && (0, mp4_1.findMp4Start)(bytes, 0) === 0) {
        videoStart = 0;
        videoSize = bytes.length;
    }
    const videoEnd = videoStart !== null && videoSize !== null ? videoStart + videoSize : 0;
    const atoms = videoStart !== null ? (0, mp4_1.parseTopLevelAtoms)(bytes, videoStart, videoEnd) : [];
    const videoFormat = videoStart !== null ? (0, mp4_1.detectVideoFormat)(bytes, videoStart) : null;
    const codec = videoStart !== null ? (0, mp4_1.detectCodec)(bytes, videoStart, videoEnd) : null;
    const presentationTimestampUs = (0, xmp_1.xmpNumber)(xmp, 'Camera:MotionPhotoPresentationTimestampUs', 'GCamera:MicroVideoPresentationTimestampUs');
    const contentIdentifier = (0, xmp_1.extractContentIdentifier)(bytes);
    const hasMotionXmp = Boolean(xmp && /(?:Camera|GCamera):(?:MotionPhoto|MicroVideo)=["']1["']/i.test(xmp));
    const isVideoFile = !jpeg && !heif && videoStart === 0;
    const format = samsung
        ? 'Samsung Motion Photo'
        : hasMotionXmp && videoStart !== null
            ? 'Android Motion Photo'
            : (jpeg || heif) && videoStart !== null
                ? '内嵌动态照片'
                : contentIdentifier
                    ? 'Apple Live Photo 组件'
                    : jpeg || heif
                        ? '普通图片'
                        : isVideoFile
                            ? '普通视频'
                            : '未知格式';
    const base = {
        fileName,
        mime: mime || 'application/octet-stream',
        size: bytes.length,
        format,
        staticFormat: jpeg ? 'JPEG' : heif ? 'HEIC/HEIF' : 'Unknown',
        videoFormat,
        imageSize: (_c = jpeg === null || jpeg === void 0 ? void 0 : jpeg.eoi) !== null && _c !== void 0 ? _c : (videoStart !== null ? videoStart : heif ? bytes.length : null),
        videoStart,
        videoSize,
        jpegEoi: (_d = jpeg === null || jpeg === void 0 ? void 0 : jpeg.eoi) !== null && _d !== void 0 ? _d : null,
        xmp,
        hasXmp: Boolean(xmp),
        hasSamsungTrailer: Boolean(samsung),
        presentationTimestampUs,
        contentIdentifier,
        codec,
        durationSeconds: videoStart !== null ? (0, mp4_1.parseDuration)(bytes, videoStart, videoEnd) : null,
        mp4Atoms: atoms,
    };
    return { ...base, validation: (0, validate_1.validateAnalysis)(base) };
}
