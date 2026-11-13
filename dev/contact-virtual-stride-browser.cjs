'use strict';
// Captured QQ contract: one measured itemHeight drives both placeholders and
// rendered-range positions. This checks geometry, not native QQ frame rate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/scroll-flash-repair-20261113/contact-stride/after'));
const layout = fs.readFileSync(process.argv[5] || path.join(root, 'assets/layout.css'), 'utf8');
const lists = fs.readFileSync(path.join(root, 'assets/lists.css'), 'utf8');
const nativeGeometry = `
body{margin:0;font:14px sans-serif;background:#49464d}
.recent-contact{position:relative;width:280px!important;height:512px!important;overflow:hidden}
.q-scroll-view{height:512px;overflow:auto}.viewport-list__inner{position:relative}
.viewport-list__measure{position:fixed;height:0;overflow:hidden;left:0;top:0;width:280px}
.recent-contact-item{position:relative;display:flex;align-items:center;gap:10px;height:64px;min-height:64px;padding:12px 10px;box-sizing:border-box}
.item__avatar{width:40px;height:40px;flex:none;border-radius:50%;background:#b4a7ca}
.item__content{flex:1}.secondary-info{font-size:11px}
`;
const row = index => `<div class="recent-contact-item${index === 16 ? ' recent-contact-item--selected' : ''}" data-contact-id="${index}"><div class="item__avatar"></div><div class="item__content">Conversation ${index}</div><div class="secondary-info">12:34</div></div>`;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Uniform-list geometry using captured QQ 64px item measurement and production contact CSS; pin-header/collapse offsets are a separate known limitation.', samples: [], passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 650 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><style>${nativeGeometry}\n${layout}\n${lists}</style><body data-liuli-scope="main"><section class="recent-contact"><div class="q-scroll-view"><div class="viewport-list"><div class="viewport-list__measure">${row(0)}</div><div id="top" class="viewport-list__placeholder"></div><div class="viewport-list__inner"></div><div id="bottom" class="viewport-list__placeholder"></div></div></div></section></body>`);
    await page.addScriptTag({ content: `(()=>{
      const total=64, size=24, row=${row.toString()};
      const scroller=document.querySelector('.q-scroll-view'),inner=document.querySelector('.viewport-list__inner');
      const itemHeight=document.querySelector('.viewport-list__measure>.recent-contact-item').getBoundingClientRect().height;
      window.renderRange=(from,scrollTop)=>{
        document.querySelector('#top').style.height=from*itemHeight+'px';
        inner.innerHTML=Array.from({length:size},(_,i)=>row(from+i)).join('');
        document.querySelector('#bottom').style.height=(total-from-size)*itemHeight+'px';
        scroller.scrollTop=scrollTop;
        const rows=[...inner.children], rects=rows.map(node=>node.getBoundingClientRect());
        return {from,itemHeight,scrollTop:scroller.scrollTop,topPlaceholder:document.querySelector('#top').getBoundingClientRect().height,
          bottomPlaceholder:document.querySelector('#bottom').getBoundingClientRect().height,
          firstOffset:rects[0].top-scroller.getBoundingClientRect().top+scroller.scrollTop,
          strides:rects.slice(1).map((rect,i)=>rect.top-rects[i].top),heights:rects.map(rect=>rect.height),
          selectedTop:inner.querySelector('[data-contact-id="16"]')?.getBoundingClientRect().top,
          selectedInset:inner.querySelector('[data-contact-id="16"]')?getComputedStyle(inner.querySelector('[data-contact-id="16"]'),'::before').top:null,
          horizontalMargin:getComputedStyle(rows[0]).marginLeft};
      };window.renderRange(0,0);
    })();` });
    for (const width of [220, 280, 380]) {
      await page.locator('.recent-contact').evaluate((node, width) => node.style.setProperty('width', width + 'px', 'important'), width);
      const samples = [];
      for (const [from, top] of [[0, 0], [10, 1024], [12, 1024], [30, 2300], [40, 3584], [0, 0]]) {
        const sample = await page.evaluate(([from, top]) => window.renderRange(from, top), [from, top]);
        sample.width = width; report.samples.push(sample); samples.push(sample);
        assert.equal(sample.itemHeight, 64, 'Theme changed the native measured box');
        assert(sample.strides.every(stride => Math.abs(stride - sample.itemHeight) < .01), 'Native stride differs from rendered contact spacing');
        assert(sample.heights.every(height => height === sample.itemHeight));
        assert(Math.abs(sample.firstOffset - from * sample.itemHeight) < .01, 'Range begins outside the native placeholder position');
        assert.equal(sample.horizontalMargin, '6px');
        if (sample.selectedInset !== null) assert.equal(sample.selectedInset, '2px', 'Selected-card inner spacing changed');
      }
      assert(Math.abs(samples[1].selectedTop - samples[2].selectedTop) < .01, 'The same contact moved when only the buffered range changed');
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'contact-stride.png') });
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, error: report.error })); }
})();
