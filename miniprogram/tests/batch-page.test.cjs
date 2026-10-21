const test=require('node:test');
const assert=require('node:assert/strict');
test('batch page converts mixed inputs, retries only the failure, saves results and releases all owned files',async t=>{
  t.after(()=>{delete global.wx;delete global.getApp;delete global.Page;delete require.cache[require.resolve('../src/pages/embedded/index')];});
  const jpeg=Uint8Array.from([255,216,255,224,0,4,74,70,255,218,0,2,255,217]);
  const mp4=Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
  const embedded=Uint8Array.from([...jpeg,...mp4]);
  const files=new Map([['/good.jpg',embedded],['/bad.jpg',jpeg]]);
  const io={
    stat(o){const data=files.get(o.path);if(data)o.success({stats:{size:data.length}});else o.fail(new Error('missing'));},
    readFile(o){o.success({data:files.get(o.filePath)});},
    writeFile(o){files.set(o.filePath,new Uint8Array(o.data));o.success({});},
    unlink(o){files.delete(o.filePath);if(o.success)o.success({});},
  };
  global.wx={env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>io};
  global.getApp=()=>({globalData:{layoutInsets:{}}});let definition;
  global.Page=d=>{definition=d;};require('../src/pages/embedded/index');
  const page={...definition,data:{...definition.data,items:[]},setData(update){Object.assign(this.data,update);}};
  page.onLoad();
  await page.addFiles(async()=>[{path:'/good.jpg',name:'good.jpg',sizeBytes:embedded.length},
    {path:'/good.jpg',name:'duplicate.jpg',sizeBytes:embedded.length},{path:'/bad.jpg',name:'bad.jpg',sizeBytes:jpeg.length}]);
  assert.equal(page.data.items.length,2);
  await page.onConvert();
  assert.deepEqual(page.data.items.map(i=>i.status),['success','error']);
  assert.equal(page.data.working,false);
  const preserved=page.data.items[0].output.path;
  files.set('/bad.jpg',embedded);
  await page.retryItem({currentTarget:{dataset:{id:page.data.items[1].id}}});
  assert.equal(page.data.succeeded,2);
  assert.equal(page.data.items[0].output.path,preserved);
  let calls=0;
  global.wx.saveImageToPhotosAlbum=o=>{calls++;o.fail({errMsg:'auth deny'});};
  await page.saveAll();
  assert.equal(calls,1);assert.equal(page.data.permissionDenied,true);assert.equal(page.data.saving,false);
  assert.ok(page.data.items.every(i=>!i.saved));
  global.wx.saveImageToPhotosAlbum=o=>o.success({});
  await page.saveAll();
  assert.ok(page.data.items.every(i=>i.saved));assert.equal(page.data.permissionDenied,false);
  page.onUnload();assert.equal(files.size,0);
});
