'use strict';
// Compare real source CSS in Chromium. Shape stays mode-specific; the painted
// message surface and semantic foregrounds must match the TG reference.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/bubble-material-unify-20261113'));
fs.mkdirSync(output, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const files = [...read('renderer/index.js').slice(read('renderer/index.js').indexOf('  const FILES = ['), read('renderer/index.js').indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = `
body{--ll-brand:#705000;--ll-brand-rgb:112,80,0;--ll-acrylic:235,230,215;--ll-shadow-rgb:0,0,0;--ll-on-glass:#242018;--ll-on-glass-2:#514d44;--ll-on-glass-3:#68645b;--ll-on-primary-container:#261c00;--ll-link:#705000;--ll-tertiary:#66567a;--ll-tint-rgb:255,255,255;--ll-card-shadow:0 4px 12px #0004;--ll-material-opacity:.3;--ll-material-blur:blur(22px) saturate(1.6)}
.message-container{display:flex;flex-direction:column;align-items:flex-start;padding:10px;max-width:320px}
.message-container--self{align-items:flex-end}.msg-content-container{position:relative;background:#2c95ff;border:1px solid #fff3;border-radius:8px;padding:8px 12px;max-width:300px;box-sizing:border-box;color:#fff;backdrop-filter:none;box-shadow:none}
.text-element,.text-normal,.file-name,.file-size,.ptt-element{color:var(--text_primary,#fff)}
.file-size{color:var(--text_tertiary,#ddd)}.text-link{color:#00f}.link-info__content{padding:8px;margin-top:4px;background:#fff;color:#000}
.forward-msg{background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}.forward-msg [class*='title'],.forward-msg .count{color:var(--text_primary,#000)}
.mix-message__container--pic{background:transparent;border:0;padding:0;box-shadow:none}.pic-element{width:80px;height:50px;background:linear-gradient(30deg,#e9c36a,#97b99b)}
.container--personalization{background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;--on_bubble_host_text:#123456;--on_bubble_guest_text:#123456;--bubble_guest_text:#123456;--text_link:#345678}.personalization-bubble{width:100px;height:30px;background:linear-gradient(30deg,#fff,#fa0)}
`;
const content = {
  text: '<div class="message-content"><span class="text-element"><span class="text-normal">A short message</span> <a class="text-link">link</a></span></div>',
  link: '<div class="message-content"><span class="text-element"><a class="text--link">example.com</a><div class="link-info"><div class="link-info__content"><div class="link-info__title"><span>Title</span></div><div class="link-info__desc">Description</div></div></div></span></div>',
  voice: '<div class="ptt-message__inner"><div class="ptt-element"><span class="ptt-element__duration"><span>9″</span></span></div></div>',
  file: '<div class="file-element"><div class="file-name">document.txt</div><div class="file-size">24 KB</div></div>',
  ark: '<div class="ark-view-message"><span class="text-normal">Ark card</span></div>',
  forward: '<div class="forward-msg"><div class="title">Forwarded</div><div class="count">2 messages</div></div>',
  image: '<div class="message-content"><div class="pic-element"></div></div>',
  skin: '<div class="personalization-bubble"></div><div class="message-content"><span class="text-element">Skin text</span></div>'
};
function fixture(mode) {
  const rows = [];
  for (const direction of ['others', 'self']) for (const [kind, markup] of Object.entries(content)) {
    const extra = kind === 'voice' ? 'ptt-message__container' : kind === 'ark' ? 'ark-msg-content-container' : kind === 'image' ? 'mix-message__container--pic' : kind === 'skin' ? 'container--personalization' : '';
    const bubble = kind === 'forward' ? markup : `<div class="msg-content-container container--${direction} ${extra}">${markup}</div>`;
    rows.push(`<div class="message-container message-container--${direction}" data-liuli-g="single" data-sample="${direction}-${kind}"><div class="message-content__wrapper">${bubble}</div></div>`);
  }
  return `<!doctype html><style>${native}\n${css}\nbody{margin:0!important;padding:16px!important;background:#d2c9b3!important;font:14px sans-serif!important}#samples{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-avatar-position="bottom"><div id="samples">${rows.join('')}</div></body>`;
}
const measure = () => Object.fromEntries([...document.querySelectorAll('[data-sample]')].map(row => {
  const bubble = row.querySelector('.msg-content-container,.message-content__wrapper>.forward-msg');
  const css = getComputedStyle(bubble);
  const color = selector => { const node = bubble.querySelector(selector); return node ? getComputedStyle(node).color : null; };
  const linkCard = bubble.querySelector('.link-info__content');
  return [row.dataset.sample, { material: { background:css.backgroundColor, image:css.backgroundImage, blur:css.backdropFilter, shadow:css.boxShadow, border:css.borderColor, borderWidth:css.borderWidth, foreground:css.color,
    text:color('.text-normal,.text-element'), link:color('.text-link,.text--link'), voice:color('.ptt-element'), file:color('.file-name'), secondary:color('.file-size,.count'), cardTitle:color('.title,.link-info__title'), cardDescription:color('.link-info__desc'), linkCardBackground:linkCard ? getComputedStyle(linkCard).backgroundColor : null },
    shape:{radius:css.borderRadius,padding:css.padding,tail:getComputedStyle(bubble,'::before').clipPath} }];
}));
(async () => {
  const browser = await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
  const report = {scope:'Source CSS + actual MCU roleVars in isolated Edge; no live QQ/settings writes',cases:[]};
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    for (const roles of [{self:'primary',others:'surface'},{self:'secondary',others:'tertiary'},{self:'surface',others:'surface'}]) {
      const modes={};
      for(const mode of ['tg','tim','classic']) {
        await page.setContent(fixture(mode));
        await page.addScriptTag({content:read('assets/mcu.js')});
        await page.addScriptTag({content:read('renderer/color-roles.js')});
        await page.evaluate(roles=>{
          const mcu=window.LiuliMCU, theme=mcu.themeFromSourceColor(mcu.argbFromHex('#b48c28'));
          const vars=window.LiuliRoles.roleVars(mcu,theme,false,{accent:'primary',selected:'primary',...roles});
          for(const[key,value]of Object.entries(vars))if(value!==null)document.body.style.setProperty(key,value);
          document.body.toggleAttribute('data-liuli-other-solid',roles.others!=='surface');
        },roles);
        modes[mode]=await page.evaluate(measure);
        if(roles.self==='primary')await page.screenshot({path:path.join(output,mode+'.png'),fullPage:true});
      }
      report.cases.push({roles,modes});
      if(!process.argv.includes('--capture-only'))for(const mode of ['tim','classic']) for(const [sample,expected]of Object.entries(modes.tg)) {
        // Native images and QQ skin geometry/material remain their own surfaces.
        if(sample.endsWith('-image')||sample.endsWith('-skin'))continue;
        assert.deepEqual(modes[mode][sample].material,expected.material,`${mode} ${sample} material/roles diverged from TG`);
      }
      assert.notDeepEqual(modes.classic['others-text'].shape,modes.tg['others-text'].shape,'Native bubble shape was replaced by TG');
      assert.notDeepEqual(modes.tim['others-text'].shape,modes.tg['others-text'].shape,'TIM bubble shape was replaced by TG');
      for(const mode of ['tg','tim','classic'])assert.equal(modes[mode]['self-skin'].material.background,'rgba(0, 0, 0, 0)','QQ skin acquired an extra painted layer');
    }
    assert.deepEqual(errors,[]);report.passed=true;
  }catch(error){report.error=error.stack;process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,error:report.error}));}
})();
