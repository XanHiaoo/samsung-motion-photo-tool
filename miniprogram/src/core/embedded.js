// Generated from web/src/core/embedded.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locateEmbeddedMotionParts = locateEmbeddedMotionParts;
function locateEmbeddedMotionParts(analysis) {
    var _a;
    if (analysis.staticFormat === 'Unknown')
        throw new Error('未识别到 JPEG 或 HEIC 静态图片。');
    if (analysis.videoStart === null || analysis.videoSize === null || analysis.videoSize <= 8) {
        throw new Error('未在文件中找到内嵌的 MP4/MOV 视频。');
    }
    const videoEnd = analysis.videoStart + analysis.videoSize;
    if (analysis.videoStart <= 0 || videoEnd > analysis.size)
        throw new Error('动态图中的视频位置或长度无效。');
    const isMov = analysis.videoFormat === 'MOV/QuickTime';
    return {
        imageStart: 0,
        imageEnd: (_a = analysis.jpegEoi) !== null && _a !== void 0 ? _a : analysis.videoStart,
        videoStart: analysis.videoStart,
        videoEnd,
        videoMime: isMov ? 'video/quicktime' : 'video/mp4',
        videoExtension: isMov ? 'mov' : 'mp4',
    };
}
