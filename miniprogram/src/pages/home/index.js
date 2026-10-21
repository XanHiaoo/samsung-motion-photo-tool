const app = getApp();
const { getLayoutInsets } = require('../../platform/system-info');

Page({
  data: {
    insets: {},
  },

  onLoad() {
    this.setData({
      insets: app.globalData.layoutInsets || getLayoutInsets(),
    });
  },

  openVideo() {
    wx.navigateTo({ url: '/src/pages/video/index' });
  },
  openBatch() { wx.navigateTo({ url: '/src/pages/embedded/index' }); },
  openManual() { wx.navigateTo({ url: '/src/pages/manual/index' }); },

});
