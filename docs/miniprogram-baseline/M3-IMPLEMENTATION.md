# 小程序 M3 实现与验证记录

> 以下为 M3 历史记录。当前已实现同页裁剪、照片 + 视频和批量转换，见 [M4/M5 记录](M4-M5-IMPLEMENTATION.md)。

日期：2026-10-21。基于 `origin/main` 的 `d4863e1`（v1.0.1）和开发分支 `181a581`。同步前的未提交改动保存在 `codex-before-main-sync-2026-10-21` stash 中，工作区已恢复并整合这些改动；stash 继续保留作为备份。

## 本次实现

- 移除批量转换、照片加视频空入口，以及无引用图标/样式；更新计划，取消渐变、精确裁剪和浏览器 FFmpeg 移植。
- 接入 `wx.openVideoEditor`，将返回的毫秒时长转成秒；剪辑完成后重新检查容器和元数据，丢弃旧封面及旧输出。取消或导入失败时保留原视频。
- 从 `web/src/core` 转译实际封装/分析依赖，保留唯一格式源代码；改用不依赖 `TextEncoder` 的 UTF-8 编码，生成代码可检查是否过期。
- 封装选定 JPEG 和完整输入视频，写入封面目标时间、Motion Photo XMP 和 Samsung SEF。写盘后回读，检查结构、长度、时间戳和内嵌视频字节。
- 添加相册保存、拒绝授权后的设置入口、原文件导出、相册原图回读校验。结果预览使用封面 JPEG，避免图片预览或重编码被误当成动态播放验收。
- 加入生成/保存/回读互斥，页面卸载取消和异常输出清理；选新封面或新视频会清理失效结果。
- 合并原有诊断和远程的启动超时/路径回退，统一错误阶段字段，修正诊断中的文件大小字段。

## 已执行验证

| 验证 | 结果 |
| --- | --- |
| `node --test miniprogram/tests/*.test.cjs` | 27 项通过 |
| `node miniprogram/scripts/build-core.cjs --check` | 8 个生成模块一致 |
| 所有小程序 JS 的 `node --check` | 通过 |
| 微信开发者工具自带 `wcc.exe` / `wcsc.exe` | 首页、视频页、图标组件及全局样式编译通过 |
| 微信开发者工具 CLI `auto --project … --trust-project` | 成功打开对应 AppID 工程；未上传预览包或发布 |
| `npm.cmd --prefix web test` | 16 项通过；3 项外部素材测试跳过 |
| `npm.cmd --prefix web run build` | TypeScript 检查和 Vite 构建通过；仍有既存大分块提示 |
| 真实文件封装冒烟 | 2 秒 320×240/24fps H.264 MP4 + 1.25 秒处 JPEG，输出 81,905 字节；XMP、SEF、偏移和时间戳校验通过，无格式告警 |
| 内嵌视频验证 | 与输入逐字节一致，提取 MP4 后 FFmpeg 完整解码成功 |

真实文件冒烟使用 Node 文件系统对微信文件 API 的适配，执行实际小程序封装服务。输出和摘要保存在被忽略的 `tmp/` 中（`miniprogram-smoke-result.json`、`miniprogram-extracted.mp4` 等），不加入代码包。

## 尚未验收

- SM-S9180 的 `playerStart failed` 问题仍需真机复测，不能据本地封装测试认定修复。
- 尚无 Android/iOS 微信完成本次“剪辑 → 选帧 → 生成 → 保存 → 回读”的实机记录。
- `saveImageToPhotosAlbum` 成功不等于尾部视频被保留，必须回读并在三星相册确认动态播放。
- 原生剪辑器可能改变编码和画质；不是 Web 的流复制快速裁剪。
- 封面目标时间写入 XMP，解码帧实际 PTS 单位/时间偏差未校准。当前容量上限是实现边界，不是经设备压测确定的兼容上限。

API 参数依据：[微信官方 API 类型定义](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)。核对了编辑器返回时长的毫秒单位、相册本地路径参数及文件分享参数。
