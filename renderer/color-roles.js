// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  const ROLE_KEY = 'liuli-color-roles';
  const CONTAINERS = [
    ['primary', '主色'],
    ['secondary', '次色'],
    ['tertiary', '第三色']
  ];
  const ROLE_SLOTS = [
    {
      key: 'accent',
      label: '强调色',
      def: 'primary',
      hint: '链接、按钮、@ 提及、开关等用的颜色。',
      options: CONTAINERS
    },
    {
      key: 'selected',
      label: '选中项',
      def: 'primary',
      hint: '会话列表、侧边栏、分段按钮里「当前选中」那一项的底色。',
      options: CONTAINERS
    },
    {
      key: 'self',
      label: '自己的气泡',
      def: 'primary',
      hint: '主色 / 次色 / 第三色是同明暗的柔和底色；实底是更鲜艳的主色；中性是和对方一样的玻璃；反相是旧版的样子（暗色主题里是浅色气泡）。',
      options: CONTAINERS.concat([
        ['solid', '实底'],
        ['surface', '中性'],
        ['inverse', '反相']
      ])
    },
    {
      key: 'others',
      label: '对方的气泡',
      def: 'surface',
      hint: '中性是半透明玻璃，壁纸会透出来；选一个颜色就是实底。',
      options: [['surface', '中性']].concat(CONTAINERS)
    }
  ];
  function defaultRoles() {
    const o = {};
    ROLE_SLOTS.forEach(s => {
      o[s.key] = s.def;
    });
    return o;
  }
  function loadRoles() {
    const out = defaultRoles();
    try {
      const raw = JSON.parse(localStorage.getItem(ROLE_KEY) || '{}') || {};
      ROLE_SLOTS.forEach(s => {
        if (s.options.some(o => o[0] === raw[s.key])) out[s.key] = raw[s.key];
      });
    } catch (e) {}
    return out;
  }
  function saveRoles(roles) {
    try {
      localStorage.setItem(ROLE_KEY, JSON.stringify(roles));
    } catch (e) {}
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function accentPalette(theme, roles) {
    const k = roles && roles.accent;
    return theme.palettes[k === 'secondary' || k === 'tertiary' ? k : 'primary'];
  }
  function containerPair(mcu, s, k) {
    const hex = v => mcu.hexFromArgb(v);
    const link = k === 'tertiary' ? s.primary : s.tertiary;
    return [hex(s[k + 'Container']), hex(s['on' + cap(k) + 'Container']), hex(link)];
  }
  function roleVars(mcu, theme, isDark, roles) {
    const s = isDark ? theme.schemes.dark : theme.schemes.light;
    const opp = isDark ? theme.schemes.light : theme.schemes.dark;
    const hex = v => mcu.hexFromArgb(v);
    const v = {};
    const sel = roles.selected || 'primary';
    const sp = containerPair(mcu, s, sel === 'secondary' || sel === 'tertiary' ? sel : 'primary');
    v['--ll-primary-container'] = sp[0];
    v['--ll-on-primary-container'] = sp[1];
    // 会话实底选中态也要跟随「选中项」，不能固定跟随链接/按钮的强调色。
    const selectedRole = sel === 'secondary' || sel === 'tertiary' ? sel : 'primary';
    v['--ll-selected'] = hex(s[selectedRole]);
    v['--ll-on-selected'] = hex(s['on' + cap(selectedRole)]);
    const rgb = color => {
      const value = parseInt(color.slice(1), 16);
      return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(',');
    };
    v['--ll-selected-rgb'] = rgb(v['--ll-selected']);
    v['--ll-on-selected-rgb'] = rgb(v['--ll-on-selected']);
    let self;
    switch (roles.self) {
      case 'secondary':
      case 'tertiary':
        self = containerPair(mcu, s, roles.self);
        break;
      case 'solid':
        // Primary is tone 80 in dark mode and 40 in light mode. Tertiary
        // 30/90 keeps links readable on that fill and distinct from body text.
        self = [hex(s.primary), hex(s.onPrimary), hex(theme.palettes.tertiary.tone(isDark ? 30 : 90))];
        break;
      case 'surface':
        self = ['rgba(var(--ll-acrylic), 0.86)', 'var(--ll-on-glass)', 'var(--ll-brand)'];
        break;
      case 'inverse':
        self = [hex(opp.primaryContainer), hex(opp.onPrimaryContainer), hex(opp.tertiary)];
        break;
      default:
        self = containerPair(mcu, s, 'primary');
    }
    v['--ll-bubble-self'] = self[0];
    v['--ll-bubble-self-fg'] = self[1];
    v['--ll-bubble-self-link'] = self[2];
    if (roles.others === 'primary' || roles.others === 'secondary' || roles.others === 'tertiary') {
      const o = containerPair(mcu, s, roles.others);
      v['--ll-bubble-other'] = o[0];
      v['--ll-bubble-other-fg'] = o[1];
      v['--ll-bubble-other-link'] = o[2];
    } else {
      v['--ll-bubble-other'] = null;
      v['--ll-bubble-other-fg'] = null;
      v['--ll-bubble-other-link'] = null;
    }
    return v;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function buildRoleControls(host, onChange) {
    const box = el('div', 'liuli-roles');
    host.appendChild(box);
    box.appendChild(el('div', 'liuli-panel__group', '配色'));
    box.appendChild(
      el('div', 'liuli-field__hint', '颜色从当前主题取色派生，这里决定每个位置用哪一种颜色。')
    );
    const pv = el('div', 'liuli-roles-preview');
    const other = el('div', 'liuli-roles-bubble liuli-roles-bubble--other', '对方的消息');
    const self = el('div', 'liuli-roles-bubble liuli-roles-bubble--self');
    self.appendChild(document.createTextNode('自己的消息 '));
    self.appendChild(el('span', 'liuli-roles-link', '链接'));
    pv.appendChild(other);
    pv.appendChild(self);
    box.appendChild(pv);
    const roles = loadRoles();
    const segs = {};
    ROLE_SLOTS.forEach(slot => {
      const row = el('div', 'liuli-wp-fit liuli-mode-row liuli-roles-row');
      row.appendChild(el('span', '', slot.label));
      const seg = el('div', 'liuli-seg liuli-roles-seg');
      slot.options.forEach(([val, text]) => {
        const b = el('button', 'liuli-seg__item', text);
        b.type = 'button';
        b.dataset.v = val;
        b.addEventListener('click', () => {
          roles[slot.key] = val;
          saveRoles(roles);
          draw();
          if (onChange) onChange(roles);
        });
        seg.appendChild(b);
      });
      segs[slot.key] = seg;
      row.appendChild(seg);
      box.appendChild(row);
      const hint = el('div', 'liuli-field__hint', slot.hint);
      box.appendChild(hint);
    });
    const reset = el('div', 'liuli-field__hint liuli-lo-reset', '恢复默认配色');
    reset.addEventListener('click', () => {
      Object.assign(roles, defaultRoles());
      saveRoles(roles);
      draw();
      if (onChange) onChange(roles);
    });
    box.appendChild(reset);
    function draw() {
      ROLE_SLOTS.forEach(slot => {
        segs[slot.key].querySelectorAll('.liuli-seg__item').forEach(b => {
          b.classList.toggle('is-active', b.dataset.v === roles[slot.key]);
        });
      });
    }
    draw();
    addEventListener('storage', e => {
      if (e.key !== ROLE_KEY) return;
      Object.assign(roles, loadRoles());
      draw();
    });
  }
  window.LiuliRoles = {
    ROLE_KEY,
    ROLE_SLOTS,
    defaultRoles,
    loadRoles,
    saveRoles,
    accentPalette,
    roleVars,
    buildRoleControls
  };
})();
