'use strict';
// Exact before/after geometry and synchronous getter-count comparisons. Does
// not infer placeholder geometry from inline CSS or connect to a running QQ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/invisible-overhead-fix-20261114/pin-measurement'));
const before = fs.readFileSync(process.argv[5] || path.join(root, '../../output/playwright/invisible-overhead-fix-20261114/before/renderer/pin-groups.js'), 'utf8');
const after = fs.readFileSync(path.join(root, 'renderer/pin-groups.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/pin-groups.css'), 'utf8');
const row = (id, pin = true) => `<div class="recent-contact-item${pin ? ' recent-contact-item--top' : ''}" data-contact-id="${id}"><span class="item__avatar"></span><span class="item__content">Contact ${id}</span><span class="secondary-info">12:34</span></div>`;
const fixture = `<!doctype html><style>${css}
body{margin:0;font:14px sans-serif}.recent-contact{position:relative;width:280px;height:320px;overflow:hidden}
.q-scroll-view{height:320px;overflow:auto}.viewport-list__inner{position:relative}.viewport-list__measure{position:fixed;left:-1000px;height:0;overflow:hidden}
.recent-contact-item{position:relative;display:flex;align-items:center;gap:10px;height:64px;min-height:64px;padding:12px 10px;margin:0 6px!important;box-sizing:border-box}
.item__avatar{display:block;width:40px;height:40px;flex:none}.item__content{flex:1}
</style><body><section class="recent-contact"><div class="list-toggler"><div class="q-scroll-view"><div class="viewport-list"><div class="viewport-list__measure">${row('measure')}</div><div id="top" class="viewport-list__placeholder" style="height:0px"></div><div class="viewport-list__inner">${row('a')+row('b')+row('c',false)}</div><div id="bottom" class="viewport-list__placeholder" style="height:2560px"></div></div></div></div></section></body>`;
const sample = () => {
  const host=document.querySelector('.recent-contact'),inner=host.querySelector('.viewport-list__inner'),scroller=host.querySelector('.q-scroll-view');
  const rect=node=>{if(!node)return null;const value=node.getBoundingClientRect();return [value.x,value.y,value.width,value.height].map(number=>Math.round(number*1000)/1000);};
  return {prefix:host.getAttribute('data-liuli-pin-prefix'),collapsed:host.getAttribute('data-liuli-pin-collapsed'),scrollTop:scroller.scrollTop,
    rows:[...inner.children].map(node=>({id:node.dataset.contactId,pin:node.getAttribute('data-liuli-pin'),count:node.getAttribute('data-liuli-pin-count'),rect:rect(node),display:getComputedStyle(node).display,radius:getComputedStyle(node).borderRadius,
      heading:node.querySelector('.liuli-pin-heading')?{text:node.querySelector('.liuli-pin-heading').textContent,expanded:node.querySelector('.liuli-pin-heading').getAttribute('aria-expanded'),rect:rect(node.querySelector('.liuli-pin-heading'))}:null})),
    top:rect(host.querySelector('#top')),bottom:rect(host.querySelector('#bottom')),surface:rect(host.querySelector('.liuli-pin-surface')),surfaceStyle:host.querySelector('.liuli-pin-surface')?.style.cssText};
};
const settle = page => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function capture(browser, source) {
  const page=await browser.newPage({viewport:{width:700,height:600},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(fixture);await page.addScriptTag({content:source});
  await page.evaluate(()=>{window.pinOptions={group:true,color:true,collapsed:false};window.applyPins=()=>window.__liuliPinGroups.apply(window.pinOptions);window.applyPins();});await settle(page);
  const snapshots=[];
  async function action(name, fn, arg) {if(fn)await page.evaluate(fn,arg);await settle(page);snapshots.push({name,value:await page.evaluate(sample)});}
  await action('initial');
  for(const width of [220,380])await action('resize-'+width,width=>{document.querySelector('.recent-contact').style.width=width+'px';},width);
  for(const top of [0.5,1,128,0])await action('native-top-'+top,height=>{document.querySelector('#top').style.height=height+'px';document.querySelector('.q-scroll-view').dispatchEvent(new Event('scroll'));},top);
  await action('pins-only-unknown-tail',()=>{document.querySelector('[data-contact-id=c]').remove();window.applyPins();});
  await action('pins-only-complete-tail',()=>{document.querySelector('#bottom').style.height='0px';window.applyPins();});
  await action('duplicate-conversation',()=>{const inner=document.querySelector('.viewport-list__inner');inner.append(inner.firstElementChild.cloneNode(true));window.applyPins();});
  await action('collapse',()=>{window.pinOptions.collapsed=true;window.applyPins();});
  await action('expand',()=>{window.pinOptions.collapsed=false;window.applyPins();});
  // These cases deliberately invalidate any unverified inline-height shortcut.
  await action('css-min-height',()=>{const top=document.querySelector('#top');top.style.height='0px';top.style.minHeight='20px';window.applyPins();});
  await action('ancestor-transform',()=>{document.querySelector('#top').style.minHeight='';document.querySelector('#top').style.height='0.75px';document.querySelector('.recent-contact').style.transform='scaleY(2)';window.applyPins();});
  await action('hidden-placeholder',()=>{const top=document.querySelector('#top');top.style.height='256px';top.style.display='none';window.applyPins();});
  await action('unknown-placeholder-class',()=>{const top=document.querySelector('#top');top.style.display='';top.className='unknown-placeholder';window.applyPins();});
  await action('replace-inner',()=>{const old=document.querySelector('.viewport-list__inner'),next=old.cloneNode(false);next.innerHTML='<div class="recent-contact-item recent-contact-item--top" data-contact-id="new"><span class="item__content">New native row</span></div>';old.replaceWith(next);document.querySelector('#top').className='viewport-list__placeholder';document.querySelector('#top').style.height='0px';document.querySelector('.recent-contact').style.transform='';window.applyPins();});
  await action('replace-root',()=>{const old=document.querySelector('.recent-contact'),next=old.cloneNode(true);for(const node of next.querySelectorAll('.liuli-pin-heading,.liuli-pin-surface'))node.remove();for(const node of [next,...next.querySelectorAll('*')])for(const attr of [...node.attributes])if(attr.name.startsWith('data-liuli-pin'))node.removeAttribute(attr.name);old.replaceWith(next);window.applyPins();});
  await action('unpin-last',()=>{document.querySelector('.viewport-list__inner>.recent-contact-item').classList.remove('recent-contact-item--top');document.querySelector('.viewport-list__measure>.recent-contact-item').classList.remove('recent-contact-item--top');window.applyPins();});
  // Reinstall a fresh one-row fixture to isolate duplicate read paths.
  await page.evaluate(()=>window.__liuliPinGroups.dispose());await page.setContent(fixture);await page.addScriptTag({content:source});
  await page.evaluate(()=>{document.querySelector('[data-contact-id=b]').remove();document.querySelector('[data-contact-id=c]').remove();document.querySelector('#bottom').style.height='0px';window.__liuliPinGroups.apply({group:true,color:true,collapsed:false});});await settle(page);
  const counts=await page.evaluate(async()=>{
    const original=Element.prototype.getBoundingClientRect,nativeAppend=Node.prototype.appendChild,reads=[],events=[];
    Element.prototype.getBoundingClientRect=function(...args){const label=this.id||this.dataset.contactId||this.className;reads.push(label);events.push('read:'+label);return original.apply(this,args);};
    Node.prototype.appendChild=function(node){if(node.classList?.contains('liuli-pin-surface'))events.push('append:surface');return nativeAppend.call(this,node);};
    try {
      window.__liuliPinGroups.apply({group:true,color:true,collapsed:false});const repeatedApply=reads.splice(0);events.length=0;
      document.querySelector('#top').style.height='128px';document.querySelector('.q-scroll-view').dispatchEvent(new Event('scroll'));
      await new Promise(resolve=>requestAnimationFrame(resolve));const boundaryScroll=reads.splice(0);events.length=0;
      document.querySelector('.liuli-pin-surface')?.remove();window.__liuliPinGroups.apply({group:true,color:true,collapsed:false});const creationOrder=events.slice();
      return {repeatedApply,boundaryScroll,creationOrder};
    } finally {Element.prototype.getBoundingClientRect=original;Node.prototype.appendChild=nativeAppend;}
  });
  assert.deepEqual(errors,[]);await page.close();return {snapshots,counts};
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
  const report={scope:'Isolated exact before/after pin geometry and per-refresh DOM getter counts; no live QQ or FPS claim',passed:false};
  try {
    report.before=await capture(browser,before);report.after=await capture(browser,after);
    assert.deepEqual(report.after.snapshots,report.before.snapshots,'Stable/first-refresh pin geometry, counts, radii or collapse behavior changed');
    const count=(values,label)=>values.filter(value=>value===label).length;
    assert.equal(count(report.before.counts.boundaryScroll,'top'),2,'Negative control did not reread the top placeholder');
    assert.equal(count(report.after.counts.boundaryScroll,'top'),1,'Boundary refresh reread the same top placeholder');
    assert.equal(count(report.before.counts.repeatedApply,'a'),2,'Negative control did not double-read the single row');
    assert.equal(count(report.after.counts.repeatedApply,'a'),1,'Single-row surface read its row twice');
    const order=report.after.counts.creationOrder,append=order.indexOf('append:surface');
    assert(append>=0&&order.slice(append+1).every(event=>!event.startsWith('read:')),'A new surface was inserted before geometry reads finished');
    report.passed=true;
  } catch(error){report.error=error.stack;process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,error:report.error}));}
})();
