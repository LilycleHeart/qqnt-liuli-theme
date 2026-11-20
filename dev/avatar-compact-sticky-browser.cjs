'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: process.argv[3] || undefined });
  try {
    for (const theme of ['tim', 'tg']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const group = theme === 'tim' ? 'data-liuli-avatar-g' : 'data-liuli-g';
      await page.setContent('<style>#ml-root{width:320px;height:150px;overflow:auto}.ml-list{overflow:hidden;position:sticky}.message-container{display:grid;padding:1px 9px;grid-template-columns:28px 32px 12px 1fr;grid-template-areas:"check avatar . nickname" "check avatar . content" "check avatar . tips"}.self{grid-template-columns:28px 1fr 12px 32px;grid-template-areas:"check nickname . avatar" "check content . avatar" "check tips . avatar"}.avatar-span{grid-area:avatar;height:32px;align-self:end}.message-container__avatar{width:32px;height:32px}.nickname{grid-area:nickname}.message-content__wrapper{grid-area:content}.tips{grid-area:tips}[data-hide] .avatar-span{display:none}</style><body data-liuli-chat-style="'+theme+'" data-liuli-avatar-position="bottom"><div class="chat-msg-area"><div id="ml-root"><div class="ml-list"><div style="height:100px"></div><div style="height:220px" id="spacer"></div></div></div></div>');
      const baseline = await page.evaluate(group => {
        window.make = (id, tag, height, options = {}) => {
          const row = document.createElement('div');
          row.className = 'ml-item'; row.id = id;
          row.innerHTML = '<div class="message-container '+(options.self?'self':'')+'" '+group+'="'+tag+'" '+(options.hide?'data-hide':'')+'><div class="avatar-span"><div class="message-container__avatar"></div></div><div class="nickname" style="height:'+(options.name||0)+'px"></div><div class="message-content__wrapper" style="height:'+height+'px"></div><div class="tips" style="height:'+(options.tips||0)+'px"></div></div>';
          return row;
        };
        spacer.before(make('first','first',84,{hide:true,name:24}),make('mid','mid',46,{hide:true}),make('last','last',70,{self:true,tips:32}),make('single','single',24,{name:20}));
        return [...document.querySelectorAll('.ml-item')].map(r => r.offsetHeight);
      }, group);
      await page.addStyleTag({ path: path.join(__dirname, '../assets/avatar-compact.css') });
      const measure = (top, first = 'last') => page.evaluate(({ top, first }) => {
        const s = document.querySelector('#ml-root');
        s.scrollTop = top;
        const r = sel => document.querySelector(sel).getBoundingClientRect();
        const a = r('#last .avatar-span'), c = r('#last .message-container__avatar'), b = r('#last .message-content__wrapper');
        const h = r('#last .message-container'), f = r('#'+first+' .message-content__wrapper');
        const y = Math.min(b.bottom-c.height, Math.max(f.top,r('#ml-root').bottom-4-c.height));
        return { errors:[a.x-h.right+41,a.top-f.top,a.bottom-b.bottom,c.top-y], height:a.height };
      }, { top, first });
      assert.deepEqual((await measure(120)).errors, [0,0,0,0], 'untagged track uses content fallback');
      await page.addScriptTag({ path: path.join(__dirname, '../renderer/avatar-compact.js') });
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 1);
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await settle();
      const stats = () => page.evaluate(() => ({ ...window.__liuliAvatarCompactTrack.stats }));
      const idle = await stats();
      for (const top of [0,40,95,150,200,300,155,60]) assert.deepEqual((await measure(top, 'first')).errors, [0,0,0,0]);
      await settle();
      assert.deepEqual(await stats(), idle, 'Pure scrolling must not request track measurements');
      assert.deepEqual(await page.locator('.ml-item').evaluateAll(rows => rows.map(r => r.offsetHeight)), baseline);
      assert.equal(await page.locator('#single [style*="--ll-compact"]').count(), 0);
      const beforeResize = await page.locator('#last .avatar-span').evaluate(el => el.getBoundingClientRect().height);
      await page.locator('#mid .message-content__wrapper').evaluate(el => { el.style.height = '66px'; });
      await page.waitForFunction(height => [...window.__liuliAvatarCompactTrack.tracks().values()][0]?.height === height + 20, beforeResize);
      assert.deepEqual((await measure(120, 'first')).errors, [0,0,0,0]);
      await page.evaluate(() => { document.body.dataset.liuliAvatarPosition = 'top'; });
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 0);
      assert.equal(await page.locator('[data-ll-compact-host], [style*="--ll-compact"]').count(), 0);
      await page.evaluate(() => { document.body.dataset.liuliAvatarPosition = 'bottom'; });
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 1);
      await page.locator('#first').evaluate(el => el.remove());
      await page.waitForFunction(() => [...window.__liuliAvatarCompactTrack.tracks().values()][0]?.members.length === 2);
      assert.deepEqual((await measure(80, 'mid')).errors, [0,0,0,0]);
      await page.locator('#mid').evaluate(el => el.remove());
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 0);
      assert.deepEqual((await measure(70)).errors, [0,0,0,0]);
      await page.locator('#last .message-container').evaluate((el,g) => el.setAttribute(g,'single'), group);
      assert.deepEqual((await measure(70)).errors, [0,0,0,0]);
      await page.evaluate(group => {
        const tail = document.querySelector('#last');
        tail.before(make('restored','first',66,{hide:true,name:10}));
        tail.firstElementChild.setAttribute(group,'last');
      }, group);
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 1);
      assert.deepEqual((await measure(90,'restored')).errors, [0,0,0,0]);
      await page.evaluate(() => document.querySelector('#last').before(Object.assign(document.createElement('div'), {className:'ml-item'})));
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 0);
      assert.deepEqual((await measure(90)).errors, [0,0,0,0]);
      await page.evaluate(() => window.__liuliAvatarCompactTrack.dispose());
      assert.equal(await page.locator('[data-ll-compact-host], [style*="--ll-compact"]').count(), 0);
      const shortRows = await page.evaluate(group => {
        const list = document.querySelector('.ml-list');
        return ['single', 'last'].flatMap(tag => [0, 16].map(name => {
          const row = make('short-' + tag + '-' + name, tag, 24, { name });
          const host = row.firstElementChild;
          host.style.boxSizing = 'border-box';
          list.append(row);
          const candidate = row.offsetHeight;
          const a = row.querySelector('.message-container__avatar').getBoundingClientRect();
          const b = row.querySelector('.message-content__wrapper').getBoundingClientRect();
          const h = host.getBoundingClientRect();
          host.removeAttribute(group);
          return { tag, name, candidate, native: row.offsetHeight, bottomError: a.bottom - b.bottom, insideRow: a.top >= h.top };
        }));
      }, group);
      for (const row of shortRows) {
        assert.equal(row.candidate, row.native, JSON.stringify(row));
        assert.equal(row.bottomError, 0, JSON.stringify(row));
        assert.ok(row.insideRow, JSON.stringify(row));
      }
      await page.evaluate(() => {
        const list = document.querySelector('.ml-list');
        const rows = Array.from({ length: 120 }, (_, i) =>
          make('bulk-' + i, i % 2 === 0 ? 'first' : 'last', 40, { hide: i % 2 === 0 }));
        list.replaceChildren(...rows);
      });
      await page.addScriptTag({ path: path.join(__dirname, '../renderer/avatar-compact.js') });
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 60);
      await settle();
      const baselineStats = await stats();
      await page.evaluate(() => {
        window.untouchedTrack = window.__liuliAvatarCompactTrack.tracks().get(document.querySelector('#bulk-119 .message-container'));
        document.querySelector('#bulk-0').remove();
      });
      await page.waitForFunction(() => window.__liuliAvatarCompactTrack.tracks().size === 59);
      await settle();
      const after = await stats();
      assert.equal(after.fullPasses, baselineStats.fullPasses, 'Removing one row rebuilt all avatar groups');
      assert(after.rowsInspected - baselineStats.rowsInspected < 10, 'Removing one row scanned unrelated groups');
      assert(await page.evaluate(() => window.untouchedTrack === window.__liuliAvatarCompactTrack.tracks().get(document.querySelector('#bulk-119 .message-container'))),
        'Unrelated avatar track was replaced');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS TIM and TG: production compact track geometry, nickname/tips, short rows, recycling and cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
