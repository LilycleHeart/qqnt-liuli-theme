'use strict';
// Captured QQ uniform-list contract: itemHeight=64, buffer=5, 24 rendered rows.
// This verifies the expanded header prefix against geometry, not QQ frame rate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/scroll-flash-repair-20261113/pin-prefix/virtual'));
const css = ['layout.css', 'lists.css', 'pin-groups.css'].map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8')).join('\n');
const source = fs.readFileSync(path.join(root, 'renderer/pin-groups.js'), 'utf8');
const geometry = `
body{margin:0;font:14px sans-serif;background:#49464d}
.recent-contact{position:relative;width:280px!important;height:512px!important;overflow:hidden}
.q-scroll-view{height:512px;overflow:auto}.viewport-list__inner{position:relative}
.viewport-list__measure{position:fixed;height:0;overflow:hidden;left:0;top:0;width:280px}
.recent-contact-item{position:relative;display:flex;align-items:center;gap:10px;height:64px;min-height:64px;padding:12px 10px;box-sizing:border-box}
.item__avatar{width:40px;height:40px;flex:none;border-radius:50%;background:#b4a7ca}
.item__content{flex:1}.secondary-info{font-size:11px}`;
const row = index => `<div class="recent-contact-item${index < 2 ? ' recent-contact-item--top' : ''}${index === 16 ? ' recent-contact-item--selected' : ''}" data-contact-id="${index}"><div class="item__avatar"></div><div class="item__content">Conversation ${index}</div><div class="secondary-info">12:34</div></div>`;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Expanded pin-prefix geometry using captured native 64px stride. Collapsed native range reconciliation remains a separate limitation.', samples: [], passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 650 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><style>${geometry}\n${css}</style><body data-liuli-scope="main"><section class="recent-contact"><div class="list-toggler"><div class="q-scroll-view"><div class="viewport-list"><div class="viewport-list__measure">${row(0)}</div><div id="top" class="viewport-list__placeholder"></div><div class="viewport-list__inner"></div><div id="bottom" class="viewport-list__placeholder"></div></div></div></div></section></body>`);
    await page.addScriptTag({ content: `(()=>{
      const total=64,size=24,row=${row.toString()};
      const scroller=document.querySelector('.q-scroll-view'),inner=document.querySelector('.viewport-list__inner');
      window.nativeRows=new Map();window.nativeClicks=[];window.configWrites=0;
      for(let i=0;i<total;i++) { const box=document.createElement('div');box.innerHTML=row(i);const node=box.firstElementChild;
        node.addEventListener('click',()=>window.nativeClicks.push(i));window.nativeRows.set(i,node); }
      window.options={group:true,color:true,collapsed:false,onToggleCollapsed:()=>window.configWrites++};
      window.renderRange=(from,scrollTop)=>{
        document.querySelector('#top').style.height=from*64+'px';
        inner.replaceChildren(...Array.from({length:size},(_,i)=>window.nativeRows.get(from+i)));
        document.querySelector('#bottom').style.height=(total-from-size)*64+'px';
        if(window.__liuliPinGroups)window.__liuliPinGroups.apply(window.options);
        scroller.scrollTop=scrollTop;
      };window.renderRange(0,0);
      window.readGeometry=()=>{
        const root=document.querySelector('.recent-contact'),rows=[...inner.children],rects=rows.map(node=>node.getBoundingClientRect());
        return {itemHeight:document.querySelector('.viewport-list__measure>.recent-contact-item').getBoundingClientRect().height,
          prefix:root.getAttribute('data-liuli-pin-prefix'),padding:parseFloat(getComputedStyle(document.querySelector('.viewport-list')).paddingTop),
          scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,
          firstOffset:rects[0].top-scroller.getBoundingClientRect().top+scroller.scrollTop,
          strides:rects.slice(1).map((rect,i)=>rect.top-rects[i].top),heights:rects.map(rect=>rect.height),
          selectedTop:inner.querySelector('[data-contact-id="16"]')?.getBoundingClientRect().top,
          header:root.querySelector('.liuli-pin-heading')?.getBoundingClientRect().toJSON(),
          surface:root.querySelector('.liuli-pin-surface')?.getBoundingClientRect().toJSON(),
          identities:rows.every(node=>window.nativeRows.get(Number(node.dataset.contactId))===node),configWrites:window.configWrites};
      };
    })();` });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__liuliPinGroups.apply(window.options));
    for (const width of [220, 280, 380]) {
      await page.locator('.recent-contact').evaluate((node, width) => node.style.setProperty('width', width + 'px', 'important'), width);
      const samples = [];
      for (const [from, top] of [[0, 0], [0, 1024], [1, 1024], [10, 1024], [12, 1024], [40, 3612], [0, 0]]) {
        await page.evaluate(([from, top]) => window.renderRange(from, top), [from, top]);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const sample = await page.evaluate(() => window.readGeometry());
        report.samples.push({ width, from, requestedTop: top, ...sample }); samples.push(sample);
        assert.equal(sample.itemHeight, 64, 'Hidden native measurement changed');
        assert.equal(sample.prefix, '1', 'Prefix disappeared after the first pin left the render range');
        assert.equal(sample.padding, 28);
        assert(sample.heights.every(height => height === 64), 'The header inflated a virtual row');
        assert(sample.strides.every(stride => Math.abs(stride - 64) < .01), 'Rendered rows diverge from native stride');
        assert(Math.abs(sample.firstOffset - (28 + from * 64)) < .01, 'Header offset depends on the rendered range');
        assert.equal(sample.scrollTop, top, 'Bottom scrolling no longer reaches its requested coordinate');
        assert.equal(sample.scrollHeight, 64 * 64 + 28);
        assert(sample.identities, 'Theme replaced a native row');
        assert.equal(sample.configWrites, 0, 'Scrolling wrote the collapse preference');
        if (top === 0) { assert.equal(sample.header.y, 0); assert.equal(sample.header.height, 28); assert.equal(sample.surface.y, 0); assert.equal(sample.surface.height, 156); }
      }
      for (const sample of samples.slice(2, 5)) assert.equal(sample.selectedTop, samples[1].selectedTop, 'Same contact moved when only the buffer range changed');
      const bottom = samples[5]; assert.equal(bottom.scrollTop + bottom.clientHeight, bottom.scrollHeight, 'Cannot reach the final conversation');
    }
    await page.evaluate(() => {
      const first=window.nativeRows.get(0),top=first.getBoundingClientRect().top;
      for(const offset of [0,4,27]) first.dispatchEvent(new MouseEvent('click',{bubbles:true,clientY:top+offset}));
    });
    assert.deepEqual(await page.evaluate(() => window.nativeClicks), [0, 0, 0], 'Normal first-row clicks were captured as the header');
    for (const method of ['clear', 'dispose']) {
      await page.evaluate(() => { window.options.collapsed=false;window.__liuliPinGroups.apply(window.options);window.options.collapsed=true;window.__liuliPinGroups.apply(window.options); });
      await page.waitForTimeout(40);
      assert.equal(await page.locator('[data-liuli-pin-motion]').count(), 1);
      const cleared = await page.evaluate(method => {
        window.__liuliPinGroups[method]();
        const root=document.querySelector('.recent-contact'),rows=[...document.querySelector('.viewport-list__inner').children];
        return {ownNodes:root.querySelectorAll('.liuli-pin-heading,.liuli-pin-surface,[data-liuli-pin],[data-liuli-pin-count]').length,
          attrs:[...root.attributes].filter(attr=>attr.name.startsWith('data-liuli-pin')).length,
          padding:getComputedStyle(document.querySelector('.viewport-list')).paddingTop,
          styles:rows.map(node=>node.style.cssText),identities:rows.every(node=>node===window.nativeRows.get(Number(node.dataset.contactId)))};
      }, method);
      assert.equal(cleared.ownNodes, 0); assert.equal(cleared.attrs, 0); assert.equal(cleared.padding, '0px');
      assert(cleared.styles.every(style => !style)); assert(cleared.identities);
      report[method] = cleared;
    }
    await page.evaluate(() => window.nativeRows.get(0).click());
    assert.deepEqual(await page.evaluate(() => window.nativeClicks), [0, 0, 0, 0], 'Cleanup removed a native listener');
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, error: report.error })); }
})();
