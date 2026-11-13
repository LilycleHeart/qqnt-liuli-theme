'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.resolve(root, '../../output/playwright/background-performance-20261113'));
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'renderer/background-performance.js'), 'utf8');
const gif = Buffer.from('R0lGODlhCAAIAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBDAABACwAAAAACAAIAIEAAP8AAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7', 'base64');
const fixture = `<!doctype html><style>body{margin:0;background:#444}#app{width:500px}.chat-msg-area{display:flex;gap:10px}.pic-element,.market-face-element{width:80px;height:80px}img{display:block;width:80px;height:80px;object-fit:contain}video{width:50px;height:50px}</style><body><div id="app"><div class="chat-msg-area"><div class="message"><div class="market-face-element" id="gif"><img src="http://fixture.test/animated.gif"></div></div><div class="message"><div class="pic-element" id="native"><img data-native-gif="true" src="http://fixture.test/thumb.png"></div></div><div class="message"><div class="pic-element" id="static"><img src="http://fixture.test/static.png"></div></div></div><div contenteditable="true" id="draft">Unsent <b>draft</b></div></div>`;
async function pixel(page, locator, name) {
  const bytes = await page.locator(locator).screenshot();
  if (name) fs.writeFileSync(path.join(output, name), bytes);
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(20, 20, 1, 1).data];
  }, bytes.toString('base64'));
}
async function colors(page, selector, count = 5) {
  const result = [];
  for (let i = 0; i < count; i++) { result.push(await pixel(page, selector)); await page.waitForTimeout(70); }
  return result;
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'], ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { cases: [], samples: {}, passed: false,
    scope: 'Real animated GIF pixel and native video playback evidence in Chromium; demonstrates stopped presentation, not CPU or decoder measurements.' };
  try {
    for (const name of ['gif-freeze-resume', 'native-record-classification', 'native-face-png', 'new-image-in-background', 'source-replacement', 'detached-image-cleanup', 'video-policy', 'hidden-visibility', 'reinjection']) {
      const page = await browser.newPage({ viewport: { width: 550, height: 300 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let requests = 0;
      await page.route('http://fixture.test/**', async route => {
        requests++;
        if (route.request().url().endsWith('static.png')) await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="green" d="M0 0h8v8H0z"/></svg>' });
        else await route.fulfill({ contentType: 'image/gif', body: gif });
      });
      await page.setContent(fixture);
      await page.evaluate(() => {
        window.testFocused = true; window.testHidden = false;
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => window.testFocused });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden });
        window.focusState = focused => { window.testFocused = focused; window.dispatchEvent(new Event(focused ? 'focus' : 'blur')); };
        window.hiddenState = hidden => { window.testHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
        window.LiuliQQ = { messageRecord: image => ({ elements: [{ picElement: { fileName: image.dataset.nativeGif === 'true' ? 'native-animation.gif' : 'static.png' } }] }) };
        window.originalSources = [...document.images].map(image => image.getAttribute('src'));
        window.originalDraft = document.querySelector('#draft').innerHTML;
        window.originalRect = document.querySelector('.chat-msg-area').getBoundingClientRect().toJSON();
      });
      await page.addScriptTag({ content: source });
      await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
      if (name === 'video-policy') {
        await page.evaluate(async () => {
          const streamCanvas = document.createElement('canvas'); streamCanvas.width = streamCanvas.height = 8;
          streamCanvas.getContext('2d').fillRect(0, 0, 8, 8);
          window.testStream = streamCanvas.captureStream(15);
          for (const [id, muted, autoplay] of [['automatic', true, true], ['audible', false, false], ['user-muted', true, true]]) {
            const video = document.createElement('video'); video.id = id; video.muted = muted; video.autoplay = autoplay;
            video.srcObject = window.testStream; document.querySelector('#app').append(video); await video.play();
          }
          document.querySelector('#user-muted').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        });
      }
      if (name === 'gif-freeze-resume') {
        const foreground = await colors(page, '#gif');
        assert(new Set(foreground.map(color => color.join(','))).size > 1, 'Fixture GIF did not animate before suspension');
        const requestCount = requests;
        await page.evaluate(() => window.focusState(false));
        await page.waitForFunction(() => !!document.querySelector('#gif canvas'));
        const background = await colors(page, '#gif');
        assert.equal(new Set(background.map(color => color.join(','))).size, 1, 'Frozen GIF presentation continued changing');
        assert.equal(await page.locator('#gif img').evaluate(image => getComputedStyle(image).display), 'none');
        assert.equal(await page.locator('#gif canvas').count(), 1);
        assert.deepEqual(await page.locator('.chat-msg-area').evaluate(node => node.getBoundingClientRect().toJSON()), await page.evaluate(() => window.originalRect), 'Static frame changed the native message layout');
        await pixel(page, '#gif', 'gif-background-static.png');
        await page.evaluate(() => window.focusState(true));
        const resumed = await colors(page, '#gif');
        assert(new Set(resumed.map(color => color.join(','))).size > 1, 'GIF did not resume after focus');
        assert.equal(requests, requestCount, 'Freezing fetched the image source again');
        report.samples.gif = { foreground, background, resumed, noSourceReload: true };
      } else {
        await page.evaluate(name => name === 'hidden-visibility' ? window.hiddenState(true) : window.focusState(false), name);
        await page.waitForFunction(() => !!document.querySelector('#gif canvas'));
        if (name === 'native-record-classification') {
          assert.equal(await page.locator('#native canvas').count(), 1, 'Native GIF record with .png thumbnail was missed');
          assert.equal(await page.locator('#static canvas').count(), 0, 'Static picture was frozen');
        } else if (name === 'native-face-png') {
          await page.evaluate(() => {
            const host = document.createElement('span'); host.className = 'face-element'; host.id = 'native-face';
            host.innerHTML = '<img src="http://fixture.test/native-face.png">'; document.querySelector('.chat-msg-area').append(host);
          });
          await page.waitForFunction(() => !!document.querySelector('#native-face canvas'));
          assert.equal(await page.locator('#native-face img').evaluate(image => image.getAttribute('src')), 'http://fixture.test/native-face.png');
          assert.equal(await page.locator('#static canvas').count(), 0, 'Native face coverage also froze an ordinary static picture');
        } else if (name === 'new-image-in-background') {
          await page.evaluate(() => {
            const host = document.createElement('div'); host.className = 'market-face-element'; host.id = 'new';
            host.innerHTML = '<img src="http://fixture.test/new.gif">'; document.querySelector('.chat-msg-area').append(host);
          });
          await page.waitForFunction(() => !!document.querySelector('#new canvas'));
        } else if (name === 'source-replacement') {
          await page.evaluate(() => { const image = document.querySelector('#native img'); image.dataset.nativeGif = 'false'; image.src = 'http://fixture.test/static.png'; });
          await page.waitForFunction(() => !document.querySelector('#native canvas'));
          assert.equal(await page.locator('#native img').evaluate(image => getComputedStyle(image).display), 'block');
        } else if (name === 'detached-image-cleanup') {
          await page.evaluate(() => { window.detachedImage = document.querySelector('#gif img'); document.querySelector('#gif').remove(); });
          await page.waitForFunction(() => window.detachedImage.style.display === '');
          assert.equal(await page.evaluate(() => window.detachedImage.style.display), '');
          assert.equal(await page.evaluate(() => window.__liuliBackgroundPerformance.frozenImages), 1);
        } else if (name === 'video-policy') {
          const paused = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('video')].map(video => [video.id, video.paused])));
          assert.deepEqual(paused, { automatic: true, audible: false, 'user-muted': false });
          await page.evaluate(() => window.focusState(true));
          await page.waitForTimeout(40);
          assert.equal(await page.locator('#automatic').evaluate(video => video.paused), false);
          report.samples.video = paused;
        } else if (name === 'hidden-visibility') {
          assert.equal(await page.evaluate(() => window.__liuliBackgroundPerformance.suspended), true);
          await page.evaluate(() => window.hiddenState(false));
          assert.equal(await page.evaluate(() => window.__liuliBackgroundPerformance.suspended), false);
        } else if (name === 'reinjection') {
          await page.addScriptTag({ content: source });
          await page.waitForFunction(() => document.querySelectorAll('[data-liuli-static-frame]').length === 2);
          assert.equal(await page.locator('[data-liuli-static-frame]').count(), 2);
          assert.equal(await page.locator('#liuli-background-performance-style').count(), 1);
        }
      }
      await page.evaluate(() => window.focusState(true));
      await page.waitForTimeout(20);
      assert.equal(await page.locator('[data-liuli-static-frame]').count(), 0);
      assert.equal(await page.locator('#gif img').count() ? await page.locator('#gif img').evaluate(image => image.style.display) : '', '');
      assert.equal(await page.evaluate(() => document.querySelector('#draft').innerHTML === window.originalDraft), true);
      if (!['source-replacement', 'detached-image-cleanup', 'new-image-in-background', 'native-face-png'].includes(name))
        assert.deepEqual(await page.evaluate(() => [...document.images].map(image => image.getAttribute('src'))), await page.evaluate(() => window.originalSources));
      await page.evaluate(() => window.__liuliBackgroundPerformance.dispose());
      assert.equal(await page.locator('#liuli-background-performance-style,body[data-liuli-background-idle]').count(), 0);
      assert.deepEqual(errors, []);
      report.cases.push({ name, passed: true });
      await page.close();
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'background-performance-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
