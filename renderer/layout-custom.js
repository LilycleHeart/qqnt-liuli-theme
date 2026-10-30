// 琉璃 · 界面布局自定义
//   1. 右键菜单：简洁模式（只显示图标）+ 自定义排序（消息右键菜单）
//   2. 输入框：左侧按钮的数量和顺序，「更多」宫格里的顺序
//   3. 左侧边栏：隐藏不想要的按钮（空间、更多等）
// 设置存在 localStorage（设置窗口和主界面同源，storage 事件实时同步）。
// 菜单项、工具栏按钮、侧栏按钮都是运行时见到一个记一个（SEEN），设置页按这份名单列出来。

const KEY = "liuli-layout";
const SEEN_KEY = "liuli-layout-seen";
const DEFAULTS = { menuCompact: false, menuOrder: [], barOrder: [], barPinned: 1, navHidden: [] };

const ICON_UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>';
const ICON_SHOW = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
const ICON_HIDE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';

export function loadLayout() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveLayout(cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
    applyAll();
}
function loadSeen() {
    try { return Object.assign({ menu: [], bar: [], nav: [] }, JSON.parse(localStorage.getItem(SEEN_KEY) || "{}")); }
    catch (e) { return { menu: [], bar: [], nav: [] }; }
}
function remember(kind, labels) {
    const seen = loadSeen();
    const list = seen[kind];
    let changed = false;
    labels.forEach((l, i) => {
        if (!l || list.indexOf(l) >= 0) return;
        // 插在它在界面上前一个邻居的后面，名单顺序贴近原生顺序
        const prev = labels.slice(0, i).reverse().find(x => list.indexOf(x) >= 0);
        list.splice(prev ? list.indexOf(prev) + 1 : list.length, 0, l);
        changed = true;
    });
    if (changed) try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
}

/* 把用户排序和见过的名单合成最终顺序：用户排过的在前（按用户的顺序），没排过的按原生顺序接在后面 */
export function mergedOrder(order, seen) {
    const out = order.filter(x => seen.indexOf(x) >= 0);
    seen.forEach(x => { if (out.indexOf(x) < 0) out.push(x); });
    return out;
}

const norm = s => (s || "").replace(/\s*(Ctrl|Alt|Shift|⌘)[\s\S]*$/, "").replace(/\s+/g, " ").trim();

/* ════════════════ 1. 右键菜单 ════════════════ */
function menuLabel(item) {
    const t = item.querySelector(".q-context-menu-item__text");
    return norm(t ? t.textContent : item.textContent);
}

export function applyMenu(menu) {
    if (!menu || !menu.classList.contains("aio-right-click-menu")) return;
    const cfg = loadLayout();
    const items = [...menu.querySelectorAll(":scope > .q-context-menu-item")];
    const labels = items.map(menuLabel);
    remember("menu", labels);
    const order = cfg.menuOrder || [];
    menu.classList.toggle("liuli-menu-sorted", order.length > 0);
    items.forEach((it, i) => {
        if (it.title !== labels[i]) it.title = labels[i];         // 简洁模式下靠悬停提示认图标
        const k = order.indexOf(labels[i]);
        it.style.setProperty("order", String(k >= 0 ? k : 500 + i));
    });
}

function watchMenus() {
    // 菜单在右键之后才挂进来，挂上后连追几帧（复读之类的插件项也是之后才插进去的）
    document.addEventListener("contextmenu", () => {
        let n = 0;
        const tick = () => {
            document.querySelectorAll(".q-context-menu.aio-right-click-menu").forEach(applyMenu);
            if (++n < 20) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, true);
}

/* ════════════════ 2. 输入框按钮 ════════════════ */
function barIcons() {
    const bar = document.querySelector(".chat-input-area .chat-func-bar");
    if (!bar) return [];
    return [...bar.querySelectorAll(".bar-icon")].map(b => {
        const it = b.querySelector(":scope > .icon-item[aria-label]");
        return it ? { el: b, item: it, label: norm(it.getAttribute("aria-label")) } : null;
    }).filter(x => x && x.label);
}

export function barLayout() {
    const cfg = loadLayout();
    const seen = loadSeen().bar;
    const order = mergedOrder(cfg.barOrder || [], seen.length ? seen : ["表情"]);
    if (!cfg.barOrder || !cfg.barOrder.length) {
        // 没排过：保持琉璃原来的样子，「表情」放在输入框里
        const i = order.indexOf("表情");
        if (i > 0) { order.splice(i, 1); order.unshift("表情"); }
    }
    const pinned = Math.max(0, Math.min(order.length, Number(cfg.barPinned) || 0));
    return { order, pinned: order.slice(0, pinned) };
}

/* 宫格里的顺序和隐藏；返回要放进输入框的按钮名单 */
export function applyBar() {
    const icons = barIcons();
    if (!icons.length) return [];
    remember("bar", icons.map(x => x.label));
    const lay = barLayout();
    icons.forEach((x, i) => {
        const pin = lay.pinned.indexOf(x.label) >= 0;
        x.el.classList.toggle("liuli-pinned", pin);
        x.el.classList.toggle("liuli-in-menu", !pin);
        const k = lay.order.indexOf(x.label);
        x.el.style.setProperty("order", String(k >= 0 ? k : 500 + i));
    });
    return lay.pinned;
}

export function nativeBarItem(label) {
    const x = barIcons().find(y => y.label === label);
    return x ? x.item : null;
}

/* ════════════════ 3. 左侧边栏 ════════════════ */
function labelOf(n) {
    const own = n.getAttribute("aria-label");
    if (own) return own;
    const c = n.querySelector("[aria-label]");
    return c ? c.getAttribute("aria-label") : "";
}

function navEntries() {
    const out = [];
    document.querySelectorAll(".sidebar__nav > .nav-item").forEach(n => {
        const lab = norm(labelOf(n));
        if (lab) out.push({ el: n, key: "上:" + lab });
    });
    document.querySelectorAll(".sidebar__menu .func-menu__item").forEach(n => {
        const lab = norm(labelOf(n));
        if (lab) out.push({ el: n, key: "下:" + lab });
    });
    return out;
}

export function navName(key) {
    const [pos, lab] = [key.slice(0, 1), key.slice(2)];
    const dup = loadSeen().nav.filter(k => k.slice(2) === lab).length > 1;
    return dup ? lab + "（" + (pos === "上" ? "上方" : "底部") + "）" : lab;
}

export function applyNav() {
    const list = navEntries();
    if (!list.length) return;
    remember("nav", list.map(x => x.key));
    const hidden = loadLayout().navHidden || [];
    list.forEach(x => {
        const h = hidden.indexOf(x.key) >= 0;
        if (h) { if (x.el.dataset.liuliHide !== "1") x.el.dataset.liuliHide = "1"; }
        else if (x.el.dataset.liuliHide) delete x.el.dataset.liuliHide;
    });
}

/* ════════════════ 汇总 ════════════════ */
let onBarChange = null;
export function applyAll() {
    try {
        const cfg = loadLayout();
        document.body.toggleAttribute("data-liuli-menu-compact", !!cfg.menuCompact);
        applyNav();
        applyBar();
        document.querySelectorAll(".q-context-menu.aio-right-click-menu").forEach(applyMenu);
        if (onBarChange) onBarChange();
    } catch (e) { /* 静默 */ }
}

export function installLayout(barChanged) {
    onBarChange = barChanged;
    watchMenus();
    addEventListener("storage", e => { if (e.key === KEY) applyAll(); });
    applyAll();
}

/* ════════════════ 设置页 ════════════════ */
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}
function iconBtn(svg, title) {
    const b = el("button", "liuli-lo-btn");
    b.type = "button";
    b.title = title;
    b.innerHTML = svg;
    return b;
}
function seg(host, label, pairs, cur, onPick) {
    const row = el("div", "liuli-wp-fit liuli-mode-row");
    row.appendChild(el("span", "", label));
    const s = el("div", "liuli-seg");
    pairs.forEach(([v, t]) => {
        const b = el("button", "liuli-seg__item" + (v === cur ? " is-active" : ""), t);
        b.type = "button";
        b.addEventListener("click", () => { s.querySelectorAll(".liuli-seg__item").forEach(x => x.classList.toggle("is-active", x === b)); onPick(v); });
        s.appendChild(b);
    });
    row.appendChild(s);
    host.appendChild(row);
}

/* 可排序名单：每行 ↑ ↓；divider > 0 时在第 divider 行后画分界线 */
function sortList(host, items, opts) {
    const box = el("div", "liuli-lo-list");
    host.appendChild(box);
    function draw() {
        box.innerHTML = "";
        if (!items.length) { box.appendChild(el("div", "liuli-field__hint", opts.empty)); return; }
        items.forEach((name, i) => {
            if (opts.divider && i === opts.divider()) box.appendChild(el("div", "liuli-lo-divider", opts.dividerText));
            const row = el("div", "liuli-lo-row");
            if (opts.isOff && opts.isOff(name)) row.classList.add("is-off");
            row.appendChild(el("span", "liuli-lo-name", opts.nameOf ? opts.nameOf(name) : name));
            if (opts.sortable !== false) {
                const up = iconBtn(ICON_UP, "上移"), down = iconBtn(ICON_DOWN, "下移");
                up.disabled = i === 0;
                down.disabled = i === items.length - 1;
                up.addEventListener("click", () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); opts.onChange(items); draw(); });
                down.addEventListener("click", () => { items.splice(i + 1, 0, items.splice(i, 1)[0]); opts.onChange(items); draw(); });
                row.appendChild(up);
                row.appendChild(down);
            }
            if (opts.toggle) {
                const off = opts.isOff(name);
                const t = iconBtn(off ? ICON_HIDE : ICON_SHOW, off ? "已隐藏，点击显示" : "点击隐藏");
                t.addEventListener("click", () => { opts.toggle(name); draw(); });
                row.appendChild(t);
            }
            box.appendChild(row);
        });
        if (opts.divider && opts.divider() >= items.length) box.appendChild(el("div", "liuli-lo-divider", opts.dividerText));
    }
    draw();
    return draw;
}

export function buildLayoutControls(host) {
    const cfg = loadLayout();
    const seen = loadSeen();
    const save = () => saveLayout(cfg);

    /* 右键菜单 */
    host.appendChild(el("div", "liuli-panel__group", "右键菜单"));
    seg(host, "显示方式", [["0", "图标 + 文字"], ["1", "只显示图标"]], cfg.menuCompact ? "1" : "0", v => { cfg.menuCompact = v === "1"; save(); });
    host.appendChild(el("div", "liuli-field__hint", "调整消息右键菜单里各项的顺序。名单来自你右键过的消息，右键过图片、文件等消息后，对应的菜单项也会出现在这里。"));
    const menuItems = mergedOrder(cfg.menuOrder || [], seen.menu);
    sortList(host, menuItems, { empty: "先在聊天里右键一条消息，菜单项就会出现在这里。", onChange: list => { cfg.menuOrder = list.slice(); save(); } });
    const resetMenu = el("div", "liuli-field__hint liuli-lo-reset", "恢复默认顺序");
    resetMenu.addEventListener("click", () => { cfg.menuOrder = []; save(); rebuild(); });
    host.appendChild(resetMenu);

    /* 输入框 */
    host.appendChild(el("div", "liuli-panel__group", "输入框按钮"));
    const lay = barLayout();
    const barItems = lay.order.slice();
    if (!cfg.barOrder || !cfg.barOrder.length) cfg.barOrder = barItems.slice();
    const pinRow = el("div", "liuli-wp-fit liuli-mode-row");
    pinRow.appendChild(el("span", "", "输入框里显示的按钮数"));
    const stepper = el("div", "liuli-seg");
    const minus = el("button", "liuli-seg__item", "−");
    const num = el("span", "liuli-lo-num", "");
    const plus = el("button", "liuli-seg__item", "+");
    [minus, plus].forEach(b => { b.type = "button"; });
    stepper.appendChild(minus); stepper.appendChild(num); stepper.appendChild(plus);
    pinRow.appendChild(stepper);
    host.appendChild(pinRow);
    host.appendChild(el("div", "liuli-field__hint", "分界线上面的按钮放在输入框里，下面的收进「更多」。用箭头调顺序，把按钮挪过分界线就换了位置。"));
    let pinned = lay.pinned.length;
    const drawBar = sortList(host, barItems, {
        empty: "先打开一个聊天，输入框的按钮就会出现在这里。",
        divider: () => pinned,
        dividerText: "以上在输入框 · 以下在「更多」",
        onChange: list => { cfg.barOrder = list.slice(); save(); },
    });
    const syncNum = () => {
        num.textContent = String(pinned);
        minus.disabled = pinned <= 0;
        plus.disabled = pinned >= Math.min(6, barItems.length);
    };
    minus.addEventListener("click", () => { if (pinned > 0) { pinned--; cfg.barPinned = pinned; save(); syncNum(); drawBar(); } });
    plus.addEventListener("click", () => { if (pinned < Math.min(6, barItems.length)) { pinned++; cfg.barPinned = pinned; save(); syncNum(); drawBar(); } });
    syncNum();
    const resetBar = el("div", "liuli-field__hint liuli-lo-reset", "恢复默认");
    resetBar.addEventListener("click", () => { cfg.barOrder = []; cfg.barPinned = 1; save(); rebuild(); });
    host.appendChild(resetBar);

    /* 左侧边栏 */
    host.appendChild(el("div", "liuli-panel__group", "左侧边栏"));
    host.appendChild(el("div", "liuli-field__hint", "点眼睛图标隐藏或显示侧边栏上的按钮。"));
    sortList(host, seen.nav.slice(), {
        sortable: false,
        empty: "主界面打开后，侧边栏按钮就会出现在这里。",
        nameOf: navName,
        isOff: k => (cfg.navHidden || []).indexOf(k) >= 0,
        toggle: k => {
            const h = cfg.navHidden || (cfg.navHidden = []);
            const i = h.indexOf(k);
            if (i >= 0) h.splice(i, 1); else h.push(k);
            save();
        },
    });

    function rebuild() {
        host.innerHTML = "";
        buildLayoutControls(host);
    }
}

export function buildLayoutSection(host) {
    const box = el("div", "liuli-lo");
    host.appendChild(box);
    buildLayoutControls(box);
}
