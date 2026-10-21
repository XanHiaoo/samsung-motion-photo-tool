const test = require('node:test');
const assert = require('node:assert/strict');
const { videoFixture } = require('./mp4-fixture.cjs');
const { analyzeBytes } = require('../src/core/analyze');

function pageFixture(t, manual = false) {
  const original = {wx:global.wx,getApp:global.getApp};
  global.getApp = () => ({globalData:{}});
  const factoryPath = require.resolve('../src/features/video-flow/page');
  delete require.cache[factoryPath];
  const definition = require(factoryPath).createVideoPage({manual});
  const jpeg = Uint8Array.from([255,216,255,224,0,4,74,70,255,218,0,2,255,217]);
  const files = new Map([['/source.mp4',videoFixture()],['/cover.jpg',jpeg]]);
  const record = { seek:[], starts:0, decoderSeeks:[], exports:0 };
  const io = { unlink(o){files.delete(o.filePath);if(o.success)o.success({});},
    stat(o){const b=files.get(o.path);if(b)o.success({stats:{size:b.length}});else o.fail(new Error('missing'));},
    readFile(o){o.success({data:files.get(o.filePath)});},
    writeFile(o){files.set(o.filePath,new Uint8Array(o.data));o.success({});} };
  global.wx = { env:{USER_DATA_PATH:'/user'}, getFileSystemManager:()=>io,
    createVideoDecoder:()=>({ async start(){record.starts++;return{};},async seek(n){record.decoderSeeks.push(n);},
      getFrameData:()=>({width:1,height:1,data:new Uint8Array(4)}),async stop(){},async remove(){} }),
    canvasToTempFilePath(o){record.exports++;files.set('/cover.jpg',jpeg);o.success({tempFilePath:'/cover.jpg'});} };
  const context = { createImageData:()=>({data:new Uint8Array(4)}),putImageData(){},clearRect(){},save(){},translate(){},rotate(){},scale(){},drawImage(){},restore(){} };
  const canvas = {getContext:()=>context};
  const page = { ...definition, data:{...definition.data,flow:{...definition.data.flow,coverTimeSeconds:1},
    video:{path:'/source.mp4',durationSeconds:8},videoInfo:{orientation:'up'},clipStartSeconds:1,clipEndSeconds:7,sliderMaxSeconds:6.95},
    setData(value,fn){Object.assign(this.data,value);if(fn)fn();},videoReady:true,frameRequestId:0,importRequestId:0,
    sourceCanvas:{...canvas},outputCanvas:{...canvas},videoContext:{seek:n=>record.seek.push(n),pause(){}},
  };
  t.after(()=>{page.cancelPreviewSeek();Object.assign(global,original);delete require.cache[factoryPath];});
  return {page,files,record};
}
const changed = value => ({detail:{value}});
const wait = () => new Promise(resolve=>setTimeout(resolve,85));

test('rapid cover scrubbing coalesces preview seeks and never invokes decoding or JPEG export',async t=>{
  const {page,record}=pageFixture(t);
  for(let n=20;n<=100;n++)page.onCoverChanging(changed(n/20));
  assert.equal(page.data.coverTimeLabel,'00:05.0');
  assert.equal(page.data.capturingCover,false);
  assert.equal(page.data.coverDragging,true);
  assert.equal(record.starts,0);assert.equal(record.exports,0);assert.equal(record.seek.length,0);
  await wait();
  assert.deepEqual(record.seek,[5]);
  page.onCoverChange(changed(5.5));
  assert.deepEqual(record.seek,[5,5.5]);
  assert.equal(page.data.coverDragging,false);
  assert.equal(record.starts,0);assert.equal(record.exports,0);
});

test('moving a cover invalidates old output and JPEG immediately; final selection is captured only once on generate',async t=>{
  const {page,files,record}=pageFixture(t);
  files.set('/stale.jpg',new Uint8Array(1));files.set('/old-output.jpg',new Uint8Array(1));
  Object.assign(page.data,{coverPreviewPath:'/stale.jpg',coverFrameInfo:{path:'/stale.jpg',requestedSeconds:1},showMotionResult:true});
  page.data.flow.outputPath='/old-output.jpg';
  page.onCoverChange(changed(5.5));
  assert.equal(files.has('/old-output.jpg'),false);assert.equal(files.has('/stale.jpg'),false);
  assert.equal(page.data.coverFrameInfo,null);assert.equal(record.starts,0);
  const generation=page.onGenerateMotionPhoto();
  await page.onGenerateMotionPhoto(); await generation;
  assert.equal(record.starts,1);assert.equal(record.exports,1);assert.deepEqual(record.decoderSeeks,[5500]);
  assert.equal(page.data.showMotionResult,true);
  assert.equal(analyzeBytes(files.get(page.data.flow.outputPath),'output.jpg').presentationTimestampUs,4500000);
  page.clearMotionOutput();await page.onGenerateMotionPhoto();
  assert.equal(record.starts,1);assert.equal(record.exports,1);
});

test('range dragging clamps the cover and previews both endpoints without extracting frames',async t=>{
  const {page,record}=pageFixture(t);
  page.onClipChanging({detail:{start:2,end:6,edge:'end'}});
  assert.equal(page.data.rangeDragging,true);assert.equal(page.data.flow.coverTimeSeconds,2);
  await wait();assert.ok(record.seek[0]>5.9 && record.seek[0]<6);
  page.onClipChange({detail:{start:2,end:6,edge:'end'}});
  assert.equal(page.data.rangeDragging,false);assert.equal(record.seek.at(-1),2);
  assert.equal(record.starts,0);assert.equal(page.data.capturingCover,false);
});

test('photo mode updates the timestamp while preserving its chosen photo and avoiding the video decoder',async t=>{
  const {page,record}=pageFixture(t,true);
  page.data.photo={path:'/cover.jpg'};
  page.onCoverChange(changed(3.25));
  assert.equal(page.data.coverFrameInfo.path,'/cover.jpg');
  assert.equal(page.data.coverFrameInfo.requestedSeconds,3.25);
  assert.equal(record.starts,0);
  await page.onGenerateMotionPhoto();assert.equal(page.data.showMotionResult,true);assert.equal(record.starts,0);
});

test('failed capture releases loading state and leaves the slider usable for another selection',async t=>{
  const {page,record}=pageFixture(t);
  const previous=console.error;t.after(()=>{console.error=previous;});console.error=()=>{};
  global.wx.createVideoDecoder=()=>({async start(){record.starts++;throw new Error('playerStart failed');},async remove(){}});
  page.onCoverChange(changed(3));await page.onGenerateMotionPhoto();
  assert.equal(page.data.capturingCover,false);assert.equal(page.data.outputBusy,false);assert.ok(page.data.coverError);
  page.onCoverChange(changed(4));
  assert.equal(page.data.flow.coverTimeSeconds,4);assert.equal(page.data.coverError,'');assert.equal(record.starts,1);
});

test('pending preview seeks cannot run after hide, unload or source replacement',async t=>{
  const {page,record}=pageFixture(t);
  page.onCoverChanging(changed(3));page.onHide();await wait();assert.equal(record.seek.length,0);
  page.onCoverChanging(changed(4));page.data.video={...page.data.video,path:'/different.mp4'};await wait();assert.equal(record.seek.length,0);
  page.onCoverChanging(changed(5));page.onUnload();await wait();assert.equal(record.seek.length,0);
});

for (const metadataFirst of [true, false]) {
  test(`import does not extract a cover and preserves seeks when metadata arrives ${metadataFirst ? 'before' : 'after'} rendering callback`,async t=>{
    const {page,record}=pageFixture(t);
    global.wx.getVideoInfo=o=>o.success({width:320,height:240,duration:8});
    global.wx.createVideoContext=()=>({seek:n=>record.seek.push(n),pause(){}});
    const setData=page.setData;
    let rendered;
    page.setData=function(value,callback){
      setData.call(this,value);
      if (callback) {
        if(metadataFirst)this.onVideoLoadedMetadata();
        rendered=callback;
      }
    };
    await page.importVideo(async()=>({path:'/source.mp4',durationSeconds:8,width:320,height:240}));
    assert.equal(record.starts,0);assert.equal(record.exports,0);
    assert.equal(page.data.coverFrameInfo,null);assert.equal(page.data.capturingCover,false);
    page.onCoverChange(changed(3.5));
    rendered();
    if(!metadataFirst)page.onVideoLoadedMetadata();
    assert.equal(page.videoReady,true);
    assert.equal(record.seek.at(-1),3.5);
    assert.equal(record.starts,0);
  });
}
