'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: process.argv[3] || undefined });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main class="chat-msg-area"><div id="text">text</div></main>');
    await page.evaluate(() => {
      window.makeVoice = (id, count) => {
        const bubble = document.createElement('div');
        bubble.id = id;
        bubble.className = 'ptt-message__container';
        bubble.innerHTML = '<div class="ptt-element">' + '<i class="ptt-element__progress-item"></i>'.repeat(count) + '</div>';
        document.querySelector('.chat-msg-area').append(bubble);
      };
      makeVoice('voice-a', 20);
      makeVoice('voice-b', 30);
      window.voiceScans = { full: 0, wave: [] };
      const documentQuery = document.querySelectorAll;
      document.querySelectorAll = function(selector) {
        if (selector === '.chat-msg-area .ptt-element') voiceScans.full++;
        return documentQuery.call(this, selector);
      };
      const elementQuery = Element.prototype.querySelectorAll;
      Element.prototype.querySelectorAll = function(selector) {
        if (selector === '.ptt-element__progress-item') voiceScans.wave.push(this.parentElement.id);
        return elementQuery.call(this, selector);
      };
    });
    await page.addScriptTag({ path: path.join(__dirname, '../renderer/voice-layout.js') });
    const width = id => page.locator('#' + id).evaluate(el => el.style.getPropertyValue('--ll-voice-wave-width'));
    assert.equal(await width('voice-a'), '78px');
    assert.equal(await width('voice-b'), '118px');
    await page.evaluate(() => {
      voiceScans.full = 0;
      voiceScans.wave.length = 0;
      const text = document.querySelector('#text');
      text.insertAdjacentHTML('beforeend', '<b>new text</b>');
      window.__liuliVoiceLayout.refresh([text]);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => voiceScans), { full: 0, wave: [] });
    await page.evaluate(() => document.querySelector('#voice-a .ptt-element').lastElementChild.remove());
    await page.waitForFunction(() => document.querySelector('#voice-a').style.getPropertyValue('--ll-voice-wave-width') === '74px');
    await page.evaluate(() => makeVoice('voice-c', 24));
    await page.waitForFunction(() => document.querySelector('#voice-c').style.getPropertyValue('--ll-voice-wave-width') === '94px');
    assert.deepEqual(await page.evaluate(() => voiceScans), { full: 0, wave: ['voice-a', 'voice-c'] });
    assert.deepEqual(errors, []);
    console.log('PASS: text skips voice scans; only changed voice waveforms update');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
