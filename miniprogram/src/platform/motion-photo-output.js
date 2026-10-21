function saveToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx.saveImageToPhotosAlbum !== 'function') {
      reject(new Error('当前微信版本不支持保存到相册，请更新微信。'));
      return;
    }
    wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject });
  });
}

function choosePhotoForVerification() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success(result) {
        const file = result.tempFiles && result.tempFiles[0];
        if (file && file.tempFilePath) resolve(file.tempFilePath);
        else reject(new Error('没有读取到照片，请重新选择。'));
      },
      fail: reject,
    });
  });
}

module.exports = { saveToAlbum, choosePhotoForVerification };
