'use strict';
// Captured QQ Rich UI DOM + native CSS, with production MCU palette/roles.
// This script uses an isolated browser and never attaches to live QQ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/ark-card-roles-20261114/browser'));
const beforeFile = path.resolve(process.argv[5] || path.join(output, '../before/bubbles.css'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const stylesheet = before => files.filter(name => fs.existsSync(path.join(root,'assets',name))).map(name => name === 'bubbles.css' && before ? fs.readFileSync(beforeFile, 'utf8') : read('assets/' + name)).join('\n');
const afterCss = stylesheet(false);
const beforeCss = fs.existsSync(beforeFile) ? stylesheet(true) : null;
const native = read('dev/fixtures/qq-native-message-layout.css');
const captured = read('dev/fixtures/qq-native-ark.html');
// Reuse the exact production palette functions rather than inventing the role colors.
const palette = source.slice(source.indexOf('  const SURFACE_TONES ='), source.indexOf('  let paletteGeneration ='));
assert(palette.includes('function deriveVars('), 'Production palette helpers missing');
const setup = `body{margin:16px!important;font:14px 'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_3:14px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-material-opacity:.3;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-bubble-scale:1}#app{width:850px}.chat-msg-area{width:100%}.message-container{width:100%;box-sizing:border-box}.sample{margin-bottom:12px}`;
const roles = [{ self:'solid', others:'surface' }, { self:'secondary', others:'tertiary' }, { self:'surface', others:'secondary' }];

function measure() {
  const styleOf = node => { const css = getComputedStyle(node); return { background:css.backgroundColor, color:css.color, shadow:css.boxShadow, blur:css.backdropFilter }; };
  const geometry = node => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    return { width:box.width, height:box.height, radius:css.borderRadius, padding:css.padding, margin:css.margin,
      fontSize:css.fontSize, lineHeight:css.lineHeight, display:css.display, overflow:css.overflow, transform:css.transform };
  };
  const expected = {};
  const probe = document.querySelector('#role-probe');
  for (const direction of ['self','others']) {
    probe.style.background = window.expectedRoles[direction].bg;
    probe.style.color = window.expectedRoles[direction].fg;
    const css = getComputedStyle(probe);
    expected[direction] = { background:css.backgroundColor, color:css.color };
    probe.style.color = window.expectedRoles[direction].secondary;
    expected[direction].secondary = getComputedStyle(probe).color;
  }
  return {
    expected,
    references:Object.fromEntries([...document.querySelectorAll('[data-reference]')].map(row => [row.dataset.reference, styleOf(row.querySelector('.msg-content-container'))])),
    cards:[...document.querySelectorAll('[data-card]')].map(section => {
      const bubble = section.querySelector('.msg-content-container'), app = bubble.querySelector('[data-view-id="app"]');
      const fallback = bubble.querySelector('.ark-view-message_not-support');
      return { id:section.dataset.card, direction:section.dataset.direction, material:styleOf(bubble),
        title:app && getComputedStyle(app.querySelector('[data-view-id="title"]')).color,
        description:app && getComputedStyle(app.querySelector('[data-view-id="desc"]')).color,
        footer:app && getComputedStyle(app.querySelector('[data-view-id="tailText"]')).color,
        app:app && styleOf(app), fallback:fallback && styleOf(fallback),
        handlerPreserved:window.handlers.get(app || fallback) === (app || fallback).onclick,
        nodePreserved:window.cardNodes.get(section.dataset.card) === bubble,
        geometry:{ bubble:geometry(bubble), app:app && geometry(app), fallback:fallback && geometry(fallback),
          title:app && geometry(app.querySelector('[data-view-id="title"]')), description:app && geometry(app.querySelector('[data-view-id="desc"]')), footer:app && geometry(app.querySelector('[data-view-id="tailText"]')) },
        images:[...bubble.querySelectorAll('img')].map(image => ({ id:image.dataset.viewId, src:image.src,
          geometry:geometry(image), natural:[image.naturalWidth,image.naturalHeight],
          filter:getComputedStyle(image).filter, opacity:getComputedStyle(image).opacity,
          objectFit:getComputedStyle(image).objectFit, inline:image.getAttribute('style') })) };
    })
  };
}

(async () => {
  fs.mkdirSync(output, { recursive:true });
  const browser = await chromium.launch({ headless:true, ...(process.argv[3] ? {executablePath:process.argv[3]} : {}) });
  const report = { scope:'Captured QQ Rich UI and native fallback CSS, exact production MCU palette/role functions; isolated Edge only. No live QQ, message sends, CPU or FPS claims.',
    sourceSha256:crypto.createHash('sha256').update(read('assets/bubbles.css')).digest('hex'), cases:[], negativeControls:[], failures:[], passed:false };
  try {
    const page = await browser.newPage({ viewport:{width:950,height:1100} });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const mode of ['tg','tim','classic']) for (const dark of [false,true]) {
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${native}</style><style id="production-css">${afterCss}</style><style>${setup}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-avatar-position="top" data-liuli-tim-sender-position="inside" data-liuli-dark="${dark ? '1':'0'}" q-theme="${dark ? 'dark':'light'}"><div id="app"><div class="chat-msg-area"></div></div><div id="role-probe" style="position:fixed;visibility:hidden"></div></body>`);
      await page.evaluate(captured => {
        const area = document.querySelector('.chat-msg-area');
        window.handlers = new Map(); window.cardNodes = new Map(); window.cardClicks = 0;
        for (const direction of ['self','others']) for (const kind of ['rich','fallback']) {
          const section = document.createElement('section'); section.className = 'sample';
          section.dataset.card = direction + '-' + kind; section.dataset.direction = direction;
          section.innerHTML = `<div class="message-container ${direction === 'self' ? 'message-container--self message-container--align-right':''}" data-liuli-g="single" data-liuli-avatar-g="single"><div class="message-content__wrapper"></div></div>`;
          const template = document.createElement('template'); template.innerHTML = captured;
          const bubble = template.content.querySelector('.msg-content-container');
          bubble.classList.replace('container--self','container--' + direction);
          if (kind === 'fallback') {
            bubble.classList.remove('ark-msg-content-container_with_rich_ui');
            bubble.innerHTML = '<div class="ark-view-message_not-support" data-v-74ebea33>当前版本暂不支持查看此卡片</div>';
          }
          section.querySelector('.message-content__wrapper').appendChild(bubble); area.appendChild(section);
          const target = bubble.querySelector('[data-view-id="app"],.ark-view-message_not-support');
          const handler = () => window.cardClicks++; target.onclick = handler;
          handlers.set(target,handler); cardNodes.set(section.dataset.card,bubble);
        }
        for (const direction of ['self','others']) area.insertAdjacentHTML('beforeend', `<div data-reference="${direction}" class="message-container ${direction === 'self' ? 'message-container--align-right':''}" data-liuli-g="single"><div class="message-content__wrapper"><div class="msg-content-container container--${direction}"><div class="message-content"><span class="text-element text-normal">普通消息角色参考</span></div></div></div></div>`);
      }, captured);
      await page.addScriptTag({content:read('assets/mcu.js')});
      await page.addScriptTag({content:read('renderer/color-roles.js')});
      await page.addScriptTag({content:`(()=>{const {accentPalette}=LiuliRoles;${palette}window.paletteVars=deriveVars;})();`});
      await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
      let baseline = null, previous = null;
      for (const roleSet of roles) {
        await page.evaluate(({dark,roleSet}) => {
          const mcu = LiuliMCU, theme = mcu.themeFromSourceColor(mcu.argbFromHex('#b48c28'));
          const scheme = dark ? theme.schemes.dark : theme.schemes.light;
          const chosen = {accent:'primary',selected:'primary',...roleSet};
          const vars = {...paletteVars(mcu,theme,dark,chosen),...LiuliRoles.roleVars(mcu,theme,dark,chosen)};
          for (const [key,value] of Object.entries(vars)) {
            if (value === null) document.body.style.removeProperty(key);
            else document.body.style.setProperty(key,value);
          }
          // Expected pairs come directly from the MCU scheme, independently of
          // both the theme selectors and the ordinary reference bubble.
          const hex = key => mcu.hexFromArgb(scheme[key]);
          const cap = key => key[0].toUpperCase() + key.slice(1);
          const pair = (role,self) => role === 'surface' ? {bg:'rgba(var(--ll-acrylic), .86)',fg:'var(--ll-on-glass)'} :
            self && role === 'solid' ? {bg:hex('primary'),fg:hex('onPrimary')} :
            {bg:hex(role + 'Container'),fg:hex('on' + cap(role) + 'Container')};
          window.expectedRoles = {self:pair(roleSet.self,true),others:pair(roleSet.others,false)};
          expectedRoles.self.secondary = expectedRoles.self.fg;
          expectedRoles.others.secondary = roleSet.others === 'surface' ? 'var(--ll-on-glass-2)' : expectedRoles.others.fg;
        }, {dark,roleSet});
        if (!baseline) {
          if (beforeCss) {
            await page.locator('#production-css').evaluate((node,css) => {node.textContent=css;},beforeCss);
            baseline = await page.evaluate(measure);
            assert.notEqual(baseline.cards.find(card => card.id === 'self-rich').material.background, baseline.expected.self.background, 'Before snapshot did not reproduce wrong neutral Ark background');
            if (mode !== 'classic') assert.notEqual(baseline.cards.find(card => card.id === 'self-fallback').fallback.background, 'rgba(0, 0, 0, 0)', 'Before snapshot did not reproduce native fallback second surface');
            report.negativeControls.push({mode,dark,self:baseline.cards[0].material.background,expected:baseline.expected.self.background});
            await page.locator('#production-css').evaluate((node,css) => {node.textContent=css;},afterCss);
          } else baseline = await page.evaluate(measure);
        }
        const values = await page.evaluate(measure);
        try {
          if (previous) for (const direction of ['self','others']) {
            assert.notEqual(values.expected[direction].background,previous.expected[direction].background,'Role fixture did not change '+direction+' color');
            for (const card of values.cards.filter(card => card.direction === direction))
              assert.notEqual(card.material.background,previous.cards.find(old => old.id === card.id).material.background,card.id+' did not repaint on live role change');
          }
          for (const direction of ['self','others']) {
            const reference = values.references[direction], expected = values.expected[direction];
            assert.equal(reference.background,expected.background,'Ordinary reference does not match actual MCU background');
            assert.equal(reference.color,expected.color,'Ordinary reference does not match actual MCU foreground');
          }
          for (const card of values.cards) {
            const expected = values.expected[card.direction], old = baseline.cards.find(row => row.id === card.id);
            assert.equal(card.material.background,expected.background,card.id+' MCU background');
            assert.equal(card.material.color,expected.color,card.id+' MCU foreground');
            assert.deepEqual(card.material,values.references[card.direction],card.id+' reference material');
            assert.deepEqual(card.geometry,old.geometry,card.id+' geometry/radius/padding changed');
            assert.deepEqual(card.images,old.images,card.id+' image source/rendering/size changed');
            assert(card.handlerPreserved && card.nodePreserved,card.id+' native target/handler was replaced during role change');
            if (card.app) {
              assert.equal(card.title,expected.color,card.id+' title foreground');
              assert.equal(card.description,expected.secondary,card.id+' description foreground');
              assert.equal(card.footer,expected.secondary,card.id+' footer foreground');
              assert.equal(card.app.background,'rgba(0, 0, 0, 0)',card.id+' Rich UI app gained a second background');
              assert.equal(card.app.shadow,'none');
              for (const image of card.images) {
                assert.equal(image.filter,'none',card.id+' image was tinted'); assert.equal(image.opacity,'1');
                assert.deepEqual(image.natural,[45,45]);
              }
              assert.deepEqual(card.images.map(image => [image.id,image.geometry.width,image.geometry.height]),[['image',45,45],['tailIcon',12,12]]);
            } else {
              assert.equal(card.fallback.background,'rgba(0, 0, 0, 0)',card.id+' native fallback paints a second role surface');
              assert.equal(card.fallback.color,expected.color,card.id+' native fallback foreground');
            }
          }
          const beforeClicks = await page.evaluate(() => cardClicks);
          await page.evaluate(() => {
            for (const target of handlers.keys()) target.dispatchEvent(new MouseEvent('click',{bubbles:true}));
          });
          assert.equal(await page.evaluate(() => cardClicks),beforeClicks+4,'Card click handler no longer receives original target events');
          report.cases.push({mode,dark,roleSet,values,passed:true});
        } catch (error) {report.failures.push({mode,dark,roleSet,error:error.message,values});}
        previous = values;
      }
      if (dark) await page.screenshot({path:path.join(output,mode+'.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    assert.equal(report.failures.length,0,'Ark card role regression');
    report.passed = true;
  } catch (error) {report.error=error.stack;process.exitCode=1;}
  finally {
    await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,passed:report.passed,cases:report.cases.length,negativeControls:report.negativeControls.length,failures:report.failures.map(({mode,dark,roleSet,error})=>({mode,dark,roleSet,error})),error:report.error},null,2));
  }
})();
