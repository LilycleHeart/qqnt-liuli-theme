'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const generate = require('./patch-scroll-geometry-live.cjs');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/message-scroll-coverage-20261113/scroll-geometry'));
fs.mkdirSync(output, { recursive: true });
const old = fs.readFileSync(path.join(root, '../../output/playwright/scroll-flash-repair-20261113/index.js.before'), 'utf8');
const start = old.indexOf('  function stickAvatars('), end = old.indexOf('\n  }', start);
assert(start >= 0 && end > start);
const oldStick = old.slice(start, end + 4);
const widthStart = old.indexOf('  function syncBubbleWidth('), widthEnd = old.indexOf('\n  }', widthStart);
assert(widthStart >= 0 && widthEnd > widthStart);
const oldWidth = old.slice(widthStart, widthEnd + 4);
const fixture = `<!doctype html><style>.chat-msg-area{margin:20px;width:400px;height:220px}.chat-msg-area__vlist{height:180px;width:100%}</style><body><div class="chat-msg-area" id="outer"><div class="chat-msg-area__vlist" id="inner"></div></div><div id="other"></div></body>`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Exact old stickAvatars/syncBubbleWidth closures plus instance-method/accessor checks in isolated Chromium; no QQ operations.', cases: [], passed: false };
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(fixture);
    await page.evaluate(() => {
      window.__liuliSettingsCache = { avatarPosition: 'top', chatStyle: 'tg', bubbleMaxWidth: 40 };
      window.counts = new Map(); window.widthCounts = new Map(); window.originalRows = new Map(); window.descriptors = new Map(); window.widthDescriptors = new Map();
      window.nativeRect = Element.prototype.getBoundingClientRect;
      window.nativeWidth = Object.getOwnPropertyDescriptor(Element.prototype,'clientWidth');
      window.instrument = (area, ownWidth = true) => {
        Object.defineProperty(area, 'getBoundingClientRect', { configurable: true, enumerable: true, writable: false,
          value: function(...args) { counts.set(this, (counts.get(this) || 0) + 1); return nativeRect.apply(this, args); } });
        if (area.matches('.chat-msg-area') && ownWidth) Object.defineProperty(area,'clientWidth', {
          configurable:true, enumerable:true,
          get:function(){widthCounts.set(this,(widthCounts.get(this)||0)+1);return nativeWidth.get.call(this);},
          set:function(value){this.dataset.nativeWidthSetter=String(value);}
        });
        originalRows.set(area.id, area);
        descriptors.set(area, Object.getOwnPropertyDescriptor(area, 'getBoundingClientRect'));
        widthDescriptors.set(area, Object.getOwnPropertyDescriptor(area,'clientWidth'));
      };
      for (const area of document.querySelectorAll('.chat-msg-area,.chat-msg-area__vlist')) instrument(area);
      window.rectFromSticky = function stickAvatars(area) { return area.getBoundingClientRect().toJSON(); };
      window.total = () => [...counts.values()].reduce((sum, value) => sum + value, 0);
      window.totalWidth = () => [...widthCounts.values()].reduce((sum,value)=>sum+value,0);
      window.sameDescriptor = area => {
        const before = descriptors.get(area), after = Object.getOwnPropertyDescriptor(area, 'getBoundingClientRect');
        return before && after && ['value', 'writable', 'enumerable', 'configurable'].every(key => before[key] === after[key]);
      };
      window.sameWidthDescriptor = area => {
        const before=widthDescriptors.get(area), after=Object.getOwnPropertyDescriptor(area,'clientWidth');
        return !before ? !after : !!after && ['get','set','enumerable','configurable'].every(key=>before[key]===after[key]);
      };
    });
    await page.addScriptTag({ content: `(()=>{const llModeCfg=window.__liuliSettingsCache;${oldStick};${oldWidth};window.oldStick=stickAvatars;window.oldWidth=syncBubbleWidth})();` });
    const negative = await page.evaluate(() => { counts.clear(); oldStick(); return total(); });
    assert.equal(negative, 2);
    report.beforeNativeReads = negative;
    report.cases.push('Exact old top-avatar closure reads the viewport twice before its mode early return');
    const negativeWidth=await page.evaluate(()=>{widthCounts.clear();oldWidth();return {reads:totalWidth(),value:document.querySelector('#outer').style.getPropertyValue('--ll-message-max-width')};});
    assert.deepEqual(negativeWidth,{reads:2,value:'160px'});
    report.beforeNativeWidthReads=negativeWidth.reads;
    report.cases.push('Exact old width closure performs two native clientWidth reads per area before the bridge');

    await page.addScriptTag({ content: generate() });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => __liuliScrollGeometryCompatibility.guardedAreas), 2);
    const cached = await page.evaluate(() => {
      counts.clear();widthCounts.clear();
      for (let index = 0; index < 30; index++) {oldStick();oldWidth();}
      for (const area of originalRows.values()) rectFromSticky(area);
      return { reads: total(), widthReads:totalWidth(), prototype: Element.prototype.getBoundingClientRect === nativeRect && Object.getOwnPropertyDescriptor(Element.prototype,'clientWidth').get===nativeWidth.get,
        innerWidthOwn:Object.hasOwn(document.querySelector('#inner'),'clientWidth') };
    });
    assert.deepEqual(cached, { reads: 0, widthReads:0, prototype: true, innerWidthOwn:false });
    report.cases.push('Thirty old avatar/width passes use instance caches with zero native reads and no prototype change');

    const widthPass=await page.evaluate(()=>{
      const outer=document.querySelector('#outer'),inner=document.querySelector('#inner');
      const get=Object.getOwnPropertyDescriptor(outer,'clientWidth').get;
      widthCounts.clear();const normal=outer.clientWidth,borrowed=get.call(inner);
      function syncBubbleWidth(){return get.call(inner);}
      const borrowedFromOld=syncBubbleWidth();outer.clientWidth=123;
      return {reads:totalWidth(),normal,borrowed,borrowedFromOld,setter:outer.dataset.nativeWidthSetter};
    });
    assert.deepEqual(widthPass,{reads:3,normal:400,borrowed:400,borrowedFromOld:400,setter:'123'});
    report.cases.push('Native width reads, borrowed getters even in the old named closure, and original setters pass through');

    const passthrough = await page.evaluate(() => {
      const outer = document.querySelector('#outer'), inner = document.querySelector('#inner');
      counts.clear(); outer.getBoundingClientRect(); outer.getBoundingClientRect.call(inner);
      const normal = total();
      counts.clear(); __liuliSettingsCache.avatarPosition = 'bottom'; oldStick();
      const bottom = total();
      counts.clear(); __liuliSettingsCache.chatStyle = 'classic'; oldStick();
      const classic = total();
      counts.clear(); __liuliSettingsCache.chatStyle = 'tim'; oldStick();
      return { normal, bottom, classic, timBottom: total() };
    });
    assert.deepEqual(passthrough, { normal: 2, bottom: 2, classic: 0, timBottom: 2 });
    const changedSettings = await page.evaluate(() => {
      const saved = __liuliSettingsCache, area = document.querySelector('#outer');
      counts.clear(); window.__liuliSettingsCache = { avatarPosition: 'top', chatStyle: 'tim' }; rectFromSticky(area);
      const replacementObject = total();
      counts.clear(); delete window.__liuliSettingsCache;
      document.body.dataset.liuliAvatarPosition = 'bottom'; document.body.dataset.liuliChatStyle = 'classic';
      rectFromSticky(area); const bodyFallback = total();
      window.__liuliSettingsCache = saved;
      return { replacementObject, bodyFallback };
    });
    assert.deepEqual(changedSettings, { replacementObject: 0, bodyFallback: 0 });
    report.cases.push('Native callers and TG/TIM bottom mode pass through; settings changes immediately enable classic cache use');

    await page.evaluate(() => {
      __liuliSettingsCache.avatarPosition = 'top';
      document.querySelector('#outer').style.width = '520px';
    });
    await page.waitForFunction(() => window.rectFromSticky(document.querySelector('#outer')).width === 520);
    const resized = await page.evaluate(() => { counts.clear(); return { rect: rectFromSticky(document.querySelector('#outer')), reads: total() }; });
    assert.equal(resized.rect.width, 520); assert.equal(resized.reads, 0);
    const resizedWidth=await page.evaluate(()=>{widthCounts.clear();oldWidth();return {reads:totalWidth(),value:document.querySelector('#outer').style.getPropertyValue('--ll-message-max-width')};});
    assert.deepEqual(resizedWidth,{reads:0,value:'208px'});
    report.cases.push('ResizeObserver updates true cached rect/width after layout; old closures subsequently perform zero native reads');

    const mounts = await page.evaluate(async () => {
      counts.clear();widthCounts.clear();
      document.querySelector('#inner').insertAdjacentHTML('beforeend', Array.from({length: 100}, (_, index) => `<div class="ml-item">${index}</div>`).join(''));
      await new Promise(resolve => setTimeout(resolve, 30));
      return { reads: total(), widthReads:totalWidth(), rowsGuarded: [...document.querySelectorAll('.ml-item')].some(row => Object.hasOwn(row, 'getBoundingClientRect')||Object.hasOwn(row,'clientWidth')), count: __liuliScrollGeometryCompatibility.guardedAreas };
    });
    assert.deepEqual(mounts, { reads: 0, widthReads:0, rowsGuarded: false, count: 2 });
    report.cases.push('One hundred native row mounts bind no row methods and cause no geometry reads');

    await page.evaluate(() => {
      const wrapper = document.createElement('section');
      wrapper.innerHTML = '<div class="chat-msg-area" id="replacement"><div class="chat-msg-area__vlist" id="replacement-inner"></div></div>';
      for (const area of wrapper.querySelectorAll('.chat-msg-area,.chat-msg-area__vlist')) instrument(area);
      window.detachedArea = document.querySelector('#outer');
      detachedArea.replaceWith(wrapper);
    });
    await page.waitForFunction(() => window.__liuliScrollGeometryCompatibility.guardedAreas === 2 && Object.getOwnPropertyDescriptor(document.querySelector('#replacement'), 'getBoundingClientRect').value !== window.descriptors.get(document.querySelector('#replacement')).value);
    assert(await page.evaluate(() => sameDescriptor(detachedArea) && sameDescriptor(detachedArea.querySelector('#inner')) && sameWidthDescriptor(detachedArea)));
    report.cases.push('Replacement area containers are discovered while detached instances recover their complete original descriptors');

    await page.evaluate(script => { window.previous = __liuliScrollGeometryCompatibility; (0, eval)(script); }, generate());
    await page.waitForTimeout(80);
    assert(await page.evaluate(() => previous !== __liuliScrollGeometryCompatibility && __liuliScrollGeometryCompatibility.guardedAreas === 2));
    await page.evaluate(() => __liuliScrollGeometryCompatibility.dispose());
    assert(await page.evaluate(() => !window.__liuliScrollGeometryCompatibility && [...document.querySelectorAll('.chat-msg-area,.chat-msg-area__vlist')].every(area=>sameDescriptor(area)&&sameWidthDescriptor(area))));

    await page.evaluate(script=>{(0,eval)(script);const area=document.querySelector('#replacement');window.externalRect=function(){return nativeRect.call(this);};Object.defineProperty(area,'getBoundingClientRect',{configurable:true,writable:true,value:externalRect});__liuliScrollGeometryCompatibility.dispose();},generate());
    assert(await page.evaluate(()=>{const area=document.querySelector('#replacement');return area.getBoundingClientRect===externalRect&&sameWidthDescriptor(area);}));
    await page.evaluate(()=>{const area=document.querySelector('#replacement');Object.defineProperty(area,'getBoundingClientRect',descriptors.get(area));});
    await page.evaluate(script=>{(0,eval)(script);const area=document.querySelector('#replacement');window.externalWidth=function(){return 987;};Object.defineProperty(area,'clientWidth',{configurable:true,get:externalWidth});__liuliScrollGeometryCompatibility.dispose();},generate());
    assert(await page.evaluate(()=>{const area=document.querySelector('#replacement');return sameDescriptor(area)&&Object.getOwnPropertyDescriptor(area,'clientWidth').get===externalWidth;}));
    await page.evaluate(()=>{const area=document.querySelector('#replacement');Object.defineProperty(area,'clientWidth',widthDescriptors.get(area));});
    report.cases.push('Disposal preserves externally replaced rect/width members while independently restoring its other member');

    await page.evaluate(()=>{const area=document.createElement('div');area.id='inherited';area.className='chat-msg-area';instrument(area,false);document.body.append(area);});
    await page.evaluate(script=>(0,eval)(script),generate());
    await page.waitForTimeout(70);
    assert(await page.evaluate(()=>Object.hasOwn(document.querySelector('#inherited'),'clientWidth')));
    await page.evaluate(()=>__liuliScrollGeometryCompatibility.dispose());
    assert(await page.evaluate(()=>sameWidthDescriptor(document.querySelector('#inherited'))&&!Object.hasOwn(document.querySelector('#inherited'),'clientWidth')));
    report.cases.push('An inherited native width getter receives only an instance guard and restores without an own property');

    await page.evaluate(() => { counts.clear();widthCounts.clear(); document.querySelector('#replacement').style.width = '310px'; });
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => total()), 0, 'Disposed ResizeObserver still read native geometry');
    assert.equal(await page.evaluate(()=>totalWidth()),0,'Disposed ResizeObserver still read native width');
    report.cases.push('Repeated installation and disposal restore descriptors, remove observers and stop later geometry refreshes');
    assert.deepEqual(errors, []);
    report.passed = true;
    await page.close();
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
