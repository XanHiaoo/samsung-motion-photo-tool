const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeImage } = require('../src/platform/image-normalize');
const { choosePhotos, choosePhotoFiles } = require('../src/platform/photo-picker');

test('JPEG cover preserves original bytes without canvas reencoding', async (t) => {
  t.after(() => delete global.wx);
  global.wx = { getImageInfo: o => o.success({ type:'jpeg',width:640,height:480 }) };
  assert.deepEqual(await normalizeImage('/photo.jpg'), { path:'/photo.jpg',width:640,height:480,temporary:false });
});

test('PNG cover is flattened on white, rotated and cropped to the video size', async (t) => {
  t.after(() => delete global.wx);
  const records = [];
  const context = { clearRect(){}, save(){}, translate(){}, rotate(n){ records.push(['rotate',n]); }, scale(){}, restore(){},
    fillRect(...v){ records.push(['fill',...v]); }, drawImage(...v){ records.push(['draw',...v.slice(1)]); } };
  const source = { getContext:()=>context, createImage() { const image={}; Object.defineProperty(image,'src',{set(){image.onload();}}); return image; } };
  const output = { getContext:()=>context };
  global.wx = { getImageInfo:o=>o.success({type:'png',width:100,height:200,orientation:'right'}), canvasToTempFilePath(o){
    assert.equal(o.fileType,'jpg'); assert.equal(o.destWidth,160); assert.equal(o.destHeight,90); o.success({tempFilePath:'/normalized.jpg'});
  } };
  const result = await normalizeImage('/photo.png',source,output,{width:160,height:90});
  assert.equal(result.path,'/normalized.jpg');
  assert.ok(records.some(r=>r[0]==='rotate' && r[1]===Math.PI/2));
  assert.ok(records.some(r=>r[0]==='fill'));
  assert.equal(source.width,1); assert.equal(output.width,1);
});

test('photo and original file pickers retain the selected local paths and names', async (t) => {
  t.after(() => delete global.wx);
  global.wx = { chooseMedia(o){ assert.deepEqual(o.sizeType,['original']); o.success({tempFiles:[{tempFilePath:'/photo.jpg',size:100}]}); },
    chooseMessageFile(o){ assert.equal(o.type,'file'); o.success({tempFiles:[{path:'/source.heic',name:'motion.heic',size:200}]}); } };
  assert.equal((await choosePhotos())[0].path,'/photo.jpg');
  assert.equal((await choosePhotoFiles())[0].name,'motion.heic');
});

test('photo plus video uses the selected photo without decoding a video frame and clears stale output on range change', async (t) => {
  t.after(() => { delete global.wx; delete global.getApp; });
  global.getApp=()=>({globalData:{}});
  const { createVideoPage } = require('../src/features/video-flow/page');
  const definition=createVideoPage({manual:true}); const removed=[];
  global.wx={getFileSystemManager:()=>({unlink:o=>removed.push(o.filePath)}),createVideoDecoder(){throw new Error('must not decode');}};
  const page={...definition,data:{...definition.data,photo:{path:'/photo.jpg'},video:{path:'/video.mp4',durationSeconds:8},videoInfo:{},
    flow:{coverTimeSeconds:0,outputPath:'/old.jpg'},clipEndSeconds:8},setData(update){Object.assign(this.data,update);}};
  await page.applyClipRange(1.25,3.5);
  assert.equal(page.data.coverFrameInfo.path,'/photo.jpg');
  assert.equal(page.data.coverFrameInfo.requestedSeconds,1.25);
  assert.equal(page.data.clipEndSeconds,3.5);
  assert.equal(page.data.showMotionResult,false);
  assert.ok(removed.includes('/old.jpg'));
});
