# 微信小程序开发方案

更新：2026-10-22。分支：`feature/wechat-miniprogram`；已合入主分支 `d4863e1`（v1.0.1）。用户已反馈原有真机视频生成功能在部分格式可用，本轮继续优化视频剪辑并完成另外两个模块。

## 当前范围与实现

| 模式 | 操作和输出 |
| --- | --- |
| 视频生成 | 导入 MP4/MOV → 同页选择起止/封面 → 片段预览 → 本机快速裁剪/封装 → 保存、导出、回读 |
| 照片 + 视频 | 导入照片和视频 → 可选按视频比例居中裁切封面 → 同页选择片段 → 生成、保存、导出、回读 |
| 批量转换 | 原图或聊天文件导入 → 逐个提取内嵌视频/转换 → 独立结果、暂停继续、失败重试、单项/全部保存、导出 |

不引入渐变、精确重编码裁剪、浏览器 FFmpeg WASM 或服务器上传。原生微信编辑器入口已由同页起止控件替代。

## 模块结构

- `web/src/core/`：JPEG、MP4、XMP、SEF 分析和封装的唯一源代码。
- `miniprogram/scripts/build-core.cjs`：转译并检查小程序实际使用的 9 个格式模块。
- `miniprogram/src/media/mp4-trim.js`：解析普通 MP4/MOV 样本表，保留解码前置帧，重建时长、偏移、音视频轨道及播放时间线，无重编码。
- `miniprogram/src/media/motion-photo.js`：容量限制、三种输入流程、相对封面时间、落盘回读和字节一致性校验。
- `miniprogram/src/features/video-flow/`：视频与照片模式共享页面逻辑、片段约束和结果操作。
- `miniprogram/src/features/batch-flow/`：逐项转换、失败隔离、暂停与继续。
- `miniprogram/src/platform/`：选择器、图像方向与 JPEG 归一化、取帧诊断、相册和文件输出。

## 验证边界

本轮自动化覆盖真实 H.264/HEVC、B 帧、AAC、MOV、不同起止范围、首帧像素比对、三种封装路径、文件损坏、容量限制、取消、权限拒绝和批量重试。WXML/WXSS、JS、共享核心一致性与 Web 回归均需通过后提交。

开发者工具可验证页面加载、图片选择和非硬件相关流程；不能代替微信真机 VideoDecoder 与三星相册播放。新版本需在用户设备复测同页裁剪的播放起止/封面、照片方向/裁切和批量保存结果。遇到具体素材不支持时记录设备/微信/编码信息及错误，不以结构校验代替设备兼容性结论。

输入限制、操作说明见 [小程序 README](../miniprogram/README.md)。历史基线见 [M0](miniprogram-baseline/M0-CURRENT-RUN.md)、[M2](miniprogram-baseline/M2-IMPLEMENTATION.md)、[M3](miniprogram-baseline/M3-IMPLEMENTATION.md)，本轮记录见 [M4/M5](miniprogram-baseline/M4-M5-IMPLEMENTATION.md)。
