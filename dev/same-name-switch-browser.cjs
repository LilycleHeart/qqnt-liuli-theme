'use strict';
// Real switch controller/guard and WAAPI in an isolated browser. This fixture
// provides native-shaped msgRecord data; it never attaches to or controls QQ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || process.env.LIULI_PLAYWRIGHT_PATH || 'playwright');
const executablePath = process.argv[3] || process.env.LIULI_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/same-name-switch-20261114'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('renderer/index.js');
function helper(name) {
  const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
  assert(start >= 0 && end > start, 'Missing production helper: ' + name);
  return source.slice(start, end + 4);
}
assert(source.includes('  function llMessagePeerKey('), 'Run after the native-peer switch fix is saved.');
const identity = source.slice(source.indexOf('  var llMsgSeen ='), source.indexOf('  function llMotionPass('));
const controller = `(()=>{const motion=window.LiuliMotion,LL_EASE='cubic-bezier(0.22,1,0.36,1)',LL_ENTER_MAX=14;
${helper('llMsgRecordOf')}
${identity}
${helper('llVisibleIn')}
${helper('llAnimateEnter')}
const llRiseIn=()=>{};let llSwitchInstalled=false;
${helper('installSwitchMotion')}
window.testPeer=llMessagePeerKey;window.testChatKey=llChatKey;window.testInstall=installSwitchMotion;installSwitchMotion();})();`;
const fixture = `<!doctype html><meta charset="utf-8"><style>
body{font:14px sans-serif;margin:0}.recent-contact{width:160px}.recent-contact-item{height:36px;padding:8px;box-sizing:border-box}.aio{position:absolute;left:180px;top:0;width:600px}.chat-header{height:40px}.chat-msg-area{height:240px;overflow:hidden}.ml-item{height:48px}.viewport-list__measure{position:absolute;visibility:hidden;pointer-events:none}
${read('assets/motion.css')}</style><body><div id="app"><div class="recent-contact">
<div class="recent-contact-item recent-contact-item--selected" data-contact-id="1:uid-a" data-id="a">同名联系人</div>
<div class="recent-contact-item" data-contact-id="1:uid-b" data-id="b">同名联系人</div>
<div class="recent-contact-item" data-contact-id="2:uid-a" data-id="c">同名联系人</div>
<div class="recent-contact-item" data-contact-id="1:uid-empty" data-id="empty">同名联系人</div>
</div><div class="aio"><div class="chat-header"><div class="panel-header__title">同名联系人</div></div><div class="chat-msg-area"></div></div></div></body>`;
async function setup(page) {
  await page.setContent(fixture);
  await page.evaluate(() => {
    window.events = []; window.clockStart = performance.now(); window.cachedRows = new Map();
    window.nativePeers = { a: { chatType: 1, peerUid: 'uid-a' }, b: { chatType: 1, peerUid: 'uid-b' }, c: { chatType: 2, peerUid: 'uid-a' }, empty: { chatType: 1, peerUid: 'uid-empty' } };
    window.LiuliQQ = { messageRecord(element) { return element?.closest('.message')?.__nativeRecord || null; } };
    const key = record => record ? record.chatType + ':' + record.peerUid : '';
    const areaPeer = area => [...(area?.querySelectorAll('.message') || [])].filter(message => !message.closest('.viewport-list__measure')).map(message => key(message.__nativeRecord)).find(Boolean) || '';
    window.logEvent = (kind, element, extra = {}) => {
      window.events.push({ kind, elapsed: performance.now() - window.clockStart, peer: areaPeer(element?.matches?.('.chat-msg-area') ? element : document.querySelector('.chat-msg-area')), area: element?.__areaId, connected: element?.isConnected, ...extra });
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, timing) {
      const animation = animate.call(this, frames, timing);
      if (this.matches('.chat-msg-area,.panel-header__title')) {
        const list = animation.effect.getKeyframes(), first = Number(list[0]?.opacity), last = Number(list.at(-1)?.opacity);
        const kind = first === 1 && last === 0 ? 'exit' : first === 0 && last === 1 ? 'entry' : 'other';
        window.logEvent(kind, this, { target: this.className, duration: animation.effect.getTiming().duration });
      }
      return animation;
    };
    const finish = Animation.prototype.finish;
    Animation.prototype.finish = function() {
      const element = this.effect?.target, timing = this.effect?.getTiming();
      if (element?.matches('.chat-msg-area') && timing?.duration === 120 && timing.fill === 'forwards') window.logEvent('finish-exit', element);
      return finish.call(this);
    };
    window.select = id => {
      for (const item of document.querySelectorAll('.recent-contact-item')) item.classList.toggle('recent-contact-item--selected', item.dataset.id === id);
    };
    window.press = id => {
      const item = document.querySelector('[data-id="' + id + '"]');
      item.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, clientY: item.getBoundingClientRect().top + 18 }));
      window.logEvent('pressed', document.querySelector('.chat-msg-area'), { destination: id });
    };
    let areaId = 1;
    window.setMessages = (id, { replaceArea = false, cached = false, withMeasure = false } = {}) => {
      let area = document.querySelector('.chat-msg-area');
      if (replaceArea) { const replacement = document.createElement('div'); replacement.className = 'chat-msg-area'; area.replaceWith(replacement); area = replacement; }
      area.__areaId ||= areaId++;
      area.replaceChildren();
      if (withMeasure) {
        const measure = document.createElement('div'); measure.className = 'viewport-list__measure';
        measure.innerHTML = '<div class="ml-item"><div class="message">Measuring another conversation</div></div>';
        measure.querySelector('.message').__nativeRecord = { chatType: 1, peerUid: 'uid-measure', msgId: '999', msgTime: 1000 };
        area.append(measure);
      }
      if (id !== 'empty') {
        let rows = cached && window.cachedRows.get(id);
        if (!rows) rows = Array.from({ length: 3 }, (_, index) => {
          const row = document.createElement('div'); row.className = 'ml-item'; row.id = String(1000 + 'abc'.indexOf(id) * 10 + index);
          row.innerHTML = '<div class="message"><div class="message-container"><div class="message-content__wrapper">' + id + ' message ' + index + '</div></div></div>';
          row.querySelector('.message').__nativeRecord = { ...window.nativePeers[id], msgId: row.id, msgTime: 1000 + index, msgSeq: String(index + 1) };
          return row;
        });
        window.cachedRows.set(id, rows); area.append(...rows);
      }
      window.logEvent('messages', area, { destination: id, cached });
      return new Promise(resolve => requestAnimationFrame(() => {
        const heldExits = area.getAnimations().filter(animation => animation.effect.getTiming().duration === 120 && animation.effect.getTiming().fill === 'forwards');
        window.logEvent('first-paint', area, { opacity: getComputedStyle(area).opacity, switching: area.hasAttribute('data-ll-switching'), heldExits: heldExits.length, pendingExits: heldExits.filter(animation => animation.pending).length }); resolve();
      }));
    };
    window.originalTitle = document.querySelector('.panel-header__title');
    window.setMessages('a', { withMeasure: true });
  });
  await page.addScriptTag({ content: read('renderer/motion.js') });
  await page.addScriptTag({ content: read('renderer/switch-motion-guard.js') });
  await page.addScriptTag({ content: controller });
}
const entries = events => events.filter(event => event.kind === 'entry' && event.target === 'chat-msg-area');
async function waitForEntry(page, peer) {
  await page.waitForFunction(peer => window.events.some(event => event.kind === 'entry' && event.target === 'chat-msg-area' && event.peer === peer), peer, { timeout: 900 });
}
async function visible(page) {
  await page.waitForTimeout(450);
  const result = await page.evaluate(() => { const area = document.querySelector('.chat-msg-area'); return { opacity: getComputedStyle(area).opacity, switching: area.hasAttribute('data-ll-switching'), titleSame: document.querySelector('.panel-header__title') === window.originalTitle }; });
  assert.equal(result.opacity, '1', 'Message content remained hidden');
  assert.equal(result.switching, false, 'Switch flag remained after message entry');
  assert(result.titleSame, 'Test stopped exercising title-node reuse');
  return result;
}
async function switchTo(page, id, options = {}) {
  const offset = await page.evaluate(id => { const offset = window.events.length; window.press(id); window.select(id); return offset; }, id);
  await page.evaluate(({ id, options }) => window.setMessages(id, options), { id, options });
  const expected = { a: '1:uid-a', b: '1:uid-b', c: '2:uid-a' }[id];
  await waitForEntry(page, expected);
  const log = await page.evaluate(offset => window.events.slice(offset), offset);
  const entry = entries(log);
  assert.equal(entry.length, 1, 'Expected exactly one area entry for ' + id);
  assert.equal(entry[0].peer, expected, 'Entered messages belonging to the previous peer');
  const update = log.find(event => event.kind === 'messages');
  assert(entry[0].elapsed - update.elapsed < 800, 'Same-name entry waited for 1500ms fallback');
  const finish = log.findIndex(event => event.kind === 'finish-exit');
  const paint = log.findIndex(event => event.kind === 'first-paint');
  if (!options.replaceArea) assert(finish >= 0 && finish < paint, 'Guard did not finish held exit before the new peer first paint');
  else {
    // A removed area has no rendered exit left to finish. Its replacement must
    // still stay hidden until its entry starts, rather than paint then vanish.
    const firstPaint = log[paint];
    assert(Number(firstPaint.opacity) <= .01 || log.slice(0, paint).some(event => event.kind === 'entry' && event.target === 'chat-msg-area'), 'Replacement area painted before its entry/hold');
    assert.equal(firstPaint.pendingExits, 0, 'Replacement area exit can start after the first paint');
  }
  await visible(page);
  return log;
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath });
  const report = { scope: 'Production identity helpers, switch controller, guard and WAAPI against native-shaped records; no live QQ operations', cases: [], errors: [] };
  const cases = ['cold-selection-first', 'cached-same-title', 'area-replacement', 'mixed-old-peer-middle', 'rapid-switch-and-type-key', 'selected-reclick', 'controller-lifecycle', 'empty-timeout'];
  try {
    for (const name of cases) {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      const errors = []; page.on('pageerror', error => errors.push(error.stack));
      const result = { name };
      try {
        await setup(page);
        assert.equal(await page.evaluate(() => window.testPeer()), '1:uid-a', 'Measuring another peer changed the active identity');
        const originalKey = await page.evaluate(() => window.testChatKey());
        if (name === 'cold-selection-first') {
          await page.evaluate(() => { window.press('b'); window.select('b'); });
          await page.waitForTimeout(120);
          assert.equal((await page.evaluate(() => window.events)).filter(event => event.kind === 'entry').length, 0, 'Selection entered stale old-peer content');
          await page.evaluate(() => window.setMessages('b'));
          await waitForEntry(page, '1:uid-b');
          result.visibility = await visible(page);
          assert.notEqual(await page.evaluate(() => window.testChatKey()), originalKey, 'llChatKey still collides on equal titles');
          const log = await page.evaluate(() => window.events);
          const update = log.findLastIndex(event => event.kind === 'messages'), paint = log.findLastIndex(event => event.kind === 'first-paint');
          assert(log.slice(update, paint).some(event => event.kind === 'finish-exit'), 'Guard skipped native-peer change with unchanged title');
          assert.equal(entries(log).length, 1);
          assert(entries(log)[0].elapsed - log[update].elapsed < 800);
        } else if (name === 'cached-same-title') {
          result.forward = await switchTo(page, 'b');
          result.backward = await switchTo(page, 'a', { cached: true });
          result.cachedNodesReused = await page.evaluate(() => window.cachedRows.get('a').every(row => row.isConnected));
          assert(result.cachedNodesReused);
        } else if (name === 'area-replacement') result.transition = await switchTo(page, 'b', { replaceArea: true });
        else if (name === 'mixed-old-peer-middle') {
          await page.evaluate(() => {
            window.press('b'); window.select('b');
            const painted = window.setMessages('b');
            window.mixedOldRow = window.cachedRows.get('a')[1];
            window.cachedRows.get('b')[1].replaceWith(window.mixedOldRow);
            return painted;
          });
          assert.equal(await page.evaluate(() => window.testPeer()), '', 'A middle old-peer row escaped consistency check');
          await page.waitForTimeout(120);
          assert.equal(entries(await page.evaluate(() => window.events)).length, 0, 'Mixed native peer range entered before old content left');
          await page.evaluate(() => { window.mixedOldRow.replaceWith(window.cachedRows.get('b')[1]); window.logEvent('mixed-cleared', document.querySelector('.chat-msg-area')); });
          await waitForEntry(page, '1:uid-b');
          result.visibility = await visible(page);
          assert.deepEqual(entries(await page.evaluate(() => window.events)).map(event => event.peer), ['1:uid-b']);
        } else if (name === 'rapid-switch-and-type-key') {
          await page.evaluate(() => { window.press('b'); window.select('b'); });
          await page.waitForTimeout(30);
          await page.evaluate(() => { window.press('c'); window.select('c'); });
          await page.waitForTimeout(70);
          assert.equal(entries(await page.evaluate(() => window.events)).length, 0, 'Rapid selection entered old content');
          await page.evaluate(() => window.setMessages('c'));
          await waitForEntry(page, '2:uid-a');
          assert.notEqual(await page.evaluate(() => window.testChatKey()), originalKey, 'chatType omitted from peer identity');
          result.visibility = await visible(page);
          assert.deepEqual(entries(await page.evaluate(() => window.events)).map(event => event.peer), ['2:uid-a']);
        } else if (name === 'selected-reclick') {
          await page.evaluate(() => window.press('a'));
          await page.waitForTimeout(180);
          assert.equal((await page.evaluate(() => window.events)).filter(event => ['entry', 'exit'].includes(event.kind)).length, 0, 'Selected item replayed switch animation');
          result.visibility = await visible(page);
        } else if (name === 'controller-lifecycle') {
          await page.evaluate(() => { window.press('b'); window.__liuliSwitchMotion.dispose(); });
          assert.equal(await page.evaluate(() => document.querySelector('.chat-msg-area').hasAttribute('data-ll-switching')), false, 'Dispose retained switch flag');
          const offset = await page.evaluate(() => window.events.length);
          await page.evaluate(() => window.press('b'));
          await page.waitForTimeout(70);
          assert.equal((await page.evaluate(offset => window.events.slice(offset), offset)).filter(event => ['entry', 'exit'].includes(event.kind)).length, 0, 'Disposed controller still animates input');
          await page.evaluate(() => { window.testInstall(); window.testInstall(); });
          const reinstallOffset = await page.evaluate(() => window.events.length);
          result.reinstalled = await switchTo(page, 'b');
          assert.equal((await page.evaluate(offset => window.events.slice(offset), reinstallOffset)).filter(event => event.kind === 'exit' && event.target === 'chat-msg-area').length, 1, 'Repeated installation duplicated area exits');
        } else {
          await page.evaluate(() => { window.press('empty'); window.select('empty'); return window.setMessages('empty'); });
          await page.waitForTimeout(1750);
          result.visibility = await visible(page);
          assert.notEqual(await page.evaluate(() => window.testChatKey()), originalKey, 'Empty conversation did not use selected contact identity');
        }
        assert.deepEqual(errors, [], 'Browser errors');
        result.events = await page.evaluate(() => window.events); result.passed = true;
      } catch (error) { result.error = error.stack; result.events = await page.evaluate(() => window.events || []).catch(() => []); report.errors.push({ name, error: error.message }); }
      finally { report.cases.push(result); await page.close(); }
    }
    report.passed = report.errors.length === 0;
    if (!report.passed) process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'same-name-switch-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, passedCases: report.cases.filter(value => value.passed).length, cases: report.cases.length, errors: report.errors }));
  }
})();
