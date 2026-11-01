// 琉璃 · 颜色角色分配（#7 #12）
// ------------------------------------------------------------
// 色板仍由 MCU 从壁纸源色派生（M3 scheme）。这里决定「界面上的每个位置用哪一个
// M3 角色」：强调色、选中项、自己的气泡、对方的气泡。
//
// 可读性原则：气泡默认用「当前明暗方案」里的 container / onContainer 配对。
//   旧版自己的气泡取「相反明暗」方案的 primaryContainer：
//     暗色主题 → 浅色气泡（tone 90，#7 说的「白框太白」）
//     亮色主题 → 深色气泡（tone 30，#7 说的「黑框」）
//   气泡里没被单独染色的元素（卡片、引用、各种消息类型）会回退到 --ll-on-glass，
//   也就是当前方案的正文色；底色跟当前方案反着来时，这些元素就是深字压深底 / 浅字压浅底。
//   同方案的 container 和正文色天然有对比度，回退也读得清。
//   想要旧样子可以选「反相」。
//
// 设置存 localStorage（设置窗口与主界面同源，storage 事件实时同步）。

export const ROLE_KEY = "liuli-color-roles";

const CONTAINERS = [["primary", "主色"], ["secondary", "次色"], ["tertiary", "第三色"]];

export const ROLE_SLOTS = [
    {
        key: "accent", label: "强调色", def: "primary",
        hint: "链接、按钮、@ 提及、开关等用的颜色。",
        options: CONTAINERS
    },
    {
        key: "selected", label: "选中项", def: "primary",
        hint: "会话列表、侧边栏、分段按钮里「当前选中」那一项的底色。",
        options: CONTAINERS
    },
    {
        key: "self", label: "自己的气泡", def: "primary",
        hint: "主色 / 次色 / 第三色是同明暗的柔和底色；实底是更鲜艳的主色；中性是和对方一样的玻璃；反相是旧版的样子（暗色主题里是浅色气泡）。",
        options: CONTAINERS.concat([["solid", "实底"], ["surface", "中性"], ["inverse", "反相"]])
    },
    {
        key: "others", label: "对方的气泡", def: "surface",
        hint: "中性是半透明玻璃，壁纸会透出来；选一个颜色就是实底。",
        options: [["surface", "中性"]].concat(CONTAINERS)
    }
];

export function defaultRoles() {
    const o = {};
    ROLE_SLOTS.forEach(s => { o[s.key] = s.def; });
    return o;
}

export function loadRoles() {
    const out = defaultRoles();
    try {
        const raw = JSON.parse(localStorage.getItem(ROLE_KEY) || "{}") || {};
        ROLE_SLOTS.forEach(s => {
            if (s.options.some(o => o[0] === raw[s.key])) out[s.key] = raw[s.key];
        });
    } catch (e) { /* 坏数据按默认 */ }
    return out;
}

export function saveRoles(roles) {
    try { localStorage.setItem(ROLE_KEY, JSON.stringify(roles)); } catch (e) {}
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* 强调色用哪条色调：M3 scheme.primary/secondary/tertiary 就是对应色调 40（亮）/ 80（暗） */
export function accentPalette(theme, roles) {
    const k = roles && roles.accent;
    return theme.palettes[k === "secondary" || k === "tertiary" ? k : "primary"];
}

/* container 角色 → [底, 字, 链接] */
function containerPair(mcu, s, k) {
    const hex = v => mcu.hexFromArgb(v);
    const link = k === "tertiary" ? s.primary : s.tertiary;
    return [hex(s[k + "Container"]), hex(s["on" + cap(k) + "Container"]), hex(link)];
}

/* 返回要写到 body 上的变量；值为 null 的表示删除（交给 CSS 默认） */
export function roleVars(mcu, theme, isDark, roles) {
    const s = isDark ? theme.schemes.dark : theme.schemes.light;
    const opp = isDark ? theme.schemes.light : theme.schemes.dark;
    const hex = v => mcu.hexFromArgb(v);
    const v = {};

    const sel = roles.selected || "primary";
    const sp = containerPair(mcu, s, sel === "secondary" || sel === "tertiary" ? sel : "primary");
    v["--ll-primary-container"] = sp[0];
    v["--ll-on-primary-container"] = sp[1];

    let self;
    switch (roles.self) {
        case "secondary": case "tertiary": self = containerPair(mcu, s, roles.self); break;
        case "solid": self = [hex(s.primary), hex(s.onPrimary), hex(s.onPrimary)]; break;
        case "surface": self = ["rgba(var(--ll-acrylic), 0.86)", "var(--ll-on-glass)", "var(--ll-brand)"]; break;
        case "inverse": self = [hex(opp.primaryContainer), hex(opp.onPrimaryContainer), hex(opp.tertiary)]; break;
        default: self = containerPair(mcu, s, "primary");
    }
    v["--ll-bubble-self"] = self[0];
    v["--ll-bubble-self-fg"] = self[1];
    v["--ll-bubble-self-link"] = self[2];

    if (roles.others === "primary" || roles.others === "secondary" || roles.others === "tertiary") {
        const o = containerPair(mcu, s, roles.others);
        v["--ll-bubble-other"] = o[0];
        v["--ll-bubble-other-fg"] = o[1];
        v["--ll-bubble-other-link"] = o[2];
    } else {
        v["--ll-bubble-other"] = null;
        v["--ll-bubble-other-fg"] = null;
        v["--ll-bubble-other-link"] = null;
    }
    return v;
}

/* ════════════════ 设置页 ════════════════ */
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

export function buildRoleControls(host, onChange) {
    const box = el("div", "liuli-roles");
    host.appendChild(box);
    box.appendChild(el("div", "liuli-panel__group", "配色"));
    box.appendChild(el("div", "liuli-field__hint", "颜色都从壁纸取色派生，这里决定每个位置用哪一种颜色。"));

    // 预览：直接用 body 上的气泡变量，改了立刻看得到
    const pv = el("div", "liuli-roles-preview");
    const other = el("div", "liuli-roles-bubble liuli-roles-bubble--other", "对方的消息");
    const self = el("div", "liuli-roles-bubble liuli-roles-bubble--self");
    self.appendChild(document.createTextNode("自己的消息 "));
    self.appendChild(el("span", "liuli-roles-link", "链接"));
    pv.appendChild(other);
    pv.appendChild(self);
    box.appendChild(pv);

    const roles = loadRoles();
    const segs = {};
    ROLE_SLOTS.forEach(slot => {
        const row = el("div", "liuli-wp-fit liuli-mode-row liuli-roles-row");
        row.appendChild(el("span", "", slot.label));
        const seg = el("div", "liuli-seg liuli-roles-seg");
        slot.options.forEach(([val, text]) => {
            const b = el("button", "liuli-seg__item", text);
            b.type = "button";
            b.dataset.v = val;
            b.addEventListener("click", () => {
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
        box.appendChild(el("div", "liuli-field__hint", slot.hint));
    });
    const reset = el("div", "liuli-field__hint liuli-lo-reset", "恢复默认配色");
    reset.addEventListener("click", () => {
        Object.assign(roles, defaultRoles());
        saveRoles(roles);
        draw();
        if (onChange) onChange(roles);
    });
    box.appendChild(reset);

    function draw() {
        ROLE_SLOTS.forEach(slot => {
            segs[slot.key].querySelectorAll(".liuli-seg__item").forEach(b => {
                b.classList.toggle("is-active", b.dataset.v === roles[slot.key]);
            });
        });
    }
    draw();
    // 别的窗口改了也跟着刷新按钮状态
    addEventListener("storage", e => {
        if (e.key !== ROLE_KEY) return;
        Object.assign(roles, loadRoles());
        draw();
    });
}
