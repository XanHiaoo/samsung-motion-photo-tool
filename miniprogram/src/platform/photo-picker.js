function choosePhotos(count = 1) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({ count, mediaType: ['image'], sourceType: ['album'], sizeType: ['original'],
      success(result) {
        const files = (result.tempFiles || []).filter(f => f.tempFilePath).map((f, i) => ({
          path: f.tempFilePath, name: f.name || `照片_${i + 1}.jpg`, sizeBytes: Number(f.size) || 0,
        }));
        if (!files.length) reject(new Error('没有读取到图片，请重新选择。'));
        else resolve(files);
      }, fail: reject });
  });
}

function choosePhotoFiles(count = 9) {
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMessageFile !== 'function') { reject(new Error('当前微信不支持选择文件，请更新微信。')); return; }
    wx.chooseMessageFile({ count, type: 'file', extension: ['jpg', 'jpeg', 'heic', 'heif'],
      success(result) {
        const files = (result.tempFiles || []).filter(f => f.path).map(f => ({ path: f.path, name: f.name || '动态图.jpg', sizeBytes: f.size || 0 }));
        if (!files.length) reject(new Error('没有读取到文件。')); else resolve(files);
      }, fail: reject });
  });
}

module.exports = { choosePhotos, choosePhotoFiles };
