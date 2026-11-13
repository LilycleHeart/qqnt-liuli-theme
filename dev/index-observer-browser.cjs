'use strict';
// Exact production observer/message/member functions in an isolated browser.
// Integration UI effects are stubbed; this never connects to the running QQ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/index-scroll-audit-20261113'));
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
function cut(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const snippets = [
  cut('  const GLASS = [', '  async function loadText('),
  cut('  function groupMessages() {', '  function stickAvatars() {'),
  cut('  function llRecentSpeakers() {', '  /* #32.1b'),
  cut('  var llGM = ', '  var llMsgSeen = '),
  cut('  function llMsgId(el) {', '  let llEnterPeer = '),
  cut('  function installPageObserver() {', '  function installRevealTracker() {')
].join('\n');
const message = (id, name = 'name' + id) => `<div class="ml-item" id="${id}"><div class="message"><div class="message-container"><div class="avatar-span" aria-label="${name}"></div><div class="message-content__wrapper"><div class="msg-content-container"><span class="text-ellipsis">Name ${id}</span><span class="text-element">Text ${id}</span></div></div></div></div></div>`;
const fixture = `<!doctype html><style>body{color:rgb(33,34,35);--ll-on-glass-2:#8899aa}.chat-msg-area{height:300px;width:600px;overflow:auto}.message-container{height:60px}.group-member{height:300px;overflow:auto}</style><div id="app"><div class="aio"><div class="chat-msg-area"><div class="viewport-list__inner" id="message-inner">${Array.from({ length: 60 }, (_, i) => message(i + 1)).join('')}</div><div id="placeholder"></div></div></div><div class="group-member"><div class="group-member-title">Members 100<span></span></div><div class="group-member-list">${Array.from({ length: 100 }, (_, i) => `<div class="group-user" data-index="${i}"><span class="group-user__name">name${i + 1}</span>${i < 3 ? '<span class="group-member-label">staff</span>' : ''}</div>`).join('')}</div></div><div class="recent-contact"><div id="recent-inner">${Array.from({ length: 30 }, (_, i) => `<div class="recent-contact-item"><span class="text-ellipsis">Contact ${i}</span></div>`).join('')}</div></div></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production observer regression fixture; no QQ interaction or FPS claims', cases: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(fixture);
    await page.addScriptTag({ content: `(() => {
      const c = window.counts = {};
      const count = (key, n=1) => c[key]=(c[key]||0)+n;
      const gcs = window.getComputedStyle;
      window.getComputedStyle = (...args) => { count('getComputedStyle'); return gcs(...args); };
      const active = window.activeObservers = { mutation: new Set(), resize: new Set() };
      for(const [name, type] of [['MutationObserver','mutation'],['ResizeObserver','resize']]) {
        const Native = window[name];
        window[name] = class extends Native {
          constructor(...args) { super(...args);this.owned=window.trackPageObservers; }
          observe(...args) { if(this.owned) active[type].add(this);return super.observe(...args); }
          disconnect() { active[type].delete(this); return super.disconnect(); }
        };
      }
      const motion={reduced:false,play(){}};
      const llModeCfg={chatStyle:'tg'};
      let refreshInputGeometry=()=>{};
      const LL_MD_KEY='md', LL_EASE='ease';
      const llChatKey=()=> 'fixture';
      const llMsgSeen={chat:'fixture',max:60n};
      const llNorm = value => (value||'').replace(/\\s+/g,' ').trim();
      const llGroupKey=()=> 'fixture';
      const llRiseIn=()=>{}, llVisibleIn=()=>[], llHandleAdded=()=>{}, llMembersArrived=()=>{};
      const ensureHoverEntries=()=>{}, llWatchContactList=()=>{}, llApplyPinGroups=()=>{};
      const mountSettingsEntry=()=>{}, llLayoutPass=()=>{}, keepWindowControlsVisible=()=>{}, mountInputBar=()=>{};
      const syncBubbleWidth=()=>count('syncBubbleWidth'), scheduleStick=()=>count('scheduleStick');
      const syncPictureRatios=()=>count('syncPictureRatios');
      const moveSenderIntoBubble=()=>count('moveSenderIntoBubble'), markQuoteRoots=()=>{}, llMarkdownPass=()=>count('markdown'), llAtPass=()=>{};
      window.__liuliVoiceLayout={refresh:()=>count('voiceRefresh')};
      window.LiuliQQ={messageRecord: element=>{count('messageRecord');const row=element.closest('.ml-item');return {chatType:2,peerUid:'fixture',senderUid:row?.dataset.sender||row?.id,msgTime:1000};}};
      ${snippets}
      for(const [name, original] of [['normalize',normalizeColors],['group',groupMessages],['members',llGroupMembersPass],['motion',llMotionPass]]) {
        const wrapped = (...args) => {count(name);return original(...args);};
        if(name==='normalize') normalizeColors=wrapped;
        if(name==='group') groupMessages=wrapped;
        if(name==='members') llGroupMembersPass=wrapped;
        if(name==='motion') llMotionPass=wrapped;
      }
      window.resetCounts=()=>{const out={...c};for(const key of Object.keys(c))delete c[key];return out;};
      window.installObserver=()=>{window.trackPageObservers=true;try{return installPageObserver();}finally{window.trackPageObservers=false;}};
      llGM.key='fixture';
      window.installObserver();
    })()` });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const take = () => page.evaluate(() => window.resetCounts());
    const testCase = async (name, action, check) => {
      await take();
      await action();
      await settle();
      const counts = await take();
      await check(counts);
      report.cases.push({ name, counts });
    };
    await settle();
    for (const selector of ['#message-inner', '#recent-inner', '.group-member-list', '#placeholder']) {
      await testCase('virtual geometry ' + selector, () => page.evaluate(selector => {
        const target=document.querySelector(selector);
        target.style.transform='translateY(20px)';target.style.height='5000px';
      }, selector), counts => assert.deepEqual(counts, {}));
    }
    await testCase('virtual presentation class', () => page.evaluate(() => document.querySelector('#message-inner').classList.add('native-scroll-active')), counts => assert.deepEqual(counts, {}));
    await testCase('actual leaf layout style stays local', () => page.evaluate(() => document.querySelector('.text-element').style.transform='translateY(2px)'), counts => {
      assert.equal(counts.normalize,1);assert.equal(counts.getComputedStyle,1);assert(!counts.group&&!counts.members&&!counts.motion&&!counts.voiceRefresh);
    });
    await testCase('nongeometry color remains normalized', () => page.evaluate(() => document.querySelector('.text-element').style.color='rgb(128,128,128)'), async counts => {
      assert.equal(counts.normalize,1);assert(!counts.group&&!counts.members);
      assert.equal(await page.$eval('.text-element', element => element.style.color), 'var(--ll-on-glass-2)');
    });
    await testCase('message text update retains full content pass', () => page.evaluate(() => document.querySelector('.text-element').firstChild.data+=' edited'), counts => {
      assert.equal(counts.group,1);assert.equal(counts.voiceRefresh,1);assert.equal(counts.markdown,1);assert(!counts.members);assert(!counts.syncBubbleWidth);
    });
    await testCase('virtual message row identity reuse', () => page.evaluate(() => document.querySelector('.ml-item').id='1001'), counts => {
      assert.equal(counts.group,1);assert(!counts.members);
    });
    await testCase('new message grouping and sender processing before first paint', () => page.evaluate(async html => {
      document.querySelector('.ml-item:last-child').dataset.sender='same';
      document.querySelector('#message-inner').insertAdjacentHTML('beforeend',html);
      document.querySelector('.ml-item:last-child').dataset.sender='same';
      await Promise.resolve();
      window.beforePaintCounts={...window.counts};
    }, message(61)), async counts => {
      assert.equal(counts.group,1);assert.equal(counts.moveSenderIntoBubble,1);assert(!counts.members);
      assert(!counts.syncBubbleWidth);
      const early=await page.evaluate(()=>window.beforePaintCounts);
      assert.equal(early.group,1);assert.equal(early.moveSenderIntoBubble,1);assert(!early.markdown);
      assert.deepEqual(await page.$$eval('#message-inner > .ml-item:nth-last-child(-n+2) .message-container', nodes => nodes.map(node=>node.dataset.liuliG)), ['first','last']);
    });
    await testCase('message speakers update indexed member rows', () => page.evaluate(() => document.querySelector('.ml-item:last-child .avatar-span').setAttribute('aria-label','name100')), async counts => {
      assert.equal(counts.group,1);assert(!counts.members);
      assert.equal(await page.$eval('.group-user:last-child', row=>row.dataset.liuliActive),'hot');
      assert.equal(await page.$eval('.group-user:nth-child(61)', row=>row.dataset.liuliActive||''),'');
    });
    await testCase('recent contact content avoids member scan', () => page.evaluate(() => document.querySelector('#recent-inner .text-ellipsis').firstChild.data+=' changed'), counts => assert(!counts.group&&!counts.members));
    await testCase('native message colors wait for scroll idle while layout remains immediate', () => page.evaluate(() => {
      document.querySelector('.chat-msg-area').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:280}));
      const leaf=document.querySelector('.text-element');leaf.style.color='rgb(247,76,48)';leaf.firstChild.data+=' scroll edit';
    }), async counts => {
      assert.equal(counts.group,1);assert.equal(counts.getComputedStyle||0,0);
      assert.equal(await page.$eval('.text-element',node=>node.style.color),'rgb(247, 76, 48)');
      await page.waitForTimeout(230);
      assert.equal(await page.$eval('.text-element',node=>node.style.color),'var(--ll-danger)');
      await take();
    });
    await testCase('appending a message child preserves mapped siblings without rereading them', () => page.evaluate(() => {
      document.querySelector('.text-element').parentElement.insertAdjacentHTML('beforeend','<span class="new-native-leaf" style="color:rgb(128,128,128)">new sibling</span>');
    }), async counts => {
      assert.equal(await page.$eval('.text-element',node=>node.style.color),'var(--ll-danger)');
      assert.equal(await page.$eval('.new-native-leaf',node=>node.style.color),'var(--ll-on-glass-2)');
      assert((counts.getComputedStyle||0)<=2,'Existing mapped sibling colors were reread');
    });
    await testCase('removing the last child maps a newly eligible parent leaf', () => page.evaluate(async () => {
      const parent=document.createElement('span');parent.className='removed-only-parent';
      parent.style.color='rgb(247,76,48)';parent.append('remaining text',document.createElement('i'));
      document.querySelector('.text-element').parentElement.append(parent);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.resetCounts();parent.lastChild.remove();
    }), async counts => {
      assert.equal(await page.$eval('.removed-only-parent',node=>node.style.color),'var(--ll-danger)');
      assert.equal(counts.getComputedStyle,1);
    });
    await testCase('removing a recent contact child flushes a newly eligible leaf without message work', () => page.evaluate(async () => {
      const parent=document.createElement('span');parent.className='contact-removed-only';
      parent.style.color='rgb(247,76,48)';parent.append('remaining contact',document.createElement('i'));
      document.querySelector('#recent-inner .recent-contact-item').append(parent);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.resetCounts();parent.lastChild.remove();
    }), async counts => {
      assert.equal(await page.$eval('.contact-removed-only',node=>node.style.color),'var(--ll-danger)');
      assert.equal(counts.getComputedStyle,1);assert(!counts.group&&!counts.members);
    });
    await testCase('member row identity reuse retains full member pass', () => page.evaluate(() => document.querySelector('.group-user:last-child').setAttribute('data-index','100')), counts => {
      assert.equal(counts.members,1);assert(!counts.group);
    });
    await testCase('member text refreshes index', () => page.evaluate(() => document.querySelector('.group-user:last-child .group-user__name').firstChild.data='different'), async counts => {
      assert.equal(counts.members,1);assert.equal(await page.$eval('.group-user:last-child',row=>row.dataset.liuliActive||''),'');
    });
    await testCase('markdown storage settings retain message refresh', () => page.evaluate(() => window.dispatchEvent(new StorageEvent('storage',{key:'md',newValue:'changed'}))), counts => {
      assert.equal(counts.group,1);assert.equal(counts.markdown,1);assert(!counts.members);
    });
    await testCase('scope refresh retains colors and member rebuild', () => page.evaluate(() => window.dispatchEvent(new Event('liuli-scope'))), counts => {
      assert.equal(counts.normalize,1);assert.equal(counts.group,1);assert.equal(counts.members,1);
    });
    await testCase('scroll time glyphs are excluded', () => page.evaluate(() => {
      const pill=document.createElement('div');pill.id='liuli-scroll-time';pill.innerHTML='<span>12:00</span>';
      document.body.append(pill);pill.firstChild.textContent='12:01';
    }), counts => assert.deepEqual(counts,{}));
    await testCase('dispose cancels queued work and removes observers/listeners', () => page.evaluate(() => {
      window.oldObserver=window.__liuliPageObserver;
      window.oldObserver.refresh();window.oldObserver.dispose();
      document.querySelector('.text-element').firstChild.data+=' ignored';
      window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('liuli-scope'));
      window.dispatchEvent(new StorageEvent('storage',{key:'md',newValue:'ignored'}));
    }), async counts => {
      assert.deepEqual(counts,{});
      assert.deepEqual(await page.evaluate(()=>({mutation:activeObservers.mutation.size,resize:activeObservers.resize.size,api:!!window.__liuliPageObserver})),{mutation:0,resize:0,api:false});
    });
    await page.evaluate(() => { window.installObserver();window.installObserver();window.oldObserver.dispose(); });
    await settle();
    await testCase('reinstall has one observer and one content pass', () => page.evaluate(() => document.querySelector('.text-element').firstChild.data+=' once'), async counts => {
      assert.equal(counts.group,1);assert(!counts.members);
      assert.deepEqual(await page.evaluate(()=>({mutation:activeObservers.mutation.size,resize:activeObservers.resize.size})),{mutation:1,resize:1});
    });
    assert.deepEqual(errors,[]);
    const early=await browser.newPage();
    await early.setContent('<div class="chat-msg-area"><span class="avatar-span" data-liuli-ty="-20" style="transform:translateY(-20px)"></span><div class="pic-element" style="width:300px;height:200px"></div></div>');
    function helper(name) { const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start);return source.slice(start,end+4); }
    await early.addScriptTag({content:`(()=>{const llModeCfg={chatStyle:'tim',avatarPosition:'top',bubbleMaxWidth:40};let liuliStickRaf=0;window.geometryReads=0;window.scheduled=0;Element.prototype.getBoundingClientRect=function(){geometryReads++;throw Error('Unexpected geometry read')};Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get(){geometryReads++;throw Error('Unexpected width read')}});window.requestAnimationFrame=()=>{scheduled++;return 1};${['stickAvatars','scheduleStick','syncPictureRatios'].map(helper).join('\n')}window.topStick=()=>{stickAvatars();scheduleStick();};window.classicStick=()=>{llModeCfg.chatStyle='classic';llModeCfg.avatarPosition='bottom';stickAvatars();scheduleStick();};window.ratio=()=>syncPictureRatios(document.querySelector('.chat-msg-area'));})();`});
    await early.evaluate(()=>{topStick();classicStick();ratio();});
    assert.deepEqual(await early.evaluate(()=>({geometry:geometryReads,scheduled,offset:document.querySelector('.avatar-span').style.transform,ratio:document.querySelector('.pic-element').style.getPropertyValue('--ll-picture-ratio')})),{geometry:0,scheduled:0,offset:'',ratio:'1.5'});
    report.cases.push({name:'Top/classic avatar cleanup and new picture ratio need no geometry reads or animation frames'});
    await early.close();
    report.passed=true;
  } catch(error) {report.error=error.stack;process.exitCode=1;}
  finally {await browser.close();fs.writeFileSync(path.join(output,'observer-regressions.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
