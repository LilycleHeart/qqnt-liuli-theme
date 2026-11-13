'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.resolve(root, '../../output/playwright/pin-group-motion-20261113'));
fs.mkdirSync(output, { recursive: true });
const css = fs.readFileSync(path.join(root, 'assets/pin-groups.css'), 'utf8');
const source = fs.readFileSync(path.join(root, 'renderer/pin-groups.js'), 'utf8');
const fixture = `<!doctype html><style>
body{margin:0;background:#35313f;color:white;font:14px sans-serif}
.recent-contact{position:relative;width:280px;height:450px;overflow:hidden}
.q-scroll-view{height:450px;overflow:auto}.viewport-list__inner{position:relative}.viewport-list__placeholder{height:0}
.recent-contact-item{position:relative;display:flex;align-items:center;gap:10px;height:64px;min-height:64px;padding:12px 10px;margin:0 6px!important;box-sizing:border-box}
.item__avatar{width:40px;height:40px;background:#b9aa94;border-radius:50%;flex:none}.item__content{flex:1}.secondary-info{font-size:11px}
</style><body><section class="recent-contact"><div class="list-toggler"><div class="q-scroll-view"><div class="viewport-list"><div class="viewport-list__placeholder"></div><div class="viewport-list__inner">
${['a', 'b', 'c', 'd'].map((id, i) => `<div class="recent-contact-item ${i < 2 ? 'recent-contact-item--top' : ''} ${i === 0 ? 'recent-contact-item--selected' : ''}" data-contact-id="${id}"><div class="item__avatar"></div><div class="item__content">Conversation ${id}</div><div class="secondary-info">12:34</div></div>`).join('')}
</div><div class="viewport-list__placeholder"></div></div></div></div></section>`;
async function sample(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.recent-contact');
    const rows = [...host.querySelectorAll('.viewport-list__inner>.recent-contact-item')];
    const animations = host.getAnimations({ subtree: true });
    return { moving: host.hasAttribute('data-liuli-pin-motion'), collapsed: host.hasAttribute('data-liuli-pin-collapsed'),
      rows: rows.map(node => ({ id: node.dataset.contactId, y: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height,
        display: getComputedStyle(node).display, opacity: getComputedStyle(node.querySelector('.item__content')).opacity,
        original: node === window.originalRows.get(node.dataset.contactId), temporaryStyle: node.style.cssText })),
      surface: host.querySelector('.liuli-pin-surface')?.getBoundingClientRect().toJSON(),
      transitions: animations.filter(animation => animation instanceof CSSTransition).length,
      clocks: animations.slice(0, 3).map(animation => ({ state: animation.playState, time: animation.currentTime, pending: animation.pending })) };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { cases: [], samples: [], passed: false, scope: 'Real row geometry in isolated Chromium; live QQ validation is separate.' };
  try {
    for (const name of ['collapse-expand', 'natural-progression', 'rapid-reverse', 'rapid-header-click', 'keyboard-header', 'ordinary-row-click', 'stable-scroll', 'container-resize', 'replace-root', 'replace-inner', 'clear-during-motion', 'reduced-motion', 'preference-change']) {
      const page = await browser.newPage({ viewport: { width: 450, height: 600 }, reducedMotion: name === 'reduced-motion' ? 'reduce' : 'no-preference' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(fixture);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: source });
      await page.evaluate(() => {
        window.originalRows = new Map([...document.querySelectorAll('.recent-contact-item')].map(node => [node.dataset.contactId, node]));
        window.nativeInnerHTML = document.querySelector('.viewport-list__inner').innerHTML;
        window.options = { group: true, color: true, collapsed: false, onToggleCollapsed: collapsed => window.toggle(collapsed) };
        window.toggle = collapsed => { window.options.collapsed = collapsed; window.__liuliPinGroups.apply(window.options); };
        window.__liuliPinGroups.apply(window.options);
        window.rowClicks = [];
        for (const row of window.originalRows.values()) row.addEventListener('click', () => window.rowClicks.push(row.dataset.contactId));
      });
      await page.waitForTimeout(60);
      const expanded = await sample(page);
      if (name === 'container-resize') {
        for (const width of [220, 350]) {
          await page.evaluate(width => { document.querySelector('.recent-contact').style.width = width + 'px'; }, width);
          await page.waitForTimeout(70);
          const result = await sample(page);
          const rowWidth = await page.locator('[data-contact-id=a]').evaluate(node => node.getBoundingClientRect().width);
          assert.equal(result.surface.width, rowWidth, 'Surface did not follow container-only ResizeObserver updates');
        }
      } else if (name === 'replace-root') {
        await page.evaluate(() => {
          window.toggle(true);
          window.oldRoot = document.querySelector('.recent-contact');
          const replacement = window.oldRoot.cloneNode(false);
          for (const attribute of [...replacement.attributes]) if (attribute.name.startsWith('data-liuli-')) replacement.removeAttribute(attribute.name);
          replacement.innerHTML = '<div class="q-scroll-view"><div class="viewport-list"><div class="viewport-list__placeholder"></div><div class="viewport-list__inner">' + window.nativeInnerHTML + '</div><div class="viewport-list__placeholder"></div></div></div>';
          window.oldRoot.replaceWith(replacement);
          window.__liuliPinGroups.apply(window.options);
        });
        assert.equal(await page.evaluate(() => window.oldRoot.hasAttribute('data-liuli-pin-motion') ||
          !!window.oldRoot.querySelector('[data-liuli-pin],.liuli-pin-heading,.liuli-pin-surface') ||
          [...window.oldRoot.querySelectorAll('.recent-contact-item')].some(node => node.style.cssText)), false, 'Detached root retained marks, UI or temporary motion styles');
        const final = await sample(page);
        assert.equal(final.moving, false);
        assert.equal(final.collapsed, true);
        assert.equal(final.rows[0].height, 8);
        assert.equal(final.surface.height, 36);
      } else if (name === 'stable-scroll') {
        const result = await page.evaluate(async () => {
          const surface = document.querySelector('.liuli-pin-surface');
          const scroller = document.querySelector('.q-scroll-view');
          let writes = 0, headers = 0;
          const observer = new MutationObserver(records => { writes += records.length; });
          observer.observe(surface, { attributes: true, attributeFilter: ['style'] });
          const nativeQuery = Element.prototype.querySelector;
          Element.prototype.querySelector = function(selector) {
            if (selector === ':scope > .liuli-pin-heading') headers++;
            return nativeQuery.call(this, selector);
          };
          try {
            for (let i = 0; i < 12; i++) {
              scroller.dispatchEvent(new Event('scroll'));
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
            return { writes, headers };
          } finally { observer.disconnect(); Element.prototype.querySelector = nativeQuery; }
        });
        assert.equal(result.writes, 0, 'Stable scroll rewrote an identical surface style');
        assert.equal(result.headers, 0, 'Pure scroll reran the complete row marking pass');
        report.samples.push({ name, ...result });
      } else if (name === 'ordinary-row-click') {
        await page.locator('[data-contact-id=c]').click();
        assert.deepEqual(await page.evaluate(() => window.rowClicks), ['c']);
      } else {
        if (name === 'keyboard-header') await page.locator('.liuli-pin-heading').press('Enter');
        else await page.evaluate(name => {
          window.toggle(true);
          if (name === 'collapse-expand') for (const animation of document.querySelector('.recent-contact').getAnimations({ subtree: true })) {
            animation.pause(); animation.currentTime = 0;
          }
        }, name);
        if (name === 'reduced-motion') {
          assert.equal((await sample(page)).moving, false);
        } else if (name === 'collapse-expand') {
          const initial = await sample(page);
          assert(initial.moving && initial.transitions > 0);
          assert(Math.abs(initial.rows[2].y - expanded.rows[2].y) < 0.1, 'Collapse jumped immediately: ' + JSON.stringify({ initial, expanded }));
          await page.evaluate(() => { for (const animation of document.querySelector('.recent-contact').getAnimations({ subtree: true })) animation.currentTime = 65; });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const middle = await sample(page);
          assert(middle.rows[2].y < expanded.rows[2].y && middle.rows[2].y > 40, 'Following rows must move during collapse: ' + JSON.stringify(middle));
          assert(middle.surface.height < expanded.surface.height && middle.surface.height > 36, 'Surface did not follow row height');
          await page.screenshot({ path: path.join(output, 'collapse-middle.png') });
          report.samples.push({ name, phase: 'middle', ...middle });
          await page.evaluate(() => { for (const animation of document.querySelector('.recent-contact').getAnimations({ subtree: true })) animation.finish(); });
        } else if (name === 'natural-progression') {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.waitForTimeout(60);
          const middle = await sample(page);
          assert(middle.rows[2].y < expanded.rows[2].y && middle.rows[2].y > 40, 'Unpaused transitions did not advance');
          report.samples.push({ name, phase: 'natural-middle', ...middle });
        } else if (name === 'rapid-header-click') {
          await page.waitForTimeout(45);
          assert.equal(await page.locator('.liuli-pin-heading').count(), 1);
          await page.locator('.liuli-pin-heading').click();
          await page.waitForTimeout(45);
          assert.equal(await page.locator('.liuli-pin-heading').count(), 1);
          await page.locator('.liuli-pin-heading').click();
          assert.equal(await page.locator('.liuli-pin-heading').count(), 1);
        } else if (name === 'rapid-reverse') {
          await page.waitForTimeout(60);
          const reversal = await page.evaluate(() => {
            const before = document.querySelector('[data-contact-id=c]').getBoundingClientRect().top;
            window.toggle(false);
            const after = document.querySelector('[data-contact-id=c]').getBoundingClientRect().top;
            return { before, after };
          });
          assert(Math.abs(reversal.before - reversal.after) < 0.1, 'Reversal jumped to an endpoint: ' + JSON.stringify(reversal));
          await page.waitForTimeout(45);
          await page.evaluate(() => window.toggle(true));
        } else if (name === 'replace-inner') {
          await page.evaluate(() => {
            const inner = document.querySelector('.viewport-list__inner');
            const replacement = inner.cloneNode(false);
            replacement.innerHTML = window.nativeInnerHTML;
            inner.replaceWith(replacement);
          });
          await page.waitForTimeout(60);
          assert.equal((await sample(page)).moving, false);
        } else if (name === 'clear-during-motion') {
          await page.evaluate(() => window.__liuliPinGroups.clear());
          const cleared = await sample(page);
          assert.equal(cleared.moving, false);
          assert.equal(cleared.collapsed, false);
          assert(cleared.rows.every(row => !row.temporaryStyle));
          assert.equal(await page.locator('.liuli-pin-heading,.liuli-pin-surface,[data-liuli-pin]').count(), 0);
        } else if (name === 'preference-change') {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.waitForTimeout(30);
          assert.equal((await sample(page)).moving, false);
        }
        if (name !== 'clear-during-motion') {
          await page.waitForTimeout(260);
          const collapsed = await sample(page);
          assert.equal(collapsed.moving, false);
          assert.equal(collapsed.rows[0].height, 8);
          assert.equal(collapsed.surface.height, 36);
          assert.equal(collapsed.rows[1].display, 'none');
          assert(collapsed.rows.every(row => !row.temporaryStyle), 'Temporary row styles leaked');
          await page.evaluate(() => {
            window.toggle(false);
            window.expandAnimations = document.querySelector('.recent-contact').getAnimations({ subtree: true });
            for (const animation of window.expandAnimations) { animation.pause(); animation.currentTime = 0; }
          });
          if (!['reduced-motion', 'preference-change'].includes(name)) {
            const start = await sample(page);
            assert(start.moving);
            assert(Math.abs(start.rows[2].y - collapsed.rows[2].y) < 0.1, 'Expand jumped immediately: ' + JSON.stringify({start, collapsed}));
          }
          await page.evaluate(() => { for (const animation of window.expandAnimations) animation.finish(); });
          await page.waitForTimeout(260);
          const final = await sample(page);
          assert.equal(final.moving, false);
          assert.equal(final.rows[0].height, expanded.rows[0].height);
          assert.equal(final.rows[1].height, expanded.rows[1].height);
          assert.equal(final.rows[2].y, expanded.rows[2].y);
          assert(final.rows.every(row => !row.temporaryStyle), 'Temporary styles survived expansion');
          if (name !== 'replace-inner') assert(final.rows.every(row => row.original), 'Native row was replaced');
          assert.deepEqual(await page.evaluate(() => window.rowClicks), [], 'Header click opened a conversation');
        }
      }
      assert.deepEqual(errors, []);
      report.cases.push({ name, passed: true });
      await page.close();
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'pin-group-motion-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
