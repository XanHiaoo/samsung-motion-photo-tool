const { getLayoutInsets } = require('../../platform/system-info');
const { choosePhotos, choosePhotoFiles } = require('../../platform/photo-picker');
const { isVideoPickerCanceled } = require('../../platform/video-picker');
const { convertEmbeddedMotionPhoto } = require('../../media/motion-photo');
const { normalizeImage } = require('../../platform/image-normalize');
const { saveToAlbum } = require('../../platform/motion-photo-output');
const { convertQueue } = require('../../features/batch-flow/queue');

function remove(path) {
  if (!path) return;
  try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_ignored) {}
}
const statuses = { pending: '待转换', working: '正在转换', success: '转换完成', error: '转换失败' };

Page({
  data: { insets: {}, items: [], picking: false, working: false, saving: false, stopRequested: false,
    notice: '', permissionDenied: false, completed: 0, succeeded: 0, progress: 0 },
  onLoad() {
    this.isUnloading = false; this.itemSequence = 0;
    this.setData({ insets: getApp().globalData.layoutInsets || getLayoutInsets() });
  },
  goBack() { wx.navigateBack({ delta: 1 }); },
  chooseAlbum() { return this.addFiles(choosePhotos); },
  chooseFiles() { return this.addFiles(choosePhotoFiles); },
  async addFiles(picker) {
    if (this.data.picking || this.data.working || this.data.saving || this.isUnloading || this.data.items.length >= 9) return;
    this.setData({ picking: true, notice: '' });
    try {
      const files = await picker(9 - this.data.items.length);
      if (this.isUnloading) { files.forEach(f => remove(f.path)); return; }
      const existing = new Set(this.data.items.map(i => i.path));
      const additions = files.filter(f => { if (existing.has(f.path)) return false; existing.add(f.path); return true; }).map(file => Object.assign({}, file, {
        id: String(++this.itemSequence), status: 'pending', error: '', saveError: '', saved: false,
        sizeLabel: `${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
      }));
      this.updateItems(this.data.items.concat(additions));
    } catch (error) {
      if (!this.isUnloading && !isVideoPickerCanceled(error)) this.setData({ notice: '导入失败，请重新选择原始动态照片文件。' });
    } finally { if (!this.isUnloading) this.setData({ picking: false }); }
  },
  updateItems(items) {
    if (this.isUnloading) return;
    const completed = items.filter(i => i.status === 'success' || i.status === 'error').length;
    this.setData({ items: items.map(i => Object.assign({}, i, { statusLabel: statuses[i.status] })), completed,
      succeeded: items.filter(i => i.status === 'success').length, progress: items.length ? Math.round(completed / items.length * 100) : 0 });
  },
  async canvases() {
    if (this.sourceCanvas && this.outputCanvas) return;
    await new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery();
      query.select('#batch-source-canvas').fields({ node: true }); query.select('#batch-output-canvas').fields({ node: true });
      query.exec(result => {
        if (this.isUnloading) { const error = new Error('操作已取消'); error.code = 'MOTION_PHOTO_CANCELED'; reject(error); return; }
        this.sourceCanvas = result && result[0] && result[0].node; this.outputCanvas = result && result[1] && result[1].node;
        if (!this.sourceCanvas || !this.outputCanvas) reject(new Error('图片画布未准备好，请稍后重试。')); else resolve();
      });
    });
  },
  onConvert() {
    if (this.data.working || this.data.saving || this.data.picking || this.isUnloading) return;
    this.updateItems(this.data.items.map(i => i.status === 'error' ? Object.assign({}, i, { status: 'pending' }) : i));
    return this.convertPending();
  },
  async convertPending() {
    if (this.data.working || this.data.saving || this.data.picking || this.isUnloading) return;
    if (!this.data.items.some(i => i.status === 'pending')) return;
    this.stopRequested = false;
    this.setData({ working: true, stopRequested: false, notice: '' });
    try {
      const results = await convertQueue(this.data.items, async item => {
        const output = await convertEmbeddedMotionPhoto({ path: item.path, name: item.name,
          shouldCancel: () => this.isUnloading || this.stopRequested,
          normalizeCover: async path => { await this.canvases(); return normalizeImage(path, this.sourceCanvas, this.outputCanvas); } });
        if (this.isUnloading) remove(output.path);
        return output;
      }, { shouldCancel: () => this.isUnloading || this.stopRequested, onUpdate: items => this.updateItems(items) });
      if (!this.isUnloading) {
        this.updateItems(results);
        this.setData({ notice: this.stopRequested ? '已暂停，可继续转换。' : '处理完成。转换成功的文件可单独保存或全部保存。' });
      }
    } catch (_error) {
      if (!this.isUnloading) this.setData({ notice: '处理失败，可重试未完成的项目。' });
    } finally { if (!this.isUnloading) this.setData({ working: false, stopRequested: false }); }
  },
  stopConversion() { this.stopRequested = true; this.setData({ stopRequested: true }); },
  retryItem(event) {
    if (this.data.working || this.data.saving || this.data.picking || this.isUnloading) return;
    const id = event.currentTarget.dataset.id;
    this.updateItems(this.data.items.map(i => i.id === id && i.status === 'error' ? Object.assign({}, i, { status: 'pending' }) : i));
    return this.convertPending();
  },
  removeItem(event) {
    if (this.data.working || this.data.saving || this.data.picking || this.isUnloading) return;
    const item = this.data.items.find(i => i.id === event.currentTarget.dataset.id);
    if (!item) return;
    remove(item.path); if (item.output) remove(item.output.path);
    this.updateItems(this.data.items.filter(i => i !== item));
  },
  saveItem(event) { return this.saveItems(event.currentTarget.dataset.id); },
  saveAll() { return this.saveItems(); },
  async saveItems(id) {
    if (this.data.working || this.data.picking || this.data.saving || this.isUnloading) return;
    const items = this.data.items.filter(i => i.status === 'success' && (id ? i.id === id : !i.saved));
    if (!items.length) return;
    this.setData({ saving: true, notice: '', permissionDenied: false });
    let saved = 0;
    try {
      for (const item of items) {
        if (this.isUnloading) break;
        try {
          await saveToAlbum(item.output.path); saved += 1;
          this.updateItems(this.data.items.map(i => i.id === item.id ? Object.assign({}, i, { saved: true, saveError: '' }) : i));
        } catch (error) {
          const denied = /auth|permission|denied|授权|权限/i.test(String(error && (error.errMsg || error.message) || ''));
          this.updateItems(this.data.items.map(i => i.id === item.id ? Object.assign({}, i, { saveError: denied ? '相册权限被拒绝，请允许后重试。' : '保存失败，可重试或导出原文件。' }) : i));
          if (denied) { if (!this.isUnloading) this.setData({ permissionDenied: true }); break; }
        }
      }
      if (!this.isUnloading) this.setData({ notice: `本次保存 ${saved} 张。请在三星相册确认动态效果。` });
    } finally { if (!this.isUnloading) this.setData({ saving: false }); }
  },
  openSettings() { if (!this.data.saving && !this.data.working && typeof wx.openSetting === 'function') wx.openSetting({}); },
  exportItem(event) {
    if (this.data.working || this.data.saving || this.data.picking || this.isUnloading) return;
    const item = this.data.items.find(i => i.id === event.currentTarget.dataset.id);
    if (!item || !item.output) return;
    if (typeof wx.shareFileMessage !== 'function') { this.setData({ notice: '当前微信不支持文件导出，请更新微信。' }); return; }
    this.setData({ saving: true });
    try {
      wx.shareFileMessage({ filePath: item.output.path, fileName: item.output.name,
        fail: error => { if (!this.isUnloading && !isVideoPickerCanceled(error)) this.setData({ notice: '文件导出失败，请重试。' }); },
        complete: () => { if (!this.isUnloading) this.setData({ saving: false }); } });
    } catch (_error) { this.setData({ saving: false, notice: '文件导出失败，请重试。' }); }
  },
  onUnload() {
    this.isUnloading = true; this.stopRequested = true;
    this.data.items.forEach(i => { remove(i.path); if (i.output) remove(i.output.path); });
    [this.sourceCanvas, this.outputCanvas].forEach(c => { if (c) { c.width = 1; c.height = 1; } });
  },
});
