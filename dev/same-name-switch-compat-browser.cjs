'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || process.env.LIULI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/same-name-switch-20261114'));
const legacy = fs.readFileSync(process.argv[5] || path.join(output, 'before/index.js'), 'utf8');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function helper(name) { const start = legacy.indexOf('  function ' + name + '('), end = legacy.indexOf('\n  }', start); assert(start >= 0 && end > start); return legacy.slice(start, end + 4); }
const controller = `(()=>{const motion=window.LiuliMotion;const LL_EASE='cubic-bezier(0.22, 1, 0.36, 1)';const LL_ENTER_MAX=14;let llSwitchInstalled=false;${helper('llAnimateEnter')}\n${legacy.slice(legacy.indexOf('  function installSwitchMotion('), legacy.indexOf('  function installPageObserver('))}\ninstallSwitchMotion();})();`;
const adapter = require('./patch-same-name-switch-live.cjs')();
const fixture = `<style>body{margin:20px;font:14px sans-serif}.recent-contact-item{width:180px;height:60px}.aio{position:absolute;left:220px;top:20px;width:600px}.chat-header{height:40px}.chat-msg-area{height:360px;overflow:auto}.ml-item{height:54px}.message{height:54px}.panel-header__title{height:24px}</style><div class="recent-contact-item recent-contact-item--selected" data-contact-id="A" data-type="1"><span class="contact-name__text">同名联系人</span></div><div class="recent-contact-item" data-contact-id="B" data-type="1"><span class="contact-name__text">同名联系人</span></div><div class="aio"><div class="chat-header"><div class="panel-header__title">同名联系人</div></div><div class="chat-msg-area"></div></div>`;
async function initialize(page) {
  await page.setContent(fixture);
  await page.evaluate(() => {
    window.records = [];
    window.nativeEvents = 0;
    window.LiuliQQ = { contactType: item => Number(item?.dataset.type), messageRecord: message => message?.closest('.message')?.record };
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) { window.records.push({ target: this.className, at: performance.now(), frames, options }); return original.call(this, frames, options); };
    window.send = id => { const item = document.querySelector('[data-contact-id="' + id + '"]'); item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: item.getBoundingClientRect().top + 32 })); };
    for (const item of document.querySelectorAll('.recent-contact-item')) item.addEventListener('pointerdown', () => window.nativeEvents++);
    window.select = id => { for (const item of document.querySelectorAll('.recent-contact-item')) item.classList.toggle('recent-contact-item--selected', item.dataset.contactId === id); };
    window.messages = (peer, replace = false, cached = false) => {
      let area = document.querySelector('.chat-msg-area');
      if (replace) { const next = area.cloneNode(false); area.replaceWith(next); area = next; }
      let item = cached && area.querySelector('.ml-item');
      if (!item) { item = document.createElement('div'); item.className = 'ml-item'; item.innerHTML = '<div class="message"><div class="message-content__wrapper">Message</div></div>'; area.replaceChildren(item); }
      if (!window.recordOnly) item.id = peer === 'A' ? '100' : '200';
      item.querySelector('.message').record = { chatType: 1, peerUid: peer, msgId: item.id, msgTime: 1000 };
      if (!window.recordOnly) item.querySelector('.message-content__wrapper').textContent = peer + ' message';
    };
    window.messages('A');
  });
  await page.addStyleTag({ content: read('assets/motion.css') });
  await page.addScriptTag({ content: read('renderer/motion.js') });
  await page.addScriptTag({ content: controller });
  await page.addScriptTag({ content: read('renderer/switch-motion-guard.js') });
  await page.addScriptTag({ content: adapter });
}
const inspect = () => ({ entries: window.records.filter(row => row.options?.duration === 220 && row.options?.fill === 'backwards'),
  marker: document.querySelector('.chat-msg-area').hasAttribute('data-ll-switching'), nativeEvents: window.nativeEvents,
  guarded: [...document.querySelectorAll('.chat-msg-area,.panel-header__title')].some(el => Object.hasOwn(el, 'animate') || Object.hasOwn(el, 'setAttribute')),
  compatibility: window.__liuliSameNameSwitchCompatibility ? { revealed: window.__liuliSameNameSwitchCompatibility.revealed, blockedMarkers: window.__liuliSameNameSwitchCompatibility.blockedMarkers, blockedFallbacks: window.__liuliSameNameSwitchCompatibility.blockedFallbacks } : null });
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const report = { scope: 'Original unowned switch closure plus generated compatibility in isolated Chromium; no QQ or settings writes', cases: [], errors: [] };
  try {
    for (const name of ['new-message-dom', 'cached-message-dom', 'record-only', 'replaced-area', 'rapid-switch']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await initialize(page);
      await page.evaluate(() => { window.send('B'); window.select('B'); });
      await page.waitForTimeout(120);
      assert.equal((await page.evaluate(inspect)).entries.length, 0, name + ': selection revealed old messages');
      await page.evaluate(({ replace, cached, recordOnly }) => { window.recordOnly = recordOnly; window.messages('B', replace, cached); }, { replace: name === 'replaced-area', cached: name === 'cached-message-dom' || name === 'record-only', recordOnly: name === 'record-only' });
      await page.waitForTimeout(300);
      const early = await page.evaluate(inspect);
      assert.equal(early.entries.length, 2, name + ': did not reveal title and message area');
      assert.equal(early.marker, false);
      if (name === 'rapid-switch') {
        await page.evaluate(() => { window.send('A'); window.select('A'); window.messages('A', false, true); });
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(1450);
      const settled = await page.evaluate(inspect);
      assert.equal(settled.entries.length, name === 'rapid-switch' ? 4 : 2, name + ': old timeout replayed entry');
      assert.equal(settled.marker, false); assert.equal(settled.guarded, false, 'Instance methods not restored');
      assert(settled.compatibility.blockedMarkers > 0); assert.equal(settled.compatibility.blockedFallbacks, 2);
      assert.equal(settled.nativeEvents, name === 'rapid-switch' ? 2 : 1, 'Adapter blocked native input events');
      await page.evaluate(() => window.send(document.querySelector('.recent-contact-item--selected').dataset.contactId));
      assert.equal((await page.evaluate(inspect)).entries.length, settled.entries.length, 'Selected item started another entry');
      assert.deepEqual(errors, []);
      report.cases.push({ name, early, settled }); await page.close();
    }
    const page = await browser.newPage(); await initialize(page);
    await page.evaluate(() => { window.send('B'); window.select('B'); window.messages('B'); });
    await page.waitForTimeout(180);
    await page.evaluate(() => window.__liuliSameNameSwitchCompatibility.dispose());
    assert.equal((await page.evaluate(inspect)).guarded, false, 'Disposal retained method descriptors');
    await page.evaluate(() => { window.__liuliSwitchMotion = {}; });
    await page.addScriptTag({ content: adapter });
    assert.equal((await page.evaluate(inspect)).compatibility, null, 'Adapter activated over production owner');
    report.cases.push({ name: 'disposal-and-production-ownership', passed: true }); await page.close();
    report.passed = true;
  } catch (error) { report.errors.push(error.stack); process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'same-name-switch-compat-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases.length, errors: report.errors })); }
})();
