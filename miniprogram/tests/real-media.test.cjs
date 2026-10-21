const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trimMp4 } = require('../src/media/mp4-trim');
const { generateMotionPhoto, convertEmbeddedMotionPhoto } = require('../src/media/motion-photo');
const { analyzeBytes } = require('../src/core/analyze');
const { parseDuration } = require('../src/core/mp4');

test('real H.264/AAC/B-frame and HEVC clips decode, start at the selected frame, and survive all three conversion paths',
  { skip: !process.env.FFMPEG_EXE }, async (t) => {
    const ffmpeg = process.env.FFMPEG_EXE;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniprogram-real-media-'));
    t.after(() => {
      delete global.wx;
      // Only remove files produced in this test's uniquely allocated directory.
      for (const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root, name));
      fs.rmdirSync(root);
    });
    const run = args => execFileSync(ffmpeg, ['-v', 'error', '-nostdin', ...args], { maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const file = name => path.join(root, name);
    const io = {
      stat(o) { try { o.success({stats:fs.statSync(o.path)}); } catch(e) {o.fail(e);} },
      readFile(o) { try {o.success({data:fs.readFileSync(o.filePath)});} catch(e) {o.fail(e);} },
      writeFile(o) { try {fs.writeFileSync(o.filePath,Buffer.from(o.data));o.success({});} catch(e) {o.fail(e);} },
      unlink(o) { try {fs.unlinkSync(o.filePath);if(o.success)o.success({});} catch(e) {if(o.fail)o.fail(e);} },
    };
    global.wx = { env:{USER_DATA_PATH:root},getFileSystemManager:()=>io };
    for (const codec of ['libx264', 'libx265']) {
      const source = file(`${codec}.mp4`);
      run(['-f','lavfi','-i','testsrc2=size=160x120:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
        '-t','4','-c:v',codec,'-g','24','-bf','3','-pix_fmt','yuv420p',...(codec==='libx265'?['-x265-params','log-level=error:pools=1:frame-threads=1']:[]),'-c:a','aac','-y',source]);
      const input = new Uint8Array(fs.readFileSync(source));
      for (const [start,end] of [[0,1.5],[1.25,3.5],[2.9,4]]) {
        const result = trimMp4(input,start,end);
        const clip = file('clip.mp4'); fs.writeFileSync(clip,result.bytes);
        assert.ok(result.bytes.length < input.length);
        assert.ok(Math.abs(parseDuration(result.bytes,0,result.bytes.length)-(end-start))<0.002);
        run(['-xerror','-i',clip,'-f','null','-']);
        const image = (inputFile, seek) => run([...(seek===undefined?[]:['-ss',String(seek)]),'-i',inputFile,'-map','0:v:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
        assert.deepEqual(image(clip),image(source,start));
      }
      const cover = file('cover.jpg');
      run(['-ss','1.75','-i',source,'-frames:v','1','-y',cover]);
      const output = await generateMotionPhoto({videoPath:source,coverPath:cover,coverTimeSeconds:1.75,
        clipStartSeconds:1.25,clipEndSeconds:3.5,durationSeconds:4});
      const analysis = analyzeBytes(new Uint8Array(fs.readFileSync(output.path)),output.name);
      assert.equal(analysis.validation.isSamsungCompatible,true);
      assert.equal(analysis.presentationTimestampUs,500000);
      assert.equal(analysis.durationSeconds,2.25);
      const batch = await convertEmbeddedMotionPhoto({path:output.path,name:'reimport.jpg'});
      const checked = analyzeBytes(new Uint8Array(fs.readFileSync(batch.path)),batch.name);
      assert.equal(checked.validation.isSamsungCompatible,true);
      assert.equal(checked.presentationTimestampUs,500000);
      const mov = file('input.mov'); run(['-i',source,'-c','copy','-y',mov]);
      const remuxed = await generateMotionPhoto({videoPath:mov,coverPath:cover,coverTimeSeconds:1.75,
        clipStartSeconds:0,clipEndSeconds:4,durationSeconds:4});
      const remuxBytes = new Uint8Array(fs.readFileSync(remuxed.path));
      const movAnalysis = analyzeBytes(remuxBytes,remuxed.name);
      assert.equal(movAnalysis.videoFormat,'MP4');
      const extracted = file('extracted.mp4');
      fs.writeFileSync(extracted,remuxBytes.subarray(movAnalysis.videoStart,movAnalysis.videoStart+movAnalysis.videoSize));
      run(['-xerror','-i',extracted,'-f','null','-']);
    }
  });
