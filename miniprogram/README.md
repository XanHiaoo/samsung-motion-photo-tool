# 微信小程序

基于主分支 v1.0.1（`d4863e1`），提供三种本机处理方式：视频生成、批量转换、照片 + 视频。不上传媒体，不依赖浏览器 FFmpeg WASM。

## 打开工程

在微信开发者工具中导入仓库根目录，使用根目录 `project.config.json` 配置的 AppID。预览需有该 AppID 的开发权限。格式核心生成文件已随源码保留，无须先构建 Web。

## 三种模式

### 视频生成

选择视频后，在同一页拖动起点、终点和封面滑块，点“播放所选片段”检查，再生成和保存。不需要打开微信剪辑器。片段变化后旧结果会失效，封面自动限制在片段内。

快速裁剪保留原编码与音频，输出仅包含片段需要的帧；为保证从非关键帧位置开始播放，可能保留少量前置解码帧，通过 MP4 编辑时间线控制播放范围。XMP 封面时刻使用相对片段起点的时间。MP4 和 MOV 的普通 H.264 / HEVC、AAC 轨道可直接处理；MOV 会重新封装为 MP4。分片 MP4、变速/多段编辑或不支持的轨道会给出错误，不会悄悄改为整段输出。

### 照片 + 视频

选择封面照片和视频，复用同页片段控件。JPEG 默认保留原图；PNG 等图片通过本机画布转为 JPEG，透明区域铺白。可开启“按视频比例居中裁切封面”。此模式直接使用照片，无须逐帧解码视频，适合设备能播放但无法提取封面的素材。

### 批量转换

从相册选原图，或从聊天文件选原始 JPG/JPEG/HEIC/HEIF，一次最多 9 个。仅支持照片内包含 MP4/MOV 的动态照片；普通静态照片会显示失败。逐个转换以控制内存，支持暂停继续、失败重试、移除、单个/全部保存和原文件导出。单项失败不影响其他结果，重复转换会保留已成功项。

若相册选择器丢失了附加视频，请把原始动态照片作为文件发送后，改用“从聊天文件选择”。HEIC 能否解码取决于微信和设备能力，失败时会提示换用 JPEG/PNG；没有宣称所有 HEIC 机型均兼容。

## 输出和限制

- 输入上限 60 MiB，输出片段视频上限 20 MiB，封面 JPEG 上限 8 MiB，取帧/画布上限 1000 万像素。
- `_MP.jpg` 包含 JPEG、Motion Photo XMP、MP4 和 Samsung SEF；写盘后重新读取并检查结构、视频字节和封面时间。
- 可保存到相册或导出原文件。相册调用成功不能证明附加视频被保留；视频/照片模式可用“从相册校验”回读，与本次输出对照。
- 微信内图片预览显示静态封面，动态播放需在三星相册确认。页面离开后清理本次临时文件，请先保存或导出。
- 用户已反馈原有视频生成功能在真机部分格式可用。本次同页裁剪和两个新模块仍需在目标 Android/iOS 微信及三星相册回归；HEVC 文件封装测试通过不代表设备解码能力已扩大。

## 开发和验证

`src/core/` 从 `web/src/core/` 的字节处理依赖转译而来，不要手工修改。更新共享格式源代码后运行：

```powershell
npm.cmd --prefix web ci
node miniprogram/scripts/build-core.cjs
node miniprogram/scripts/build-core.cjs --check
node --test miniprogram/tests/*.test.cjs
npm.cmd --prefix web test
npm.cmd --prefix web run build
```

真实媒体回归需提供已有 FFmpeg 命令路径，运行时生成 H.264/HEVC/AAC/MOV 样本，不下载素材：

```powershell
$env:FFMPEG_EXE = 'C:\path\to\ffmpeg.exe'
node --test miniprogram/tests/*.test.cjs
```

未配置 FFmpeg 时仅跳过真实媒体用例，其余测试仍执行。完整验证记录见 [M4/M5](../docs/miniprogram-baseline/M4-M5-IMPLEMENTATION.md)，当前方案见 [开发方案](../docs/WECHAT_MINIPROGRAM_PLAN.md)。
