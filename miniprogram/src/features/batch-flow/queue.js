async function convertQueue(items, convert, options = {}) {
  const result = items.map(item => Object.assign({}, item));
  const update = () => { if (options.onUpdate) options.onUpdate(result.map(item => Object.assign({}, item))); };
  for (const item of result) {
    if (options.shouldCancel && options.shouldCancel()) break;
    if (item.status !== 'pending') continue;
    item.status = 'working'; item.error = ''; update();
    try {
      item.output = await convert(item);
      item.status = 'success';
    } catch (error) {
      if (error && error.code === 'MOTION_PHOTO_CANCELED') {
        item.status = 'pending'; update(); break;
      }
      item.status = 'error';
      const raw = error && (error.errMsg || error.message);
      item.error = raw && !/fail|wxfile:|[A-Z]:\\/i.test(raw) ? String(raw).slice(0, 180)
        : '无法转换此文件。请使用包含内嵌视频的原始动态照片，或通过“从聊天文件选择”重新导入。';
    }
    update();
  }
  return result;
}
module.exports = { convertQueue };
