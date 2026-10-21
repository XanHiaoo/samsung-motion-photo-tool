// Generated from web/src/core/mux.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.muxSamsungMotionPhoto = muxSamsungMotionPhoto;
exports.outputName = outputName;
const binary_1 = require("./binary");
const jpeg_1 = require("./jpeg");
const mp4_1 = require("./mp4");
const samsung_1 = require("./samsung");
const xmp_1 = require("./xmp");
function muxSamsungMotionPhoto(imageInput, videoInput, options = {}) {
    var _a;
    if (!(0, jpeg_1.isJpeg)(imageInput))
        throw new Error('MVP 输出目前要求 JPEG 主图片；HEIC 输入请先转换为 JPEG。');
    const jpeg = (0, jpeg_1.parseJpeg)(imageInput);
    if (!jpeg)
        throw new Error('无法解析 JPEG 结构。');
    const cleanImage = imageInput.slice(0, jpeg.eoi);
    const videoStart = (0, mp4_1.findMp4Start)(videoInput, 0);
    if (videoStart !== 0)
        throw new Error('视频不是有效的 MP4/MOV（缺少 ftyp box）。');
    const videoFormat = (0, mp4_1.detectVideoFormat)(videoInput, 0);
    const videoMime = options.sourceVideoMime === 'video/quicktime' || videoFormat === 'MOV/QuickTime' ? 'video/quicktime' : 'video/mp4';
    const trailer = (0, samsung_1.buildSamsungTrailer)(videoInput);
    const timestampUs = (_a = options.timestampUs) !== null && _a !== void 0 ? _a : -1;
    const xmp = (0, xmp_1.buildMotionPhotoXmp)(trailer.motionItemLength, trailer.negativeVideoOffset, timestampUs, videoMime, trailer.primaryPadding);
    const imageWithXmp = (0, jpeg_1.injectXmp)(cleanImage, xmp);
    return (0, binary_1.concatBytes)(imageWithXmp, trailer.bytes);
}
function outputName(inputName) {
    const stem = inputName.replace(/\.[^.]+$/, '').replace(/_MP$/i, '');
    return `${stem}_MP.jpg`;
}
