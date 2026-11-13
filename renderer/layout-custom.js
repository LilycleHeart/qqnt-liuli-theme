// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  const KEY = 'liuli-layout';
  const SEEN_KEY = 'liuli-layout-seen';
  const DEFAULTS = {
    menuCompact: false,
    menuOrder: [],
    barOrder: [],
    barPinned: 1,
    inputLayout: 'float',
    navHidden: [],
    titlebar: 'float',
    navPin: false,
    unlockSidebarShortcuts: false,
    edgeHints: true
  };
  const ICON_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
  const REPEAT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path fill="none" d="M21 11.5a9 9 0 0 1-9 9 9.8 9.8 0 0 1-4-.85L3 21l1.35-4.45A9 9 0 1 1 21 11.5Z"/><path fill="none" d="M6.5 11.5h5m-2.5-2.5v5m5-4.5 2-1v6"/></svg>';
  const ICONS_KEY = 'liuli-layout-icons';
  const iconTags = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'use', 'defs', 'clippath']);
  const iconAttrs = new Set(['viewbox', 'width', 'height', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'transform', 'href', 'xlink:href']);
  function cleanIcon(source) {
    if (!source) return '';
    let node = source;
    if (typeof source === 'string') {
      if (source.length > 16000) return '';
      const template = document.createElement('template');
      template.innerHTML = source;
      node = template.content.querySelector('svg');
    }
    if (node?.localName?.toLowerCase() !== 'svg') return '';
    const copy = node.cloneNode(true);
    for (const element of [copy, ...copy.querySelectorAll('*')]) {
      if (!iconTags.has(element.localName.toLowerCase())) { element.remove(); continue; }
      for (const attr of [...element.attributes]) {
        const name = attr.name.toLowerCase(), value = attr.value.trim();
        if (!iconAttrs.has(name) ||
          ((name === 'href' || name === 'xlink:href') && !/^(?:#|\/(?!\/)|app:\/\/)/i.test(value)) ||
          (/url\s*\(/i.test(value) && !/^url\(\s*#[\w-]+\s*\)$/i.test(value))) element.removeAttribute(attr.name);
      }
    }
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('focusable', 'false');
    return copy.outerHTML;
  }
  function loadIcons() {
    try {
      const icons = JSON.parse(localStorage.getItem(ICONS_KEY) || '{}');
      return icons && typeof icons === 'object' && !Array.isArray(icons) ? icons : {};
    } catch (_) { return {}; }
  }
  function rememberIcons(kind, entries) {
    const icons = loadIcons();
    let changed = false;
    for (const [name, node] of entries) {
      const svg = cleanIcon(node?.matches?.('svg') ? node : node?.querySelector('svg'));
      const key = kind + ':' + name;
      if (svg && icons[key] !== svg) { icons[key] = svg; changed = true; }
    }
    if (changed) {
      try { localStorage.setItem(ICONS_KEY, JSON.stringify(icons)); } catch (_) {}
      refreshIcons();
    }
  }
  function refreshIcons() {
    const icons = loadIcons();
    document.querySelectorAll('.liuli-lo-icon[data-icon-key]').forEach(node => {
      const svg = cleanIcon(icons[node.dataset.iconKey]);
      if (svg && node.innerHTML !== svg) node.innerHTML = svg;
      node.classList.toggle('has-icon', !!svg);
    });
  }
  addEventListener('storage', event => { if (event.key === ICONS_KEY) refreshIcons(); });
  const ICON_SHOW =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
  const ICON_HIDE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
  // aria-label 会带「消息 123条未读」「联系人 1个通知」；这些是同一个入口，
  // 不能当成新按钮记录。读取缓存时也归一化，清理旧版本留下的枚举条目。
  function navKey(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s*[（(]?\d+\+?\s*(?:条未读(?:消息)?|个通知)[）)]?\s*$/u, '').trim();
  }
  function navKeys(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(navKey).filter(Boolean))];
  }
  function loadLayout() {
    try {
      const cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
      cfg.navHidden = navKeys(cfg.navHidden);
      return cfg;
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function saveLayout(cfg) {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {}
    applyAll();
  }
  function loadSeen() {
    try {
      const seen = Object.assign(
        { menu: [], bar: [], nav: [] },
        JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
      );
      const cleaned = navKeys(seen.nav);
      if (JSON.stringify(cleaned) !== JSON.stringify(seen.nav)) {
        seen.nav = cleaned;
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      }
      return seen;
    } catch (e) {
      return {
        menu: [],
        bar: [],
        nav: []
      };
    }
  }
  function remember(kind, labels) {
    if (kind === 'nav') labels = navKeys(labels);
    const seen = loadSeen();
    const list = seen[kind];
    let changed = false;
    labels.forEach((l, i) => {
      if (!l || list.indexOf(l) >= 0) return;
      const prev = labels
        .slice(0, i)
        .reverse()
        .find(x => list.indexOf(x) >= 0);
      list.splice(prev ? list.indexOf(prev) + 1 : list.length, 0, l);
      changed = true;
    });
    if (changed)
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      } catch (e) {}
  }
  function mergedOrder(order, seen) {
    const out = order.filter(x => seen.indexOf(x) >= 0);
    seen.forEach(x => {
      if (out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }
  const norm = s =>
    (s || '')
      .replace(/\s*(Ctrl|Alt|Shift|⌘)[\s\S]*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  function menuLabel(item) {
    const t = item.querySelector('.q-context-menu-item__text');
    return norm(t ? t.textContent : item.textContent);
  }
  function applyMenu(menu) {
    if (!menu || !menu.classList.contains('aio-right-click-menu')) return;
    const cfg = loadLayout();
    const items = [...menu.querySelectorAll(':scope > .q-context-menu-item')];
    for (const item of items) {
      const icon = item.querySelector('.q-context-menu-item__icon');
      if (item.classList.contains('qe-repeat-item') && icon && icon.dataset.liuliRepeatIcon !== '1') {
        icon.innerHTML = REPEAT_ICON;
        icon.dataset.liuliRepeatIcon = '1';
      }
    }
    const labels = items.map(menuLabel);
    rememberIcons('menu', items.map((item, i) => [labels[i], item.querySelector('.q-context-menu-item__icon')]));
    remember('menu', labels);
    const order = cfg.menuOrder || [];
    menu.classList.toggle('liuli-menu-sorted', order.length > 0);
    items.forEach((it, i) => {
      if (it.title !== labels[i]) it.title = labels[i];
      const k = order.indexOf(labels[i]);
      it.style.setProperty('order', String(k >= 0 ? k : 500 + i));
    });
  }
  function barIcons() {
    const bar = document.querySelector('.chat-input-area .chat-func-bar');
    if (!bar) return [];
    return [...bar.querySelectorAll('.bar-icon')]
      .map(b => {
        const it = b.querySelector(':scope > .icon-item[aria-label]');
        return it
          ? {
              el: b,
              item: it,
              label: norm(it.getAttribute('aria-label'))
            }
          : null;
      })
      .filter(x => x && x.label);
  }
  function barLayout() {
    const cfg = loadLayout();
    const seen = loadSeen().bar;
    const order = mergedOrder(cfg.barOrder || [], seen.length ? seen : ['表情']);
    if (!cfg.barOrder || !cfg.barOrder.length) {
      const i = order.indexOf('表情');
      if (i > 0) {
        order.splice(i, 1);
        order.unshift('表情');
      }
    }
    const pinned = Math.max(0, Math.min(order.length, Number(cfg.barPinned) || 0));
    return {
      order,
      pinned: order.slice(0, pinned)
    };
  }
  function applyBar() {
    const icons = barIcons();
    rememberIcons('bar', icons.map(icon => [icon.label, icon.item]));
    if (loadLayout().inputLayout === 'native') {
      for (const icon of icons) {
        icon.el.classList.remove('liuli-pinned', 'liuli-in-menu');
        icon.el.style.removeProperty('order');
      }
      return [];
    }
    if (!icons.length) return [];
    remember(
      'bar',
      icons.map(x => x.label)
    );
    const lay = barLayout();
    icons.forEach((x, i) => {
      const pin = lay.pinned.indexOf(x.label) >= 0;
      x.el.classList.toggle('liuli-pinned', pin);
      x.el.classList.toggle('liuli-in-menu', !pin);
      const k = lay.order.indexOf(x.label);
      x.el.style.setProperty('order', String(k >= 0 ? k : 500 + i));
    });
    return lay.pinned;
  }
  function nativeBarItem(label) {
    const x = barIcons().find(y => y.label === label);
    return x ? x.item : null;
  }
  function labelOf(n) {
    const own = n.getAttribute('aria-label');
    if (own) return own;
    const c = n.querySelector('[aria-label]');
    return c ? c.getAttribute('aria-label') : '';
  }
  function navEntries() {
    const out = [];
    document.querySelectorAll('.sidebar__nav > .nav-item').forEach(n => {
      const lab = navKey(norm(labelOf(n)));
      if (lab)
        out.push({
          el: n,
          key: '上:' + lab
        });
    });
    document.querySelectorAll('.sidebar__menu .func-menu__item').forEach(n => {
      const lab = navKey(norm(labelOf(n)));
      if (lab)
        out.push({
          el: n,
          key: '下:' + lab
        });
    });
    return out;
  }
  function navName(key) {
    const [pos, lab] = [key.slice(0, 1), key.slice(2)];
    const dup = loadSeen().nav.filter(k => k.slice(2) === lab).length > 1;
    return dup ? lab + '（' + (pos === '上' ? '上方' : '底部') + '）' : lab;
  }
  function applyNav() {
    const list = navEntries();
    if (!list.length) return;
    rememberIcons('nav', list.map(item => [item.key, item.el]));
    remember(
      'nav',
      list.map(x => x.key)
    );
    const hidden = loadLayout().navHidden || [];
    list.forEach(x => {
      const h = hidden.indexOf(x.key) >= 0;
      if (h) {
        if (x.el.dataset.liuliHide !== '1') x.el.dataset.liuliHide = '1';
      } else if (x.el.dataset.liuliHide) delete x.el.dataset.liuliHide;
    });
  }
  let onBarChange = null;
  function applyAll() {
    try {
      const cfg = loadLayout();
      document.body.dataset.liuliInputLayout = cfg.inputLayout === 'native' ? 'native' : 'float';
      if (cfg.inputLayout === 'native') {
        document.querySelectorAll('.chat-func-bar.liuli-expanded').forEach(bar => bar.classList.remove('liuli-expanded'));
        document.querySelectorAll('.chat-input-area').forEach(area => area.style.removeProperty('z-index'));
        const overlay = document.getElementById('liuli-input-overlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.removeProperty('--liuli-bar-pad');
      }
      window.LiuliQQ?.sidebarShortcutLimit?.(cfg.unlockSidebarShortcuts === true);
      document.body.toggleAttribute('data-liuli-menu-compact', !!cfg.menuCompact);
      document.body.toggleAttribute('data-liuli-hide-edge-hints', cfg.edgeHints === false);
      const tb = cfg.titlebar === 'native' ? 'native' : 'float';
      if (document.body.dataset.liuliTb !== tb) document.body.dataset.liuliTb = tb;
      document.body.toggleAttribute('data-liuli-nav-pin', !!cfg.navPin);
      if (cfg.navPin && document.body.dataset.liuliRNav) delete document.body.dataset.liuliRNav;
      applyNav();
      /* #52：输入框按钮顺序/分界属于主窗口和独立聊天窗（#/chat）；
       * 迷你窗等其它非主窗口保留 QQ 原生工具栏，不套主窗的 order/显隐类。 */
      const llMainLike =
        document.body.dataset.liuliScope === 'main' ||
        (location.hash || '').indexOf('#/chat') === 0;
      if (llMainLike) applyBar();
      document.querySelectorAll('.q-context-menu.aio-right-click-menu').forEach(applyMenu);
      if (onBarChange) onBarChange();
    } catch (e) {}
  }
  function installLayout(barChanged) {
    onBarChange = barChanged;
    addEventListener('storage', e => {
      if (e.key === KEY) applyAll();
    });
    applyAll();
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(svg, title) {
    const b = el('button', 'liuli-lo-btn');
    b.type = 'button';
    b.title = title;
    b.innerHTML = svg;
    return b;
  }
  function seg(host, label, pairs, cur, onPick) {
    const row = el('div', 'liuli-wp-fit liuli-mode-row');
    row.appendChild(el('span', '', label));
    const s = el('div', 'liuli-seg');
    pairs.forEach(([v, t]) => {
      const b = el('button', 'liuli-seg__item' + (v === cur ? ' is-active' : ''), t);
      b.type = 'button';
      b.addEventListener('click', () => {
        s.querySelectorAll('.liuli-seg__item').forEach(x =>
          x.classList.toggle('is-active', x === b)
        );
        onPick(v);
      });
      s.appendChild(b);
    });
    row.appendChild(s);
    host.appendChild(row);
  }
  function sortList(host, items, opts) {
    const box = el('div', 'liuli-lo-list');
    box.setAttribute('role', 'list');
    box.dataset.iconKind = opts.iconKind || '';
    host.appendChild(box);
    const status = el('span', 'liuli-lo-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    host.appendChild(status);
    let dragging = null;
    function clearDrop() {
      box.querySelectorAll('.is-drop-before, .is-drop-after').forEach(row => row.classList.remove('is-drop-before', 'is-drop-after'));
    }
    function move(name, destination, focus) {
      const from = items.indexOf(name);
      if (from < 0 || from === destination) return;
      items.splice(destination, 0, items.splice(from, 1)[0]);
      opts.onChange(items);
      draw();
      const row = [...box.querySelectorAll('.liuli-lo-row')].find(row => row.dataset.orderKey === name);
      if (focus) row?.querySelector('.liuli-lo-grip')?.focus({ preventScroll: true });
      status.textContent = (opts.nameOf ? opts.nameOf(name) : name) + '，第 ' + (destination + 1) + ' 项，共 ' + items.length + ' 项';
    }
    function draw() {
      box.innerHTML = '';
      if (!items.length) {
        box.appendChild(el('div', 'liuli-field__hint', opts.empty));
        return;
      }
      items.forEach((name, i) => {
        if (opts.divider && i === opts.divider())
          box.appendChild(el('div', 'liuli-lo-divider', opts.dividerText));
        const row = el('div', 'liuli-lo-row');
        row.dataset.orderKey = name;
        row.setAttribute('role', 'listitem');
        if (opts.isOff && opts.isOff(name)) row.classList.add('is-off');
        if (opts.sortable !== false) {
          const grip = iconBtn(ICON_GRIP, '拖动排序，或用 ↑ ↓ 键调整');
          grip.classList.add('liuli-lo-grip');
          grip.setAttribute('aria-label', '调整' + name + '顺序');
          grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
          grip.addEventListener('keydown', event => {
            const destination = event.key === 'ArrowUp' ? i - 1 : event.key === 'ArrowDown' ? i + 1 : -1;
            if (destination >= 0 && destination < items.length) {
              event.preventDefault();
              move(name, destination, true);
            }
          });
          row.appendChild(grip);
          row.draggable = true;
          row.addEventListener('dragstart', event => {
            dragging = { name, destination: i };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', name);
            row.classList.add('is-dragging');
          });
          row.addEventListener('dragover', event => {
            if (!dragging) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            clearDrop();
            const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
            row.classList.add(after ? 'is-drop-after' : 'is-drop-before');
            const from = items.indexOf(dragging.name);
            const slot = i + Number(after);
            dragging.destination = Math.max(0, Math.min(items.length - 1, slot - Number(from < slot)));
          });
          row.addEventListener('drop', event => {
            if (!dragging) return;
            event.preventDefault();
            const { name, destination } = dragging;
            dragging = null;
            clearDrop();
            move(name, destination, false);
          });
          row.addEventListener('dragend', () => {
            dragging = null;
            clearDrop();
            row.classList.remove('is-dragging');
          });
        }
        const icon = el('span', 'liuli-lo-icon');
        icon.dataset.iconKey = (opts.iconKind || '') + ':' + name;
        icon.setAttribute('aria-hidden', 'true');
        row.appendChild(icon);
        row.appendChild(el('span', 'liuli-lo-name', opts.nameOf ? opts.nameOf(name) : name));
        if (opts.toggle) {
          const off = opts.isOff(name);
          const t = iconBtn(off ? ICON_HIDE : ICON_SHOW, off ? '已隐藏，点击显示' : '点击隐藏');
          t.addEventListener('click', () => {
            opts.toggle(name);
            draw();
          });
          row.appendChild(t);
        }
        box.appendChild(row);
      });
      if (opts.divider && opts.divider() >= items.length)
        box.appendChild(el('div', 'liuli-lo-divider', opts.dividerText));
      refreshIcons();
    }
    draw();
    return draw;
  }
  function buildLayoutControls(host) {
    const cfg = loadLayout();
    const seen = loadSeen();
    const save = () => saveLayout(cfg);
    function section(key, title) {
      const heading = el('div', 'liuli-panel__group', title);
      heading.dataset.liuliSectionKey = key;
      host.appendChild(heading);
    }
    section('window-controls', '窗口按钮');
    seg(
      host,
      '标题栏控件',
      [
        ['float', '悬浮'],
        ['native', '常驻（原版）']
      ],
      cfg.titlebar === 'native' ? 'native' : 'float',
      v => {
        cfg.titlebar = v;
        save();
      }
    );
    host.appendChild(
      el(
        'div',
        'liuli-field__hint',
        '仅效率模式生效。悬浮时头像和窗口按钮在顶边唤出，常驻时一直显示；经典模式始终使用 QQ 原生标题栏。'
      )
    );
    seg(host, '显示边缘提示标记', [['1', '开启'], ['0', '关闭']], cfg.edgeHints === false ? '0' : '1', value => {
      cfg.edgeHints = value === '1';
      save();
    });
    host.appendChild(el('div', 'liuli-field__hint', '只隐藏顶部短横线和左侧提示线，鼠标移到边缘仍可唤出控件。'));
    section('context-menu', '右键菜单');
    seg(
      host,
      '显示方式',
      [
        ['0', '图标 + 文字'],
        ['1', '只显示图标']
      ],
      cfg.menuCompact ? '1' : '0',
      v => {
        cfg.menuCompact = v === '1';
        save();
      }
    );
    host.appendChild(
      el(
        'div',
        'liuli-field__hint',
        '拖动条目调整顺序，也可聚焦拖动柄后按 ↑ ↓ 键。原图标和名单来自你右键过的消息，图片、文件等消息的菜单项会在使用后补齐。'
      )
    );
    const menuItems = mergedOrder(cfg.menuOrder || [], seen.menu);
    sortList(host, menuItems, {
      iconKind: 'menu',
      empty: '先在聊天里右键一条消息，菜单项就会出现在这里。',
      onChange: list => {
        cfg.menuOrder = list.slice();
        save();
      }
    });
    const resetMenu = el('div', 'liuli-field__hint liuli-lo-reset', '恢复默认顺序');
    resetMenu.addEventListener('click', () => {
      cfg.menuOrder = [];
      save();
      rebuild();
    });
    host.appendChild(resetMenu);
    section('input-layout', '输入框');
    seg(host, '输入框布局', [['float', 'TG'], ['native', '原版']], cfg.inputLayout === 'native' ? 'native' : 'float', value => {
      cfg.inputLayout = value;
      save();
    });
    host.appendChild(el('div', 'liuli-field__hint', '原版保留 QQ 的工具栏、编辑区、发送按钮和高度拖动；TG 使用随内容增高的单行输入卡及「更多」菜单。下方按钮数量和排序仅用于 TG 布局。'));
    section('input-buttons', '输入框按钮');
    const lay = barLayout();
    const barItems = lay.order.slice();
    if (!cfg.barOrder || !cfg.barOrder.length) cfg.barOrder = barItems.slice();
    const pinRow = el('div', 'liuli-wp-fit liuli-mode-row');
    pinRow.appendChild(el('span', '', '输入框里显示的按钮数'));
    const stepper = el('div', 'liuli-seg');
    const minus = el('button', 'liuli-seg__item', '−');
    const num = el('span', 'liuli-lo-num', '');
    const plus = el('button', 'liuli-seg__item', '+');
    [minus, plus].forEach(b => {
      b.type = 'button';
    });
    stepper.appendChild(minus);
    stepper.appendChild(num);
    stepper.appendChild(plus);
    pinRow.appendChild(stepper);
    host.appendChild(pinRow);
    host.appendChild(
      el(
        'div',
        'liuli-field__hint',
        '分界线上面的按钮放在输入框里，下面的收进「更多」。拖动条目跨过分界线即可交换位置，也可用 ↑ ↓ 键调整。'
      )
    );
    let pinned = lay.pinned.length;
    const drawBar = sortList(host, barItems, {
      iconKind: 'bar',
      empty: '先打开一个聊天，输入框的按钮就会出现在这里。',
      divider: () => pinned,
      dividerText: '以上在输入框 · 以下在「更多」',
      onChange: list => {
        cfg.barOrder = list.slice();
        save();
      }
    });
    const syncNum = () => {
      num.textContent = String(pinned);
      minus.disabled = pinned <= 0;
      plus.disabled = pinned >= Math.min(6, barItems.length);
    };
    minus.addEventListener('click', () => {
      if (pinned > 0) {
        pinned--;
        cfg.barPinned = pinned;
        save();
        syncNum();
        drawBar();
      }
    });
    plus.addEventListener('click', () => {
      if (pinned < Math.min(6, barItems.length)) {
        pinned++;
        cfg.barPinned = pinned;
        save();
        syncNum();
        drawBar();
      }
    });
    syncNum();
    const resetBar = el('div', 'liuli-field__hint liuli-lo-reset', '恢复默认');
    resetBar.addEventListener('click', () => {
      cfg.barOrder = [];
      cfg.barPinned = 1;
      save();
      rebuild();
    });
    host.appendChild(resetBar);
    section('sidebar', '左侧边栏');
    seg(host, '解除底部快捷入口数量限制', [['1', '开启'], ['0', '关闭']],
      cfg.unlockSidebarShortcuts ? '1' : '0', value => {
        cfg.unlockSidebarShortcuts = value === '1';
        save();
      });
    host.appendChild(el('div', 'liuli-field__hint', '开启后，在 QQ 底部「更多」中点固定图标，可同时保留多个原生入口；关闭后恢复 QQ 原来的数量。'));
    seg(
      host,
      '导航栏',
      [
        ['0', '自动隐藏'],
        ['1', '固定']
      ],
      cfg.navPin ? '1' : '0',
      v => {
        cfg.navPin = v === '1';
        save();
      }
    );
    host.appendChild(
      el(
        'div',
        'liuli-field__hint',
        '仅效率模式生效。固定时导航栏独立占位；自动隐藏时从左边缘唤出。经典模式保留 QQ 原生导航栏。'
      )
    );
    host.appendChild(el('div', 'liuli-field__hint', '点眼睛图标隐藏或显示侧边栏上的按钮。'));
    sortList(host, seen.nav.slice(), {
      iconKind: 'nav',
      sortable: false,
      empty: '主界面打开后，侧边栏按钮就会出现在这里。',
      nameOf: navName,
      isOff: k => (cfg.navHidden || []).indexOf(k) >= 0,
      toggle: k => {
        const h = cfg.navHidden || (cfg.navHidden = []);
        const i = h.indexOf(k);
        if (i >= 0) h.splice(i, 1);
        else h.push(k);
        save();
      }
    });
    function rebuild() {
      host.innerHTML = '';
      buildLayoutControls(host);
    }
  }
  function buildLayoutSection(host) {
    const box = el('div', 'liuli-lo');
    host.appendChild(box);
    buildLayoutControls(box);
  }
  window.LiuliLayout = {
    loadLayout,
    mergedOrder,
    applyMenu,
    barLayout,
    applyBar,
    nativeBarItem,
    navName,
    applyNav,
    applyAll,
    installLayout,
    buildLayoutControls,
    buildLayoutSection
  };
})();
