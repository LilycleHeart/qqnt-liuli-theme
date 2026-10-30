// 琉璃主题插件 · 渲染进程侧
// 1) 同步路由作用域（592 条规则依赖 data-hash）
// 2) 注入 CSS：壁纸 → QQ token 打透 → 静态色板兜底 → 外观
// 3) 从壁纸取源色，用 MCU 实时派生 M3 色板（跟随壁纸）
// 4) 顽固容器内联覆盖 + 对比度修复

const SLUG = "liuli-dsh-theme";
const ASSET_BASE = "local://profile/plugins/" + SLUG + "/assets/";
const FILES = ["wallpaper.css", "qq-tokens.css", "palette.css", "liuli.css", "typography.css", "panel.css", "settings-page.css", "details.css", "no-dividers.css", "input-bar.css", "bubbles.css", "layout.css", "lists.css", "motion.css", "markdown.css"];
const STYLE_ID = "liuli-dsh-theme";
const WALLPAPER = ASSET_BASE + "wallpaper.jpg";
// 默认壁纸不随插件发布：assets/wallpaper.css（内联壁纸）和 assets/wallpaper.jpg（取色用）
// 都是可选的本地文件。没有时没有默认壁纸，取色回退 DEFAULT_SOURCE，在设置页选图即可。
const OPTIONAL_FILES = new Set(["wallpaper.css"]);
const DEFAULT_SOURCE = "#1d9bf0";

/* ---------- 路由作用域 ---------- */
function installRouteScope() {
    if (window.__liuliRouteScope) return;
    window.__liuliRouteScope = true;
    const body = document.body;
    const sync = () => {
        const hash = location.hash || "";
        const path = location.pathname || "";
        if (body.dataset.hash !== hash) body.dataset.hash = hash;
        if (body.dataset.pathname !== path) body.dataset.pathname = path;
        body.style.setProperty("--hash", hash);
        body.style.setProperty("--pathname", path);
        const scope = hash.indexOf("#/setting") === 0 ? "setting"
            : hash.indexOf("#/main") === 0 ? "main"
            : (hash === "" || hash === "#/blank") ? "boot" : "aux";
        if (body.dataset.liuliScope !== scope) body.dataset.liuliScope = scope;
    };
    sync();
    addEventListener("hashchange", sync);
    addEventListener("popstate", sync);
    setInterval(sync, 400);
}

/* ---------- 壁纸取色（照搬 dsh liuli-runtime.ts） ----------
 * 缩到 64×64，挑"最鲜艳且不太暗/太亮"的像素作为源色。
 * 原项目还会再和 MCU 的 sourceColorFromImage 比对色度，取更鲜艳的那个；
 * 这里简化为只用 chromatics，效果等价且不依赖额外 API。
 */
function chromaticSourceFromCanvas(ctx, w, h) {
    let px;
    try { px = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    let best = { r: 29, g: 155, b: 240, score: -1 };
    for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
        if (a < 128) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const chroma = max - min;
        const l = (max + min) / 2;
        if (l < 35 || l > 220) continue;
        const score = chroma - Math.abs(l - 128) * 0.4;
        if (score > best.score) best = { r, g, b, score };
    }
    const hex = v => v.toString(16).padStart(2, "0");
    return "#" + hex(best.r) + hex(best.g) + hex(best.b);
}

function chromaOf(hex) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return Math.max(r, g, b) - Math.min(r, g, b);
}

async function extractSource() {
    const img = new Image();
    // 用户选过壁纸就从那张取色；之前固定读插件自带的 wallpaper.jpg，
    // 换了壁纸主题色也不变（"没有自动取色"）。
    let src = WALLPAPER;
    try {
        const st = loadWallpaperState();
        if (st && st.src) src = st.src;
    } catch (e) {}
    img.src = src;
    if (img.decode) { await img.decode(); } else {
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    }
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return DEFAULT_SOURCE;
    ctx.drawImage(img, 0, 0, size, size);
    const picked = chromaticSourceFromCanvas(ctx, size, size);
    if (!picked) return DEFAULT_SOURCE;
    // 太灰就回退默认蓝（与 liuli-palette 的 chromaOf >= 24 判据一致）
    return chromaOf(picked) >= 24 ? picked : DEFAULT_SOURCE;
}

/* ---------- MCU 派生 M3 色板（照搬 liuli-palette.ts） ---------- */
const SURFACE_TONES = {
    light: { appBg: 98, low: 96, mid: 94, high: 92, highest: 90 },
    dark: { appBg: 6, low: 10, mid: 12, high: 17, highest: 22 }
};
const SCRIM = { low: 0.05, mid: 0.08, high: 0.11, highest: 0.14 };

function rgbTriplet(hex) {
    const h = hex.replace("#", "");
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(", ");
}

function alphaComposite(fg, bg, a) {
    const ph = fg.replace("#", ""), bh = bg.replace("#", "");
    const out = [0, 2, 4].map(i => {
        const p = parseInt(ph.slice(i, i + 2), 16);
        const b = parseInt(bh.slice(i, i + 2), 16);
        return Math.round(a * p + (1 - a) * b).toString(16).padStart(2, "0");
    });
    return "#" + out.join("");
}

function deriveVars(mcu, sourceHex, isDark) {
    const theme = mcu.themeFromSourceColor(mcu.argbFromHex(sourceHex));
    const s = isDark ? theme.schemes.dark : theme.schemes.light;
    const tp = theme.palettes.primary;
    const neutral = theme.palettes.neutral;
    const nv = theme.palettes.neutralVariant;
    const st = SURFACE_TONES[isDark ? "dark" : "light"];
    const sc = t => mcu.hexFromArgb(neutral.tone(t));
    const primary = mcu.hexFromArgb(s.primary);
    const cLow = sc(st.low), cMid = sc(st.mid), cHigh = sc(st.high), cHighest = sc(st.highest);

    return {
        "--ll-brand": primary,
        "--ll-brand-rgb": rgbTriplet(primary),
        "--ll-brand-hover": mcu.hexFromArgb(tp.tone(isDark ? 76 : 44)),
        "--ll-brand-pressed": mcu.hexFromArgb(tp.tone(isDark ? 84 : 36)),
        "--ll-brand-tint": mcu.hexFromArgb(tp.tone(isDark ? 24 : 90)),
        "--ll-brand-weak": mcu.hexFromArgb(tp.tone(isDark ? 32 : 88)),
        "--ll-brand-line": mcu.hexFromArgb(tp.tone(isDark ? 48 : 60)),
        "--ll-on-brand": mcu.hexFromArgb(s.onPrimary),
        "--ll-secondary": mcu.hexFromArgb(s.secondary),
        "--ll-tertiary": mcu.hexFromArgb(s.tertiary),
        "--ll-tertiary-container": mcu.hexFromArgb(s.tertiaryContainer),
        "--ll-on-tertiary-container": mcu.hexFromArgb(s.onTertiaryContainer),
        "--ll-secondary-container": mcu.hexFromArgb(s.secondaryContainer),
        "--ll-on-secondary-container": mcu.hexFromArgb(s.onSecondaryContainer),
        "--ll-on-glass": mcu.hexFromArgb(s.onSurface),
        "--ll-on-glass-rgb": rgbTriplet(mcu.hexFromArgb(s.onSurface)),
        "--ll-on-glass-2": mcu.hexFromArgb(s.onSurfaceVariant),
        "--ll-on-glass-2-rgb": rgbTriplet(mcu.hexFromArgb(s.onSurfaceVariant)),
        "--ll-on-glass-3": mcu.hexFromArgb(nv.tone(isDark ? 66 : 40)),
        "--ll-on-glass-4": mcu.hexFromArgb(s.outlineVariant),
        "--ll-app-bg": sc(st.appBg),
        "--ll-surface-low": cLow,
        "--ll-surface-mid": cMid,
        "--ll-surface-high": cHigh,
        "--ll-surface-highest": cHighest,
        "--ll-surface-1": alphaComposite(primary, cLow, SCRIM.low),
        "--ll-surface-2": alphaComposite(primary, cMid, SCRIM.mid),
        "--ll-surface-3": alphaComposite(primary, cHigh, SCRIM.high),
        "--ll-surface-4": alphaComposite(primary, cHighest, SCRIM.highest),
        // 与 DSH liuli-runtime 一致：亚克力底取壁纸派生的 bg2/bg1/bg4（带品牌色相），
        // 之前这里没写，--ll-acrylic 停在静态蓝灰 30,37,48，和粉色品牌色对不上。
        "--ll-acrylic": rgbTriplet(alphaComposite(primary, cMid, SCRIM.mid)),
        "--ll-acrylic-low": rgbTriplet(alphaComposite(primary, cLow, SCRIM.low)),
        "--ll-acrylic-high": rgbTriplet(alphaComposite(primary, cHighest, SCRIM.highest)),
        "--ll-stroke-1": mcu.hexFromArgb(s.outline),
        "--ll-stroke-2": mcu.hexFromArgb(s.outlineVariant),
        // DSH border-l1 = stroke3（nv tone 40 / 90）：卡片发丝线
        "--ll-stroke-3": mcu.hexFromArgb(nv.tone(isDark ? 40 : 90)),
        // DSH 侧栏选中项 = primaryContainer + onPrimaryContainer 指示条
        "--ll-primary-container": mcu.hexFromArgb(s.primaryContainer),
        "--ll-on-primary-container": mcu.hexFromArgb(s.onPrimaryContainer),
        "--ll-popup-bg": isDark ? sc(st.high) : sc(st.highest),
        "--ll-danger": mcu.hexFromArgb(s.error),
        "--ll-danger-rgb": rgbTriplet(mcu.hexFromArgb(s.error)),
        "--ll-danger-bg": mcu.hexFromArgb(s.errorContainer),
        "--ll-success": mcu.hexFromArgb(s.tertiary),
        "--ll-warn": mcu.hexFromArgb(s.tertiaryContainer)
    };
}

async function applyDynamicPalette() {
    if (window.__liuliPaletteApplied) return;
    window.__liuliPaletteApplied = true;
    let source = DEFAULT_SOURCE;
    try { source = await extractSource(); } catch (e) { source = DEFAULT_SOURCE; }
    const mcu = await import(ASSET_BASE + "mcu.js");
    const isDark = llIsDark();
    const vars = deriveVars(mcu, source, isDark);
    // 自己的气泡：照搬 DSH bubblePal —— 取「相反明暗」方案的 primaryContainer，
    // 暗色主题下是浅色气泡 + 深字，对比度由 M3 保证。
    try {
        const opp = mcu.themeFromSourceColor(mcu.argbFromHex(source)).schemes[isDark ? "light" : "dark"];
        vars["--ll-bubble-self"] = mcu.hexFromArgb(opp.primaryContainer);
        vars["--ll-bubble-self-fg"] = mcu.hexFromArgb(opp.onPrimaryContainer);
    } catch (e) {}
    const body = document.body;
    for (const k in vars) body.style.setProperty(k, vars[k]);
    body.dataset.liuliSource = source;
    console.log("[liuli-dsh-theme] wallpaper source = " + source + " (brand " + vars["--ll-brand"] + ")");
}

/* ---------- 承载层：只这些允许挂玻璃 ---------- */
const GLASS = [
    [".container-sidebar", "var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))"],
    [".recent-contact", "var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))"],
    // .chat-header 不加材质（群聊标题栏保持通透）
    // .chat-input-area 也不加！它的 backdrop-filter 是内联写入的，
    // 会让内部的 .msg-input（ProseMirror 编辑器）完全不绘制 ——
    // 表现就是"输入框消失、点了没反应"。输入区背景改由 input-bar.css 提供。
    [".right-sidebar", "var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))"],
    [".group-box", "var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))"],
    // 左下角资料卡；必须排除 .topbar-profile（顶部同名元素宽 1797px）
    [".user-profile-card:not(.topbar-profile)", "var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))"]
];
const CLEAR = [
    ".message-panel", ".container-content-view", ".two-col-layout",
    ".two-col-layout__aside", ".two-col-layout__main", ".aio", ".group-chat",
    ".chat-msg-area",
    ".sidebar-nav", ".sidebar-wrapper",
    ".group-panel", ".group-box__container", ".group-box__wrapper",
    ".group-notice", ".group-member", ".group-user", ".group-member-list"
];

/* ---------- 颜色归一化 ----------
 * QQ 有大量规则直接写死颜色（不走 token），实测高频：
 *   rgba(255,255,255,0.9)  ×240   主文字
 *   rgba(255,255,255,0.4)  ×46
 *   rgba(255,255,255,0.7)  ×28   图标
 *   rgb(128,128,128)       ×若干  次要文字
 *   rgb(0,102,204)         tab 遮罩 / 发送按钮
 *   rgb(247,76,48)         红点
 * 这些只能靠内联改写。只改 color（不改背景），且只处理叶子节点，
 * 纯白 rgb(255,255,255) 不动 —— 那通常是品牌色实底上的正确反色。
 */
const QQ_COLOR_MAP = {
    "rgba(255, 255, 255, 0.9)": "var(--ll-on-glass)",
    "rgba(255, 255, 255, 0.8)": "var(--ll-on-glass)",
    "rgba(255, 255, 255, 0.7)": "var(--ll-on-glass-2)",
    "rgba(255, 255, 255, 0.6)": "var(--ll-on-glass-2)",
    "rgba(255, 255, 255, 0.5)": "var(--ll-on-glass-3)",
    "rgba(255, 255, 255, 0.4)": "var(--ll-on-glass-3)",
    "rgba(255, 255, 255, 0.3)": "var(--ll-on-glass-3)",
    "rgb(128, 128, 128)": "var(--ll-on-glass-2)",
    "rgb(102, 102, 102)": "var(--ll-on-glass-2)",
    "rgb(153, 153, 153)": "var(--ll-on-glass-2)",
    "rgb(204, 204, 204)": "var(--ll-on-glass-3)",
    "rgb(0, 102, 204)": "var(--ll-brand)",
    "rgb(45, 119, 229)": "var(--ll-brand)",
    "rgb(0, 153, 255)": "var(--ll-brand)",
    "rgb(247, 76, 48)": "var(--ll-danger)",
    "rgb(255, 51, 82)": "var(--ll-danger)",
    "rgb(21, 209, 115)": "var(--ll-success)",
    "rgb(255, 179, 0)": "var(--ll-warn)"
};

/* 性能护栏（2026-10-29）：发起群聊的选人对话框一次挂上几千个节点，
 * 原来每 1.5 秒对全页每个叶子节点 getComputedStyle，主线程被拖死。
 * 现在：每个节点只检查一次（WeakSet），每轮最多花 8ms，剩下的下一轮接着做。 */
const llColorSeen = new WeakSet();
function normalizeColors() {
    try {
        const t0 = performance.now();
        const nodes = document.querySelectorAll("body *");
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (llColorSeen.has(el)) continue;
            llColorSeen.add(el);
            if (el.dataset.liuliColor) continue;
            if (el.children.length > 0) continue;
            const text = (el.textContent || "").trim();
            if (!text) continue;
            const color = getComputedStyle(el).color.replace(/\s+/g, " ").trim();
            const mapped = QQ_COLOR_MAP[color];
            if (mapped) {
                el.dataset.liuliColor = "1";
                el.style.setProperty("color", mapped, "important");
            }
            if ((i & 63) === 0 && performance.now() - t0 > 8) return;
        }
    } catch (e) { /* 静默 */ }
}

const DIM_COLORS = new Set([
    "rgb(128, 128, 128)", "rgb(102, 102, 102)", "rgb(153, 153, 153)"
]);
const TEXT_SELECTORS = [
    ".text-ellipsis", ".secondary-info", ".group-user__name", ".group-member-name",
    ".group-member .user-name", ".recent-contact-item .text-ellipsis",
    ".contact-name", ".summary-main"
];

function fixContrast() {
    try {
        for (const sel of TEXT_SELECTORS) {
            document.querySelectorAll(sel).forEach(el => {
                if (el.dataset.liuliFg) return;
                const color = getComputedStyle(el).color.replace(/\s+/g, " ").trim();
                if (!DIM_COLORS.has(color)) return;
                el.dataset.liuliFg = "1";
                el.style.setProperty("color", "var(--ll-on-glass-2)", "important");
            });
        }
    } catch (e) { /* 静默 */ }
}

function applyOverrides() {
    try {
        for (const [sel, bg] of GLASS) {
            document.querySelectorAll(sel).forEach(el => {
                if (el.dataset.liuliGlass) return;
                el.dataset.liuliGlass = "1";
                el.style.setProperty("background", bg, "important");
                el.style.setProperty("backdrop-filter", "var(--ll-material-blur)", "important");
                el.style.setProperty("-webkit-backdrop-filter", "var(--ll-material-blur)", "important");
                el.style.setProperty("border-radius", "var(--ll-radius)", "important");
            });
        }
        for (const sel of CLEAR) {
            document.querySelectorAll(sel).forEach(el => {
                if (el.dataset.liuliClear) return;
                el.dataset.liuliClear = "1";
                el.style.setProperty("background", "transparent", "important");
                el.style.setProperty("backdrop-filter", "none", "important");
                el.style.setProperty("-webkit-backdrop-filter", "none", "important");
            });
        }
    } catch (e) { /* 静默 */ }
}

async function loadText(name) {
    const response = await fetch(ASSET_BASE + name);
    if (!response.ok) throw new Error(name + " HTTP " + response.status);
    return await response.text();
}

function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(el);
    }
    return el;
}

const SETTINGS_KEY = SLUG;
const DEFAULT_SETTINGS = { blur: 18, opacity: 0.5, glow: 0.15, shadow: 0.6, dim: 0.18 };

async function loadSettings() {
    try {
        const cfg = await LiteLoader.api.config.get(SETTINGS_KEY, DEFAULT_SETTINGS);
        return Object.assign({}, DEFAULT_SETTINGS, cfg || {});
    } catch (e) {
        return Object.assign({}, DEFAULT_SETTINGS);
    }
}

function saveSettings(cfg) {
    try {
        LiteLoader.api.config.set(SETTINGS_KEY, cfg);
    } catch (e) {}
}

/* 设置页窗口和主界面是两个独立 webContents，
 * 面板滑条改的只是设置页那一个窗口的 body 变量，主界面看不到。
 * 所以每次应用都把配置写进 localStorage，
 * 其它窗口靠 storage 事件收到后自行应用（同源，实时）。 */
const LL_STORAGE_KEY = "liuli-dsh-settings";
let llSuppressBroadcast = false;

function applySettings(cfg, broadcast) {
    const b = document.body;
    b.style.setProperty("--ll-material-blur", "blur(" + cfg.blur + "px) saturate(1.6)");
    b.style.setProperty("--ll-material-opacity", String(cfg.opacity));
    b.style.setProperty("--ll-glow-strength", String(cfg.glow));
    b.style.setProperty("--ll-shadow", "0 2px 10px rgba(var(--ll-shadow-rgb), " + (cfg.shadow * 0.4).toFixed(2) + ")");
    b.style.setProperty("--ll-shadow-float", "0 8px 28px rgba(var(--ll-shadow-rgb), " + (cfg.shadow * 0.47).toFixed(2) + ")");
    b.style.setProperty("--ll-wallpaper-dim", String(cfg.dim === undefined ? 0.18 : cfg.dim));

    if (broadcast !== false && !llSuppressBroadcast) {
        try { localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }
}

// 其它窗口的改动（含主界面自己收到设置页的改动）
try {
    window.addEventListener("storage", function (e) {
        if (e.key !== LL_STORAGE_KEY || !e.newValue) return;
        try {
            const incoming = JSON.parse(e.newValue);
            llSuppressBroadcast = true;
            applySettings(incoming, false);
            // 面板若存在，同步滑条位置
            const sliders = document.querySelectorAll(".liuli-slider");
            if (sliders.length === FIELDS.length) {
                FIELDS.forEach(function (f, i) {
                    const el = sliders[i];
                    if (el && Number(el.value) !== Number(incoming[f.key])) {
                        el.value = incoming[f.key];
                        el.dispatchEvent(new Event("input"));
                    }
                });
            }
        } catch (err) {
        } finally {
            llSuppressBroadcast = false;
        }
    });
} catch (e) { /* 静默 */ }

const FIELDS = [
    { key: "blur", label: "材质模糊", min: 0, max: 40, step: 1, unit: "px", hint: "玻璃层的 backdrop-filter 半径" },
    { key: "opacity", label: "不透明度", min: 0.1, max: 0.9, step: 0.01, unit: "", hint: "亚克力底的 alpha，越高越实", pct: v => ((v - 0.1) / 0.8) * 100 },
    { key: "glow", label: "泛光强度", min: 0, max: 1, step: 0.01, unit: "", hint: "品牌色在边缘的发光量", pct: v => v * 100 },
    { key: "shadow", label: "阴影强度", min: 0, max: 1, step: 0.01, unit: "", hint: "玻璃卡片的投影浓度", pct: v => v * 100 },
    { key: "dim", label: "壁纸压暗", min: 0, max: 0.8, step: 0.01, unit: "", hint: "壁纸上的黑色遮罩浓度，越高文字越好读", pct: v => (v / 0.8) * 100 }
];

function toast(text) {
    let el = document.getElementById("liuli-toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "liuli-toast";
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 1600);
}

/* ---------- 窗口控制按钮 ----------
 * QQ 给 .window-control-area 写了内联 !important：
 *   opacity: 0 !important; pointer-events: none !important; transform: translateY(-4px) !important
 * CSS 的 !important 打不过内联的 !important，只能由 JS 直接改内联属性。
 * 每次 QQ 重新写回 0 都要再纠正一次，所以挂在 1.5s 的定时器上。
 */
/* 窗口按钮现在由 layout.css 做「常态隐藏、指向唤出」，
 * 这里不能再内联 opacity:1 !important（内联 !important 会压过样式表，胶囊永远不隐藏）。
 * 只负责清掉旧版本留下的内联值。 */
function keepWindowControlsVisible() {
    try {
        const wc = document.querySelector(".window-control-area");
        if (!wc) return;
        ["opacity", "pointer-events", "transform"].forEach(function (k) {
            if (wc.style.getPropertyPriority(k) === "important") wc.style.removeProperty(k);
        });
    } catch (e) { /* 静默 */ }
}

/* ---------- 左侧设置导航：运行时求共同祖先，整条一块卡片 ----------
 * QQ 把设置导航拆成了多个容器（原生项一组、LiteLoaderQQNT 一组），
 * 用 class 选择器命中就会得到"上下两块卡片"。
 * 这里不猜类名：先找出所有导航行，再求它们的最低共同祖先，
 * 只给那一层加材质，并把中间层的材质清掉。
 */
const NAV_LABELS = ["通用", "消息通知", "存储管理", "快捷键", "权限设置", "登录设置",
    "账号绑定与授权", "超级调色盘", "关于QQ", "琉璃 · 电波推送", "LiteLoaderQQNT"];

function applyNavCard() {
    if (!location.hash || location.hash.indexOf("#/setting") !== 0) return;
    try {
        // 1) 收集导航行
        const rows = [];
        const nodes = document.querySelectorAll("*");
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (el.children.length > 1) continue;
            const t = (el.textContent || "").trim();
            if (NAV_LABELS.indexOf(t) < 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 8 || r.x > 340) continue;
            let row = el;
            for (let d = 0; d < 5 && row; d++) {
                const rr = row.getBoundingClientRect();
                if (rr.width > 100 && rr.height >= 24 && rr.height <= 64) break;
                row = row.parentElement;
            }
            if (row && rows.indexOf(row) < 0) rows.push(row);
        }
        if (rows.length < 2) return;

        // 2) 求最低共同祖先
        const anc = [];
        let x = rows[0];
        while (x && x !== document.body && x !== document.documentElement) { anc.push(x); x = x.parentElement; }
        let common = null;
        for (const a of anc) {
            let all = true;
            for (const r of rows) { if (!a.contains(r)) { all = false; break; } }
            if (all) { common = a; break; }
        }
        if (!common) return;

        // 3) 只给共同祖先加材质（打标避免每轮重写）
        if (!common.dataset.liuliNavCard) {
            common.dataset.liuliNavCard = "1";
            common.style.setProperty("background", "rgba(var(--ll-acrylic), var(--ll-material-opacity))", "important");
            common.style.setProperty("backdrop-filter", "var(--ll-material-blur)", "important");
            common.style.setProperty("-webkit-backdrop-filter", "var(--ll-material-blur)", "important");
            common.style.setProperty("border-radius", "var(--ll-radius)", "important");
            common.style.setProperty("box-shadow", "var(--ll-shadow)", "important");
            common.style.setProperty("padding", "10px", "important");
            common.style.setProperty("margin", "44px 0 28px 24px", "important");
            common.style.setProperty("box-sizing", "border-box", "important");
            common.style.setProperty("overflow", "hidden auto", "important");
        }

        // 4) 清掉共同祖先与导航行之间的中间层材质（不然就是叠玻璃）
        for (const r of rows) {
            let n = r.parentElement;
            while (n && n !== common) {
                n.style.setProperty("background", "transparent", "important");
                n.style.setProperty("backdrop-filter", "none", "important");
                n.style.setProperty("-webkit-backdrop-filter", "none", "important");
                n.style.setProperty("box-shadow", "none", "important");
                n = n.parentElement;
            }
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 设置页：整层模糊（保守版） ----------
 * 教训：上一版把内部所有大块容器的 background 都清成 transparent，
 * 结果壁纸直接透上来，文字完全不可读（root 的 backdrop-filter 也没兜住）。
 *
 * 现在只做一件事：给设置页整层加一层半透明 + 模糊。
 * 内部容器一律不动 —— 保留 QQ 自己的深色卡片，保证文字可读。
 */
const SETTINGS_NAV_LABELS = ["通用", "消息通知", "存储管理", "快捷键", "权限设置",
    "登录设置", "账号绑定与授权", "超级调色盘", "关于QQ", "琉璃 · 电波推送", "LiteLoaderQQNT"];

function settingsPageBlur() {
    if (!location.hash || location.hash.indexOf("#/setting") !== 0) return;
    try {
        let anchor = null;
        const nodes = document.querySelectorAll("*");
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (el.children.length > 1) continue;
            const t = (el.textContent || "").trim();
            if (SETTINGS_NAV_LABELS.indexOf(t) < 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.x > 340) continue;
            anchor = el;
            break;
        }
        if (!anchor) return;

        let root = anchor;
        while (root.parentElement && root.parentElement !== document.body) {
            root = root.parentElement;
        }
        if (!root || root === document.body) return;

        if (!root.dataset.liuliSettingsBlur) {
            const r = root.getBoundingClientRect();
            // 只有在根容器确实覆盖了窗口主体时才动手，避免命中一个局部容器
            if (r.width < innerWidth * 0.6 || r.height < innerHeight * 0.6) return;
            root.dataset.liuliSettingsBlur = "1";
            root.style.setProperty("background", "rgba(var(--ll-acrylic), 0.5)", "important");
            root.style.setProperty("backdrop-filter", "blur(24px) saturate(1.6)", "important");
            root.style.setProperty("-webkit-backdrop-filter", "blur(24px) saturate(1.6)", "important");
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 输入区：TG 式单行 ----------
 * ⚠️ 关键教训：按钮千万不能挂进 .chat-input-area。
 * 那是 Vue 管理的子树，每次重渲染都会把外部节点清掉，
 * 于是按钮"时隐时现、点不到"。
 *
 * 现在做一层独立覆盖：#liuli-input-overlay 挂在 body 下，
 * position:fixed，每次 tick 只同步坐标，按钮本身建一次就不再动。
 */
const ICON_EMOJI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle>' +
    '<path d="M8 14s1.5 2 4 2 4-2 4-2"></path>' +
    '<line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line>' +
    '<line x1="5" y1="12" x2="19" y2="12"></line></svg>';

function buildInputOverlay() {
    var overlay = document.getElementById("liuli-input-overlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "liuli-input-overlay";
    overlay.style.cssText = [
        "position:fixed", "z-index:9999", "display:none", "align-items:center",
        "gap:4px", "pointer-events:none"
    ].join(";");

    // 表情
    var emoji = document.createElement("button");
    emoji.id = "liuli-emoji-btn";
    emoji.type = "button";
    emoji.title = "表情";
    emoji.setAttribute("aria-label", "表情");
    emoji.innerHTML = ICON_EMOJI;
    emoji.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var native = document.querySelector('.chat-func-bar .icon-item[aria-label="表情"], .chat-func-bar .icon-item[title="表情"]');
        if (native) {
            native.click();
            emoji.dataset.open = emoji.dataset.open === "1" ? "0" : "1";
        }
    });

    // 更多
    var more = document.createElement("button");
    more.id = "liuli-func-toggle";
    more.type = "button";
    more.title = "更多";
    more.setAttribute("aria-label", "更多");
    more.innerHTML = ICON_PLUS;
    more.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        // 悬停已经展开，点击只负责"保持展开"，不再 toggle（否则悬停后一点反而收起）
        setExpanded(true);
    });

    // 「更多」在左、「表情」在右（用户要求对调）
    overlay.appendChild(more);
    overlay.appendChild(emoji);
    document.body.appendChild(overlay);

    // 指向展开：悬停 + 打开工具栏；离开按钮和工具栏 250ms 后收起。
    // 工具栏节点会被 Vue 重建，所以每次都重新查询，监听挂在 document 上。
    var hoverTimer = 0;
    function setExpanded(open) {
        var bar = document.querySelector(".chat-func-bar");
        if (!bar) return;
        // 按钮状态先同步：工具栏节点可能被 Vue 重建，下面提前 return 时按钮也不能停在 ×
        more.dataset.open = open ? "1" : "0";
        more.title = open ? "收起" : "更多";
        if (open) llLabelFuncBar(bar);
        if (bar.classList.contains("liuli-expanded") === open) return;
        bar.classList.toggle("liuli-expanded", open);
        var area = document.querySelector(".chat-input-area");
        if (area) {
            if (open) area.style.setProperty("z-index", "40", "important");
            else area.style.removeProperty("z-index");
        }
    }
    function isHoverZone(t) {
        if (!t || !t.closest) return false;
        return !!(t.closest("#liuli-func-toggle") || t.closest(".chat-func-bar.liuli-expanded"));
    }
    document.addEventListener("mouseover", function (e) {
        if (isHoverZone(e.target)) {
            clearTimeout(hoverTimer);
            if (e.target.closest("#liuli-func-toggle")) setExpanded(true);
        }
    }, true);
    document.addEventListener("mouseout", function (e) {
        if (!isHoverZone(e.target)) return;
        if (isHoverZone(e.relatedTarget)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () { setExpanded(false); }, 250);
    }, true);

    // 点别处收起工具栏
    document.addEventListener("mousedown", function (e) {
        var bar = document.querySelector(".chat-func-bar");
        if (!bar || !bar.classList.contains("liuli-expanded")) return;
        if (bar.contains(e.target) || more.contains(e.target) || emoji.contains(e.target)) return;
        bar.classList.remove("liuli-expanded");
        more.dataset.open = "0";
        more.title = "更多";
        var area = document.querySelector(".chat-input-area");
        if (area) area.style.removeProperty("z-index");
    }, true);

    return overlay;
}

/* 工具栏改成竖排菜单后每行要显示文字：取 aria-label，去掉快捷键后缀
 * （"截图 Ctrl + Alt + A" → "截图"）。CSS 用 attr(data-liuli-label) 画出来。 */
function llLabelFuncBar(bar) {
    try {
        bar = bar || document.querySelector(".chat-func-bar");
        if (!bar) return;
        bar.querySelectorAll(".icon-item[aria-label]").forEach(function (it) {
            var t = (it.getAttribute("aria-label") || "").replace(/\s*(Ctrl|Alt|Shift|⌘)[\s\S]*$/, "").trim();
            if (it.dataset.liuliLabel !== t) it.dataset.liuliLabel = t;
        });
    } catch (e) { /* 静默 */ }
}

/* 每次 tick 只同步位置，不动按钮节点 */
function mountInputBar() {
    try {
        var overlay = buildInputOverlay();
        var area = document.querySelector(".chat-input-area");
        if (!area) {
            overlay.style.display = "none";
            return;
        }
        var r = area.getBoundingClientRect();
        if (r.width < 100 || r.height < 20 || r.bottom < 0 || r.top > window.innerHeight) {
            overlay.style.display = "none";
            return;
        }
        overlay.style.display = "flex";
        // 贴输入框左下角：多行时按钮留在底行（TG 行为），不漂到中间
        var box = area.querySelector(".msg-input");
        var br = box ? box.getBoundingClientRect() : r;
        overlay.style.left = Math.round(br.left + 6) + "px";
        overlay.style.top = Math.round(br.bottom - 6 - 28) + "px";

        // 状态跟随实际，而不是相信本地记录：
        // 工具栏可能被"点别处收起"或 QQ 自己移除，local 的 data-open 会失真，
        // 表现就是按钮显示成 × 但工具栏其实没开。
        var bar = document.querySelector(".chat-func-bar");
        var expanded = !!(bar && bar.classList.contains("liuli-expanded"));
        var moreBtn = overlay.querySelector("#liuli-func-toggle");
        if (moreBtn && moreBtn.dataset.open !== (expanded ? "1" : "0")) {
            moreBtn.dataset.open = expanded ? "1" : "0";
            moreBtn.title = expanded ? "收起" : "更多";
        }
        var panel = document.querySelector(".expression-panel");
        var panelOpen = !!(panel && panel.getBoundingClientRect().height > 10);
        var emojiBtn = overlay.querySelector("#liuli-emoji-btn");
        if (emojiBtn && emojiBtn.dataset.open !== (panelOpen ? "1" : "0")) {
            emojiBtn.dataset.open = panelOpen ? "1" : "0";
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 气泡：把发送者名字/身份搬进气泡内部 ----------
 * TG 的样式（参考图）：
 *   ┌─────────────────────┐
 *   │ 群主 名字            │  ← 气泡内部顶部
 *   │ 消息内容             │
 *   │               18:57 │  ← 气泡内部右下
 *   └─────────────────────┘
 * QQ 的 .user-name 是气泡的兄弟节点，在气泡外面。
 * 这里在每次 tick 把它挪进 .msg-content-container，
 * 挪完打个标记，避免反复搬动。
 */
function moveSenderIntoBubble() {
    try {
        var containers = document.querySelectorAll(".message-container");
        for (var i = 0; i < containers.length; i++) {
            var mc = containers[i];
            var bubble = mc.querySelector(".msg-content-container");
            if (!bubble) continue;
            var name = mc.querySelector(".user-name");
            if (!name) continue;
            if (bubble.contains(name)) continue;
            // 把姓名节点搬到气泡最前面
            bubble.insertBefore(name, bubble.firstChild);
            bubble.dataset.liuliNamed = "1";
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 连续消息合并 ----------
 * TG 的规则：
 *   组内第一条 → 显示名字，隐藏头像
 *   组内中间   → 名字和头像都隐藏
 *   组内最后一条 → 隐藏名字，显示头像
 *   单条       → 名字 + 头像都显示
 * 发送者身份用「名字文本」判定（名字被搬进气泡后仍然可读），
 * 取不到名字时退回头像 src。
 */
function groupMessages() {
    try {
        var list = document.querySelectorAll(".message-container");
        if (list.length === 0) return;

        // ⚠️ 不能用整个 .user-name 的文本：指针悬停时 QQ 会往里插 .send-time 时间戳，
        // key 一变这条就被判成 single，名字/头像跳出来、和上下条分开。
        // 优先用头像的 aria-label（发送者昵称，悬停不变），再退到昵称本身的 span。
        function keyOf(mc) {
            var av = mc.querySelector(":scope > .avatar-span");
            var lbl = av && av.getAttribute("aria-label");
            if (lbl) return lbl;
            var nick = mc.querySelector(".user-name > .text-ellipsis");
            if (nick) {
                var t = (nick.textContent || "").trim();
                if (t) return t;
            }
            var img = mc.querySelector('[class*="avatar"] img');
            if (img && img.src) return img.src;
            return "";
        }

        var keys = [];
        for (var i = 0; i < list.length; i++) keys.push(keyOf(list[i]));

        for (var j = 0; j < list.length; j++) {
            var mc = list[j];
            var key = keys[j];
            if (!key) { mc.dataset.liuliG = ""; continue; }
            var prevSame = j > 0 && keys[j - 1] === key;
            var nextSame = j < list.length - 1 && keys[j + 1] === key;
            var g;
            if (!prevSame && !nextSame) g = "single";
            else if (!prevSame && nextSame) g = "first";
            else if (prevSame && nextSame) g = "mid";
            else g = "last";
            if (mc.dataset.liuliG !== g) mc.dataset.liuliG = g;
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 头像吸附（TG 行为） ----------
 * 头像只在组内最后一条上渲染，自然位置在组底。
 * 组底滚出视口下沿时，用 transform 把头像往上推到视口下沿，
 * 但不超过组内第一条气泡的顶 —— 头像始终贴着这一组消息。
 * 原位置用气泡计算（transform 不影响气泡的 rect）。
 */
function stickAvatars() {
    try {
        var vp = document.querySelector(".chat-msg-area__vlist") || document.querySelector(".chat-msg-area");
        if (!vp) return;
        var vr = vp.getBoundingClientRect();
        var list = document.querySelectorAll(".message-container");
        var groupTop = null;
        for (var i = 0; i < list.length; i++) {
            var mc = list[i];
            var g = mc.dataset.liuliG;
            // 用 wrapper 而不是 .msg-content-container：转发记录等卡片没有后者，
            // 而 wrapper 在普通消息里与气泡同框。
            var bubble = mc.querySelector(":scope > .message-content__wrapper") || mc.querySelector(".msg-content-container");
            if (!bubble || bubble.getBoundingClientRect().height < 1) continue;
            if (g === "first" || g === "single" || groupTop === null) {
                groupTop = bubble.getBoundingClientRect().top;
            }
            if (g !== "last" && g !== "single") continue;
            var av = mc.querySelector(":scope > .avatar-span");
            if (!av) continue;
            var br = bubble.getBoundingClientRect();
            var h = av.offsetHeight || 32;
            var natBottom = br.bottom;
            var natTop = natBottom - h;
            var ty = 0;
            if (natBottom > vr.bottom - 4) ty = (vr.bottom - 4) - natBottom;
            var minTy = groupTop - natTop;
            if (ty < minTy) ty = minTy;
            if (ty > 0) ty = 0;
            ty = Math.round(ty);
            if (av.dataset.liuliTy !== String(ty)) {
                av.dataset.liuliTy = String(ty);
                av.style.transform = ty ? "translateY(" + ty + "px)" : "";
            }
            groupTop = null;
        }
    } catch (e) { /* 静默 */ }
}

var liuliStickRaf = 0;
function installAvatarStick() {
    if (window.__liuliStickInstalled) return;
    window.__liuliStickInstalled = true;
    // scroll 不冒泡，用捕获阶段监听所有滚动容器；rAF 合并
    document.addEventListener("scroll", function () {
        if (liuliStickRaf) return;
        liuliStickRaf = requestAnimationFrame(function () {
            liuliStickRaf = 0;
            stickAvatars();
        });
    }, true);
    window.addEventListener("resize", function () { stickAvatars(); });
}


/* ---------- 消息区即时生效 ----------
 * 分组/名字搬进气泡/引用线原来只靠 1500ms 定时器，新消息（含虚拟列表滚动
 * 新挂上的行）会先以原生样式出现，最长 1.5 秒后才变。
 * MutationObserver 的回调在微任务里跑，早于下一帧绘制，所以首帧就是最终样式。
 * 自己造成的 DOM 变动用 takeRecords() 丢掉，避免回调自激。 */
/* ════════════════════════════════════════════════════════════
 * 侧栏列表：会话列表 / 群成员（2026-10-29）
 * ------------------------------------------------------------
 * 两个列表都是 QQ 的虚拟列表（Vue 管理），这里只做三类安全操作：
 *   1. 在 QQ 节点上写 data-liuli-* 标记，样式交给 lists.css；
 *   2. 用 Web Animations API 播动画（不改 style，Vue 无感）；
 *   3. 不插入、不移动任何节点。
 * ════════════════════════════════════════════════════════════ */
var LL_REDUCED = (function () { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
var LL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function llNorm(s) { return (s || "").replace(/\s+/g, " ").trim(); }

/* 容器可视范围内的元素，按屏幕位置从上到下（排除虚拟列表的测量副本） */
function llVisibleIn(container, sel) {
    var cr = container.getBoundingClientRect();
    var out = [];
    container.querySelectorAll(sel).forEach(function (el) {
        if (el.closest(".viewport-list__measure")) return;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < cr.top || r.top > cr.bottom) return;
        out.push({ el: el, top: r.top });
    });
    out.sort(function (a, b) { return a.top - b.top; });
    return out.map(function (o) { return o.el; });
}

/* 逐行上浮入场（DSH 会话列表 liuli-treeitem-rise 同款） */
function llRiseIn(els, step) {
    if (LL_REDUCED || !els.length || typeof els[0].animate !== "function") return;
    els.slice(0, 18).forEach(function (el, i) {
        try {
            el.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }],
                { duration: 460, delay: i * (step || 26), easing: LL_EASE, fill: "backwards" });
        } catch (e) {}
    });
}

/* ── 会话列表：选中底色从旧位置滑到新位置 ──
 * 选中底色画在 .recent-contact-item--selected::before 上（lists.css），
 * 切换时对新选中项的 ::before 做 FLIP：从旧项的位置平移回来。
 * 用 data-contact-id 判断是否真的换了会话：虚拟列表滚动时会复用节点、
 * 重挂 --selected 类，id 不变就不动。 */
var llSel = { id: null, root: null, obs: null };
function llWatchContactList() {
    var root = document.querySelector(".recent-contact");
    if (!root || llSel.root === root) return;
    if (llSel.obs) llSel.obs.disconnect();
    llSel.root = root;
    var cur = llVisibleIn(root, ".recent-contact-item.recent-contact-item--selected")[0];
    llSel.id = cur ? cur.getAttribute("data-contact-id") : null;
    llSel.obs = new MutationObserver(function (recs) {
        var gained = null, lost = null;
        for (var i = 0; i < recs.length; i++) {
            var t = recs[i].target;
            if (!t.classList || !t.classList.contains("recent-contact-item")) continue;
            if (t.closest(".viewport-list__measure")) continue;
            var was = (recs[i].oldValue || "").indexOf("recent-contact-item--selected") >= 0;
            var now = t.classList.contains("recent-contact-item--selected");
            if (now && !was) gained = t;
            if (was && !now) lost = t;
        }
        if (!gained) return;
        var id = gained.getAttribute("data-contact-id");
        if (id === llSel.id) return;
        llSel.id = id;
        if (LL_REDUCED || typeof gained.animate !== "function") return;
        var nr = gained.getBoundingClientRect();
        var lr = lost && lost.isConnected ? lost.getBoundingClientRect() : null;
        try {
            if (lr && lr.height > 0) {
                var dy = Math.round(lr.top - nr.top);
                gained.animate([{ transform: "translateY(" + dy + "px)" }, { transform: "translateY(0)" }], {
                    duration: Math.min(460, 240 + Math.abs(dy) * 0.22),
                    easing: "cubic-bezier(0.3, 1.25, 0.45, 1)",
                    pseudoElement: "::before"
                });
            } else {
                gained.animate([{ opacity: 0, transform: "scale(0.94)" }, { opacity: 1, transform: "none" }],
                    { duration: 260, easing: LL_EASE, pseudoElement: "::before" });
            }
        } catch (e) {}
    });
    llSel.obs.observe(root, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
    requestAnimationFrame(function () { llRiseIn(llVisibleIn(root, ".recent-contact-item"), 26); });
}

/* ── 群成员 ── */
/* 当前聊天里最近说话的人：名字 → 名次（0 = 最近一位，不含自己） */
function llRecentSpeakers() {
    var list = document.querySelectorAll(".chat-msg-area .message-container");
    var out = {}, rank = 0;
    for (var i = list.length - 1; i >= 0 && rank < 12 && i >= list.length - 60; i--) {
        var mc = list[i];
        if (mc.classList.contains("message-container--self") || mc.querySelector(".container--self")) continue;
        var av = mc.querySelector(":scope > .avatar-span");
        var n = llNorm(av && av.getAttribute("aria-label"));
        if (!n || Object.prototype.hasOwnProperty.call(out, n)) continue;
        out[n] = rank++;
    }
    return out;
}

var llGM = { key: null, staff: {} };
function llGroupMembersPass() {
    try {
        var gm = document.querySelector(".group-member");
        if (!gm) { llGM.key = null; return; }
        var rows = gm.querySelectorAll(".group-user");
        if (!rows.length) return;

        // 换群 → 成员行入场
        var title = document.querySelector(".chat-header .panel-header__title");
        var key = llNorm(title && title.textContent);
        if (key && key !== llGM.key) {
            llGM.key = key;
            var host = gm.querySelector(".group-member-list") || gm;
            requestAnimationFrame(function () { llRiseIn(llVisibleIn(host, ".group-user"), 16); });
        }

        // 管理团队：群主 + 管理员排在最前面且连续，画成一整块
        var byIdx = {};
        rows.forEach(function (r) {
            var i = Number(r.getAttribute("data-index"));
            if (!isNaN(i)) byIdx[i] = r;
        });
        var isStaff = function (r) { return !!(r && r.querySelector(".group-member-label")); };
        Object.keys(byIdx).forEach(function (k) {
            var i = Number(k), r = byIdx[i];
            var g = "";
            if (isStaff(r)) {
                var prev = i > 0;
                var next = byIdx[i + 1] ? isStaff(byIdx[i + 1]) : true;
                g = !prev && !next ? "single" : !prev ? "first" : !next ? "last" : "mid";
            }
            if ((r.dataset.liuliStaff || "") !== g) {
                if (g) r.dataset.liuliStaff = g; else delete r.dataset.liuliStaff;
            }
        });
        // 管理人数：从第 0 行数到第一个非管理行（必须都渲染出来才算数），按群缓存
        if (byIdx[0]) {
            var n = 0;
            while (byIdx[n] && isStaff(byIdx[n])) n++;
            if (byIdx[n]) llGM.staff[key] = n;
        }
        var span = gm.querySelector(".group-member-title > span");
        var cnt = llGM.staff[key];
        if (span) {
            var want = cnt ? String(cnt) : "";
            if ((span.dataset.liuliStaff || "") !== want) {
                if (want) span.dataset.liuliStaff = want; else delete span.dataset.liuliStaff;
            }
        }

        // 最近发言：头像亮一圈，最近 3 位呼吸
        var recent = llRecentSpeakers();
        rows.forEach(function (r) {
            var nm = r.querySelector(".group-user__name");
            var name = llNorm(nm && nm.textContent);
            var rank = Object.prototype.hasOwnProperty.call(recent, name) ? recent[name] : -1;
            var v = rank < 0 ? "" : rank < 3 ? "hot" : "1";
            if ((r.dataset.liuliActive || "") !== v) {
                if (v) r.dataset.liuliActive = v; else delete r.dataset.liuliActive;
            }
        });
    } catch (e) { /* 静默 */ }
}

/* 两个列表的节点增删（滚动、换群、换会话）同步处理：
 * MutationObserver 回调在绘制前执行，新行第一帧就带着标记。 */
var llSideRaf = 0;
function installSideListObserver() {
    if (window.__liuliSideObs) return;
    var obs = new MutationObserver(function (recs) {
        var hit = false;
        for (var i = 0; i < recs.length && !hit; i++) {
            var t = recs[i].target;
            if (t && t.nodeType !== 1) t = t.parentElement;
            if (t && t.closest && t.closest(".group-member, .recent-contact, .two-col-layout__aside")) hit = true;
        }
        if (!hit || llSideRaf) return;
        // 合并到一帧：选人对话框等一次挂几千个节点时不会被触发成百上千次
        llSideRaf = requestAnimationFrame(function () {
            llSideRaf = 0;
            try { llWatchContactList(); llGroupMembersPass(); } catch (e) {}
        });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__liuliSideObs = obs;
}

function liuliMessagePass() {
    moveSenderIntoBubble();
    groupMessages();
    markQuoteRoots();
    stickAvatars();
}


/* ---------- 动效：新消息出现 / 切换会话 ----------
 * 虚拟列表滚动时也会挂新节点，不能见节点就播动画。
 * 用 .ml-item 的消息 id（递增的 64 位整数）判断：只有比当前会话已见过的
 * 最大 id 还新的，才是"刚收到/刚发出"的消息。换会话时只记基线、不播。 */
var llMsgSeen = { chat: null, max: null };
function llChatKey() {
    var t = document.querySelector(".aio .chat-header .panel-header__title");
    return t ? (t.textContent || "").replace(/\s+/g, " ").trim() : "";
}
function llMsgId(el) {
    try { return el && /^\d+$/.test(el.id) ? BigInt(el.id) : null; } catch (e) { return null; }
}
function llMotionPass(added) {
    try {
        var key = llChatKey();
        var items = document.querySelectorAll(".chat-msg-area .ml-item[id]");
        if (!items.length) return;
        if (key !== llMsgSeen.chat) {
            var first = llMsgSeen.chat !== null;
            llMsgSeen.chat = key;
            var m = null;
            items.forEach(function (it) { var v = llMsgId(it); if (v !== null && (m === null || v > m)) m = v; });
            llMsgSeen.max = m;
            // 换会话：消息区整体轻轻浮上来
            if (first && !LL_REDUCED) {
                var area = document.querySelector(".chat-msg-area");
                if (area && area.animate) area.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
                    { duration: 280, easing: LL_EASE });
            }
            return;
        }
        if (LL_REDUCED || !added || !added.length) return;
        added.forEach(function (it) {
            var v = llMsgId(it);
            if (v === null || llMsgSeen.max === null || v <= llMsgSeen.max) return;
            llMsgSeen.max = v;
            var mc = it.querySelector(".message-container");
            var w = it.querySelector(".message-content__wrapper");
            if (!mc || !w || !w.animate) return;
            var self = mc.classList.contains("message-container--self") || !!mc.querySelector(".container--self");
            w.style.transformOrigin = self ? "100% 100%" : "0% 100%";
            w.animate([
                { opacity: 0, transform: "translateY(12px) scale(0.92)" },
                { opacity: 1, transform: "translateY(-2px) scale(1.01)", offset: 0.7 },
                { opacity: 1, transform: "none" }
            ], { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
            var av = mc.querySelector(":scope > .avatar-span");
            if (av && av.animate && getComputedStyle(av).display !== "none") {
                av.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }],
                    { duration: 300, delay: 60, easing: "cubic-bezier(0.3, 1.35, 0.45, 1)", fill: "backwards" });
            }
        });
    } catch (e) { /* 静默 */ }
}

function installMessageObserver() {
    if (window.__liuliMsgObs) return;
    var busy = false;
    function touchesMessages(rec) {
        var t = rec.target;
        if (t && t.nodeType !== 1) t = t.parentElement;
        if (t && t.closest && t.closest(".chat-msg-area")) return true;
        for (var i = 0; i < rec.addedNodes.length; i++) {
            var n = rec.addedNodes[i];
            if (n.nodeType !== 1) continue;
            if (n.matches(".message-container, .chat-msg-area") || n.querySelector(".message-container")) return true;
        }
        return false;
    }
    var obs = new MutationObserver(function (recs) {
        if (busy || window.__liuliPause) return;
        var hit = false;
        for (var i = 0; i < recs.length; i++) { if (touchesMessages(recs[i])) { hit = true; break; } }
        if (!hit) return;
        busy = true;
        var added = [];
        for (var k = 0; k < recs.length; k++) {
            var an = recs[k].addedNodes;
            for (var q = 0; q < an.length; q++) {
                var nd = an[q];
                if (nd.nodeType !== 1) continue;
                if (nd.classList && nd.classList.contains("ml-item")) added.push(nd);
                else if (nd.querySelectorAll) nd.querySelectorAll(".ml-item[id]").forEach(function (x) { added.push(x); });
            }
        }
        try { liuliMessagePass(); } catch (e) { /* 静默 */ }
        try { llMotionPass(added); } catch (e) { /* 静默 */ }
        finally { obs.takeRecords(); busy = false; }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__liuliMsgObs = obs;
}

/* 指向唤出的状态机：不用 :has(:hover)（这版 Chromium 里 :has + :hover 失效很慢，
 * 实测把手已 hover、侧栏仍不展开）。进入入口或控件本身 → body 打标记；
 * 离开两者 250ms 后清掉。控件节点会被 Vue 重建，所以用 closest 判断。 */
var LIULI_REVEAL = [
    ["show-l", "#liuli-top-hint-l, .topbar-profile"],
    ["show-r", "#liuli-top-hint-r, .window-control-area"],
    ["show-nav", "#liuli-nav-handle, .container-sidebar"]
];
function installRevealTracker() {
    if (window.__liuliReveal2) return;
    window.__liuliReveal2 = true;
    /* 按坐标判断，不依赖 mouseover/mouseout：
     * 那两个事件在 QQ 里会晚一拍到达，且离开时偶尔不来，标记就卡住不收。
     *   左边缘 ≤8px（整条）           → 展开导航；展开后指针在导航卡上就保持
     *   顶边 ≤8px 的左 / 右 200px     → 唤出左上 / 右上胶囊；指针在胶囊上就保持
     * 离开后 250ms 收起。 */
    var EDGE = 8, HOLD = 250, PAD = 10, CORNER = 200;
    var KEYS = { l: "liuliRL", r: "liuliRR", nav: "liuliRNav" };
    var state = {}, timers = {};
    function set(k, on) {
        if (on) {
            if (timers[k]) { clearTimeout(timers[k]); timers[k] = 0; }
            if (!state[k]) { state[k] = true; document.body.dataset[KEYS[k]] = "1"; }
        } else if (state[k] && !timers[k]) {
            timers[k] = setTimeout(function () {
                timers[k] = 0; state[k] = false;
                delete document.body.dataset[KEYS[k]];
            }, HOLD);
        }
    }
    function over(sel, x, y) {
        var el = document.querySelector(sel);
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD;
    }
    function onMove(e) {
        var x = e.clientX, y = e.clientY, w = window.innerWidth;
        set("nav", x <= EDGE || (state.nav && over(".container-sidebar", x, y)));
        set("l", (y <= EDGE && x >= 56 && x <= CORNER + 56) || (state.l && over(".topbar-profile", x, y)));
        set("r", (y <= EDGE && x >= w - CORNER) || (state.r && over(".window-control-area", x, y)));
    }
    function leaveAll() { set("nav", false); set("l", false); set("r", false); }
    document.addEventListener("mousemove", onMove, true);
    document.documentElement.addEventListener("mouseleave", leaveAll);
    window.addEventListener("blur", leaveAll);
}

/* ---------- 悬浮控件与侧栏的指向入口 ----------
 * ⚠️ QQ 顶部 40px 与左侧 52px 是窗口拖动区（-webkit-app-region: drag），
 * Windows 下鼠标在拖动区里不会把事件发给页面，:hover 永远不触发。
 * 所以入口必须是单独的 no-drag 元素，挂在 body 下（Vue 不会清掉）。
 *   #liuli-top-hint-l / -r：窗口顶边 8px 的感应条，指向时唤出左上/右上胶囊
 *   #liuli-nav-handle    ：左边缘的小把手，指向时滑出导航栏 */
function ensureHoverEntries() {
    try {
        installRevealTracker();
        [["liuli-top-hint-l", "唤出个人信息"], ["liuli-top-hint-r", "唤出窗口按钮"]].forEach(function (pair) {
            if (document.getElementById(pair[0])) return;
            var el = document.createElement("div");
            el.id = pair[0];
            el.className = "liuli-top-hint";
            el.title = pair[1];
            document.body.appendChild(el);
        });
        if (!document.getElementById("liuli-nav-handle")) {
            var h = document.createElement("div");
            h.id = "liuli-nav-handle";
            h.title = "展开导航";
            h.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
                'stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';
            document.body.appendChild(h);
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 引用块：只保留最外层那一条竖线 ----------
 * QQ 的引用结构是嵌套的（reply 里还有 reply），
 * 所以 [class*="reply"] 会给每一层都加一条 border-left，
 * 视觉上就是引用块左边好几条竖线。
 * 这里给最外层打 data-liuli-quote-root="1"，内层打 "0"，
 * CSS 只对 1 画线，0 全部清空。
 */
function markQuoteRoots() {
    try {
        // 全部先归零
        var all = document.querySelectorAll('[class*="reply"], [class*="quote"]');
        for (var i = 0; i < all.length; i++) {
            if (all[i].dataset.liuliQuoteRoot !== "0") all[i].dataset.liuliQuoteRoot = "0";
        }
        // 只有 .reply-element 才是真正的引用块根。
        // ⚠️ 不要用"父级链里有没有 reply"判断：
        //   气泡根本身就叫 reply-message__container，
        //   那样会把每一层都判成嵌套，结果一条线都不画。
        var roots = document.querySelectorAll(".reply-element");
        for (var j = 0; j < roots.length; j++) {
            if (roots[j].dataset.liuliQuoteRoot !== "1") roots[j].dataset.liuliQuoteRoot = "1";
        }
    } catch (e) { /* 静默 */ }
}

/* 把面板的控件构建到任意容器里（内嵌与浮层共用同一套逻辑） */

/* ---------- 壁纸（参考 dsh liuli-runtime 的做法） ----------
 * dsh 用 localStorage 存壁纸 dataURL；这里同样：
 *   - 用户选图 → FileReader → dataURL → localStorage
 *   - 用一条独立 <style> 覆盖 #app::before 的 background-image
 *   - 压暗值走 --ll-wallpaper-dim，由滑条实时驱动
 */
const LL_WALLPAPER_KEY = "liuli-dsh-wallpaper";

/* ════════════════════════════════════════════════════════════
 * 壁纸：选区模型 + 框选编辑（照搬 dsh liuli-theme）
 * ------------------------------------------------------------
 * dsh 的做法不是"缩放 + 位置"滑条，而是归一化选区 {x,y,w,h}：
 *   - 预览按窗口比例渲染，所见即所得
 *   - 框选时显示完整图片，鼠标拖拽创建/移动/拖角缩放
 *   - 选区恒定保持窗口宽高比，所以画面永不拉伸
 *   - 写进 CSS 时用 bgGeometry 推导 background-size / position
 * ════════════════════════════════════════════════════════════ */

const LL_WP_DEFAULTS = { src: null, area: null, fit: "cover" };

function loadWallpaperState() {
    try {
        const raw = localStorage.getItem(LL_WALLPAPER_KEY);
        if (!raw) return Object.assign({}, LL_WP_DEFAULTS);
        const parsed = raw.charAt(0) === "{" ? JSON.parse(raw) : { src: raw };
        const st = Object.assign({}, LL_WP_DEFAULTS, parsed);
        // 兼容早期滑条版存下的字段（scale/posX/posY）——直接丢掉，回落到 cover
        if (!st.area || typeof st.area.w !== "number") st.area = null;
        return st;
    } catch (e) {
        return Object.assign({}, LL_WP_DEFAULTS);
    }
}

function saveWallpaperState(state, broadcast) {
    try { localStorage.setItem(LL_WALLPAPER_KEY, JSON.stringify(state)); } catch (e) {}
    if (broadcast !== false) {
        window.__liuliPaletteApplied = false;
        applyDynamicPalette();
    }
}

/* 图片宽高比缓存：按 src 存，避免异步竞态拿到旧图的比例 */
const llImageRatioCache = new Map();
function getImageRatio(src) {
    return llImageRatioCache.get(src) || null;
}
function primeImageRatio(src) {
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            const r = img.naturalWidth > 0 && img.naturalHeight > 0
                ? img.naturalWidth / img.naturalHeight : null;
            if (r) llImageRatioCache.set(src, r);
            resolve(r);
        };
        img.onerror = function () { resolve(null); };
        img.src = src;
    });
}

/* ── 把选区按指定比例归一化：保留面积与中心，两维恒 ≤ 0.998 ── */
function normalizeAreaToRatio(area, ratio) {
    const safeRatio = Math.max(0.05, Math.min(20, ratio));
    const areaSize = Math.max(area.w * area.h, 0.04 * 0.04);
    let w = Math.sqrt(areaSize * safeRatio);
    let h = Math.sqrt(areaSize / safeRatio);
    const scale = Math.min(1, 1 / w, 1 / h);
    w *= scale;
    h *= scale;
    const maxDim = Math.max(w, h);
    if (maxDim > 0.998) {
        const shrink = 0.998 / maxDim;
        w *= shrink;
        h *= shrink;
    }
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    return {
        x: Math.min(1 - w, Math.max(0, cx - w / 2)),
        y: Math.min(1 - h, Math.max(0, cy - h / 2)),
        w: w,
        h: h
    };
}

/* ── 由选区推导 background-size / position ──
 * cover 选区放大公式：size = 100%/w 100%/h；position = x/(1-w) y/(1-h) */
function bgGeometry(area, imageRatio, viewportRatio) {
    if (arguments[3] === "contain") return { size: "contain", position: "center" };
    if (arguments[3] === "stretch") return { size: "100% 100%", position: "center" };
    if (!area || area.w <= 0.04 || area.h <= 0.04) {
        return { size: "cover", position: "center" };
    }
    const vRatio = viewportRatio && viewportRatio > 0 ? viewportRatio : window.innerWidth / window.innerHeight;
    const iRatio = imageRatio && imageRatio > 0 ? imageRatio : vRatio;
    const n = normalizeAreaToRatio(area, vRatio / iRatio);
    if (n.w >= 0.999 || n.h >= 0.999) {
        return { size: "cover", position: "center" };
    }
    const px = Math.min(1, Math.max(0, n.x / (1 - n.w)));
    const py = Math.min(1, Math.max(0, n.y / (1 - n.h)));
    return {
        size: "calc(100% / " + n.w + ") calc(100% / " + n.h + ")",
        position: (px * 100).toFixed(2) + "% " + (py * 100).toFixed(2) + "%"
    };
}

function ensureWallpaperStyle() {
    let el = document.getElementById("liuli-wallpaper-style");
    if (!el) {
        el = document.createElement("style");
        el.id = "liuli-wallpaper-style";
        document.head.appendChild(el);
    }
    return el;
}

function renderWallpaper(state) {
    const el = ensureWallpaperStyle();
    if (!state || !state.src) {
        el.textContent = "";
        return;
    }
    const g = bgGeometry(state.area, getImageRatio(state.src), window.innerWidth / window.innerHeight, state.fit || "cover");
    el.textContent =
        "#app::before {" +
        "  background-image: linear-gradient(rgba(var(--ll-scrim-rgb), var(--ll-wallpaper-dim, 0.18))," +
        "    rgba(var(--ll-scrim-rgb), var(--ll-wallpaper-dim, 0.18))),\n" +
        "    url(\"" + state.src + "\") !important;" +
        "  background-position: " + g.position + " !important;" +
        "  background-size: " + g.size + " !important;" +
        "  background-repeat: no-repeat !important;" +
        "}";
}

/* 跨窗口同步（设置页改 → 主界面跟着换） */
try {
    window.addEventListener("storage", function (e) {
        if (e.key !== LL_WALLPAPER_KEY) return;
        const st = loadWallpaperState();
        if (st.src && !getImageRatio(st.src)) {
            primeImageRatio(st.src).then(function () { (function(){ var st = loadWallpaperState(); if (st.src) { primeImageRatio(st.src).then(function(){ renderWallpaper(loadWallpaperState()); }); } else { renderWallpaper(st); } })(); });
        }
        renderWallpaper(st);
        window.__liuliPaletteApplied = false;
        applyDynamicPalette();
        if (typeof refreshWallpaperPreview === "function") refreshWallpaperPreview();
    });
} catch (e) {}

function readImageFile(file, maxW) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = function () {
            const img = new Image();
            img.onerror = reject;
            img.onload = function () {
                try {
                    const sc = Math.min(1, maxW / img.naturalWidth);
                    const w = Math.round(img.naturalWidth * sc);
                    const h = Math.round(img.naturalHeight * sc);
                    const cvs = document.createElement("canvas");
                    cvs.width = w;
                    cvs.height = h;
                    cvs.getContext("2d").drawImage(img, 0, 0, w, h);
                    resolve({ dataUrl: cvs.toDataURL("image/jpeg", 0.86), ratio: w / h });
                } catch (e) { reject(e); }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

/* ════════════════════════════════════════════════════════════
 * 壁纸预览（非选择态）+ 框选编辑（选择态）
 * ════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════
 * 壁纸设置（照搬 DSH LiuliAppearance.tsx 的 WallpaperPreview）
 * ------------------------------------------------------------
 *   - 卡片内：选择图片 / 移除 · 适应模式（Cover/Contain/Stretch）· 预览
 *   - 预览按实际窗口比例渲染，所见即所得
 *   - Cover 下可「编辑选区」：容器按完整壁纸比例显示，选框恒定窗口比例，
 *     拖空白新建、拖框内移动、拖四角缩放，点「完成选区」保存
 *   - 换图后立刻按新壁纸重新取色（extractSource 读的就是当前壁纸）
 * ════════════════════════════════════════════════════════════ */
let wpPreviewEl = null;
let llWpRefresh = null;
function refreshWallpaperPreview() { if (llWpRefresh) llWpRefresh(); }

const LL_WP_FITS = [["cover", "填充（Cover）"], ["contain", "适应（Contain）"], ["stretch", "拉伸（Stretch）"]];

function llBtn(text, variant) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "liuli-btn liuli-btn--" + (variant || "ghost");
    b.textContent = text;
    return b;
}

function llApplyWallpaper(st) {
    saveWallpaperState(st, true);
    if (st && st.src && !getImageRatio(st.src)) {
        primeImageRatio(st.src).then(function () { renderWallpaper(loadWallpaperState()); refreshWallpaperPreview(); });
    }
    renderWallpaper(st);
    refreshWallpaperPreview();
}

/* 主界面视口比例：壁纸铺在主聊天界面上，预览/框选必须按主界面的实时宽高比算，
 * 不能用设置窗口自己的 innerWidth/innerHeight（之前就是这个错）。
 * 主界面在加载和 resize 时把尺寸写进 localStorage，其它窗口读它并监听 storage 事件。 */
const LL_MAIN_VP_KEY = "liuli-dsh-main-viewport";
function llMainViewportRatio() {
    if (document.body && document.body.dataset.liuliScope === "main") return window.innerWidth / window.innerHeight;
    try {
        const v = JSON.parse(localStorage.getItem(LL_MAIN_VP_KEY) || "null");
        if (v && v.w > 0 && v.h > 0) return v.w / v.h;
    } catch (e) {}
    return window.innerWidth / window.innerHeight;
}
(function publishMainViewport() {
    let t = 0;
    function pub() {
        if (!document.body || document.body.dataset.liuliScope !== "main") return;
        try {
            const cur = JSON.parse(localStorage.getItem(LL_MAIN_VP_KEY) || "null");
            if (cur && cur.w === innerWidth && cur.h === innerHeight) return;
            localStorage.setItem(LL_MAIN_VP_KEY, JSON.stringify({ w: innerWidth, h: innerHeight }));
        } catch (e) {}
    }
    try {
        window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(pub, 80); });
        setTimeout(pub, 500);
        setInterval(pub, 3000);
        window.addEventListener("storage", function (e) {
            if (e.key === LL_MAIN_VP_KEY && typeof refreshWallpaperPreview === "function") refreshWallpaperPreview();
        });
    } catch (e) {}
})();

function buildWallpaperControls(host) {
    const block = document.createElement("div");
    block.className = "liuli-wp-block";
    host.appendChild(block);

    const title = document.createElement("div");
    title.className = "liuli-wp-title";
    title.textContent = "壁纸设置";
    block.appendChild(title);

    /* ── 选择 / 移除 ── */
    const row = document.createElement("div");
    row.className = "liuli-wp-actions";
    const pick = document.createElement("input");
    pick.type = "file";
    pick.accept = "image/*";
    pick.style.display = "none";
    const chooseBtn = llBtn("选择图片", "primary");
    chooseBtn.addEventListener("click", function () { pick.click(); });
    const fileName = document.createElement("span");
    fileName.className = "liuli-wp-filename";
    const removeBtn = llBtn("移除", "ghost");
    removeBtn.addEventListener("click", function () {
        try { localStorage.removeItem(LL_WALLPAPER_KEY); } catch (e) {}
        renderWallpaper(null);
        window.__liuliPaletteApplied = false;
        applyDynamicPalette();
        fileName.textContent = "";
        refreshWallpaperPreview();
        toast("已恢复默认壁纸");
    });
    pick.addEventListener("change", function () {
        const f = pick.files && pick.files[0];
        if (!f) return;
        chooseBtn.disabled = true;
        chooseBtn.textContent = "读取中…";
        readImageFile(f, 2560).then(function (r) {
            llImageRatioCache.set(r.dataUrl, r.ratio);
            const prev = loadWallpaperState();
            llApplyWallpaper({ src: r.dataUrl, area: null, fit: prev.fit || "cover" });
            fileName.textContent = f.name;
            toast("壁纸已更新，主题色已按新壁纸取色");
        }).catch(function (e) {
            toast("读取失败：" + (e && e.message));
        }).finally(function () {
            chooseBtn.disabled = false;
            chooseBtn.textContent = "选择图片";
            pick.value = "";
        });
    });
    row.appendChild(chooseBtn);
    row.appendChild(removeBtn);
    row.appendChild(fileName);
    row.appendChild(pick);
    block.appendChild(row);

    /* ── 适应模式 ── */
    const fitRow = document.createElement("div");
    fitRow.className = "liuli-wp-fit";
    const fitLabel = document.createElement("span");
    fitLabel.textContent = "适应模式";
    const fitSeg = document.createElement("div");
    fitSeg.className = "liuli-seg";
    fitRow.appendChild(fitLabel);
    fitRow.appendChild(fitSeg);
    block.appendChild(fitRow);
    const fitBtns = {};
    LL_WP_FITS.forEach(function (p) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "liuli-seg__item";
        b.textContent = p[1];
        b.addEventListener("click", function () {
            const st = loadWallpaperState();
            st.fit = p[0];
            llApplyWallpaper(st);
        });
        fitSeg.appendChild(b);
        fitBtns[p[0]] = b;
    });

    /* ── 预览 ── */
    const previewActions = document.createElement("div");
    previewActions.className = "liuli-wp-actions";
    const previewHost = document.createElement("div");
    previewHost.className = "liuli-wp-preview-host";
    const note = document.createElement("div");
    note.className = "liuli-wp-note";
    note.textContent = "选区仅 Cover 模式生效";
    block.appendChild(previewActions);
    block.appendChild(previewHost);
    block.appendChild(note);

    let selectMode = false;
    let selBox = null;
    let drag = null;
    let stage = null;

    const winRatio = llMainViewportRatio;
    const clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
    const cropRatioOf = function (ir) { return ir && ir > 0 ? winRatio() / ir : 1; };

    function windowArea(ir) {
        if (!ir || ir <= 0) return null;
        const wr = winRatio();
        const maxW = Math.min(0.998, ir > wr ? wr / ir : 1);
        const maxH = Math.min(0.998, ir > wr ? 1 : ir / wr);
        return { x: (1 - maxW) / 2, y: (1 - maxH) / 2, w: maxW, h: maxH };
    }
    function createArea(start, p, ratio) {
        const r = Math.max(0.05, Math.min(20, ratio));
        const dx = p.x - start.x, dy = p.y - start.y;
        const dirX = dx >= 0 ? 1 : -1, dirY = dy >= 0 ? 1 : -1;
        const maxW = dirX > 0 ? 1 - start.x : start.x;
        const maxH = dirY > 0 ? 1 - start.y : start.y;
        const w = Math.min(Math.max(Math.abs(dx), Math.abs(dy) * r), maxW, maxH * r);
        const h = w / r;
        return { x: dirX > 0 ? start.x : start.x - w, y: dirY > 0 ? start.y : start.y - h, w: w, h: h };
    }
    function resizeArea(box, corner, p, ratio) {
        const r = Math.max(0.05, Math.min(20, ratio));
        const fx = (corner === "tl" || corner === "bl") ? box.x + box.w : box.x;
        const fy = (corner === "tl" || corner === "tr") ? box.y + box.h : box.y;
        const dirX = (corner === "tr" || corner === "br") ? 1 : -1;
        const dirY = (corner === "bl" || corner === "br") ? 1 : -1;
        const maxW = dirX > 0 ? 1 - fx : fx;
        const maxH = dirY > 0 ? 1 - fy : fy;
        const w = Math.min(Math.max(Math.abs(p.x - fx), Math.abs(p.y - fy) * r), maxW, maxH * r);
        const h = w / r;
        return { x: dirX > 0 ? fx : fx - w, y: dirY > 0 ? fy : fy - h, w: w, h: h };
    }
    function norm(e) {
        if (!stage) return null;
        const r = stage.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
    }

    function cropBoxEl(box, interactive) {
        const el = document.createElement("div");
        el.className = "liuli-wp-crop" + (interactive ? "" : " liuli-wp-crop--static");
        el.style.left = box.x * 100 + "%";
        el.style.top = box.y * 100 + "%";
        el.style.width = box.w * 100 + "%";
        el.style.height = box.h * 100 + "%";
        if (interactive) {
            ["tl", "tr", "bl", "br"].forEach(function (c) {
                const h = document.createElement("span");
                h.className = "liuli-wp-handle liuli-wp-handle--" + c;
                el.appendChild(h);
            });
        }
        return el;
    }

    function paintSelection() {
        if (!stage) return;
        const old = stage.querySelector(".liuli-wp-crop");
        if (old) old.remove();
        if (selBox && selBox.w > 0) stage.appendChild(cropBoxEl(selBox, true));
    }

    function render() {
        const st = loadWallpaperState();
        const fit = st.fit || "cover";
        Object.keys(fitBtns).forEach(function (k) { fitBtns[k].classList.toggle("is-active", k === fit); });
        removeBtn.disabled = !st.src;
        previewActions.innerHTML = "";
        previewHost.innerHTML = "";
        stage = null;
        note.style.display = st.src && fit !== "cover" ? "" : "none";
        if (!st.src) {
            previewHost.style.display = "none";
            previewActions.style.display = "none";
            return;
        }
        previewHost.style.display = "";
        previewActions.style.display = "";
        const ir = getImageRatio(st.src);
        if (!ir) { primeImageRatio(st.src).then(render); }
        const wr = winRatio();
        const width = "min(100%, calc(220px * " + wr + "))";
        const cr = cropRatioOf(ir);

        if (selectMode) {
            const reselect = llBtn("重新选择", "ghost");
            reselect.addEventListener("click", function () { selBox = windowArea(ir); paintSelection(); });
            const done = llBtn("完成选区", "primary");
            done.addEventListener("click", function () {
                if (selBox && selBox.w > 0.04 && selBox.h > 0.04) {
                    const cur = loadWallpaperState();
                    cur.area = normalizeAreaToRatio(selBox, cr);
                    llApplyWallpaper(cur);
                }
                selectMode = false;
                selBox = null;
                render();
            });
            previewActions.appendChild(reselect);
            previewActions.appendChild(done);
        } else {
            const edit = llBtn(st.area ? "编辑选区" : "重新选择", "ghost");
            edit.disabled = fit !== "cover" || !ir;
            edit.addEventListener("click", function () {
                const saved = st.area && st.area.w > 0.04 && st.area.h > 0.04 ? normalizeAreaToRatio(st.area, cr) : null;
                selBox = saved || windowArea(ir);
                selectMode = true;
                render();
            });
            previewActions.appendChild(edit);
            if (st.area) {
                const clear = llBtn("清除选区", "ghost");
                clear.addEventListener("click", function () {
                    const cur = loadWallpaperState();
                    cur.area = null;
                    llApplyWallpaper(cur);
                });
                previewActions.appendChild(clear);
            }
        }

        const full = document.createElement("div");
        full.className = "liuli-wp-full";
        full.style.backgroundImage = "url(\"" + st.src + "\")";

        if (selectMode && ir) {
            stage = document.createElement("div");
            stage.className = "liuli-wp-context is-selecting";
            stage.style.width = width;
            stage.style.aspectRatio = String(ir);
            stage.appendChild(full);
            previewHost.appendChild(stage);
            paintSelection();
            stage.addEventListener("pointerdown", function (e) {
                e.preventDefault();
                const r = stage.getBoundingClientRect();
                const p0 = norm(e);
                if (!p0) return;
                const box = selBox;
                if (box && box.w > 0) {
                    const L = box.x * r.width, T = box.y * r.height;
                    const R = (box.x + box.w) * r.width, B = (box.y + box.h) * r.height;
                    const lx = e.clientX - r.left, ly = e.clientY - r.top;
                    const dL = Math.abs(lx - L), dR = Math.abs(lx - R), dT = Math.abs(ly - T), dB = Math.abs(ly - B);
                    const nearCorner = (dL < 12 || dR < 12) && (dT < 12 || dB < 12);
                    const nearBox = lx >= L - 6 && lx <= R + 6 && ly >= T - 6 && ly <= B + 6;
                    if (nearCorner) {
                        drag = { mode: "resize", box: box, corner: (dT <= dB ? "t" : "b") + (dL <= dR ? "l" : "r") };
                    } else if (nearBox) {
                        drag = { mode: "move", box: box, ox: clamp(p0.x - box.x, 0, box.w), oy: clamp(p0.y - box.y, 0, box.h) };
                    } else {
                        drag = { mode: "create", start: p0, prev: box };
                        selBox = { x: p0.x, y: p0.y, w: 0, h: 0 };
                    }
                } else {
                    drag = { mode: "create", start: p0, prev: box };
                    selBox = { x: p0.x, y: p0.y, w: 0, h: 0 };
                }
                stage.setPointerCapture(e.pointerId);
                paintSelection();
            });
            stage.addEventListener("pointermove", function (e) {
                if (!drag) return;
                const p = norm(e);
                if (!p) return;
                if (drag.mode === "create") selBox = createArea(drag.start, p, cr);
                else if (drag.mode === "resize") selBox = resizeArea(drag.box, drag.corner, p, cr);
                else selBox = { x: clamp(p.x - drag.ox, 0, 1 - drag.box.w), y: clamp(p.y - drag.oy, 0, 1 - drag.box.h), w: drag.box.w, h: drag.box.h };
                paintSelection();
            });
            const up = function () {
                const d = drag;
                drag = null;
                if (d && d.mode === "create" && !(selBox && selBox.w > 0.04 && selBox.h > 0.04)) {
                    selBox = d.prev;
                    paintSelection();
                }
            };
            stage.addEventListener("pointerup", up);
            stage.addEventListener("pointercancel", up);
        } else if (st.area && fit === "cover" && ir) {
            /* 有选区：完整壁纸 + 静态选框（选区外暗化） */
            stage = document.createElement("div");
            stage.className = "liuli-wp-context";
            stage.style.width = width;
            stage.style.aspectRatio = String(ir);
            stage.appendChild(full);
            stage.appendChild(cropBoxEl(normalizeAreaToRatio(st.area, cr), false));
            previewHost.appendChild(stage);
        } else {
            /* 无选区：按窗口比例渲染真实效果 */
            stage = document.createElement("div");
            stage.className = "liuli-wp-stage2";
            stage.style.width = width;
            stage.style.aspectRatio = String(wr);
            const fx = document.createElement("div");
            fx.className = "liuli-wp-effect";
            const g = bgGeometry(st.area, ir, wr, fit);
            fx.style.backgroundImage = "url(\"" + st.src + "\")";
            fx.style.backgroundSize = g.size;
            fx.style.backgroundPosition = g.position;
            stage.appendChild(fx);
            previewHost.appendChild(stage);
        }
    }

    llWpRefresh = render;
    render();
}

/* ════════════════════════════════════════════════════════════
 * 明暗主题（DSH 的日/夜切换）
 *   跟随 QQ / 亮色 / 暗色，存在 localStorage，所有窗口同步。
 *   色板全部由 MCU 按明暗重新派生（同一套壁纸取色）。
 * ════════════════════════════════════════════════════════════ */
const LL_MODE_KEY = "liuli-dsh-mode";
function llThemeMode() {
    try {
        const v = localStorage.getItem(LL_MODE_KEY);
        return v === "light" || v === "dark" ? v : "auto";
    } catch (e) { return "auto"; }
}
function llIsDark() {
    const m = llThemeMode();
    if (m === "light") return false;
    if (m === "dark") return true;
    return document.body.classList.contains("q-theme-tokens-dark")
        || document.body.getAttribute("q-theme") === "dark";
}
function llApplyMode(withTransition, x, y) {
    const run = function () {
        const m = llThemeMode();
        if (m === "auto") delete document.body.dataset.liuliMode;
        else document.body.dataset.liuliMode = m;
        document.body.dataset.liuliDark = llIsDark() ? "1" : "0";
        window.__liuliPaletteApplied = false;
        return applyDynamicPalette();
    };
    if (withTransition && typeof document.startViewTransition === "function") {
        const root = document.documentElement;
        root.style.setProperty("--vt-x", (x || innerWidth / 2) + "px");
        root.style.setProperty("--vt-y", (y || innerHeight / 2) + "px");
        root.style.setProperty("--vt-r", Math.hypot(innerWidth, innerHeight) + "px");
        document.startViewTransition(run);
    } else {
        run();
    }
}
try {
    window.addEventListener("storage", function (e) {
        if (e.key === LL_MODE_KEY) { llApplyMode(false); if (typeof llModeRefresh === "function") llModeRefresh(); }
    });
} catch (e) {}
let llModeRefresh = null;
try {
    new MutationObserver(function () {
        if (llThemeMode() !== "auto") return;
        const d = llIsDark() ? "1" : "0";
        if (document.body.dataset.liuliDark !== d) llApplyMode(false);
    }).observe(document.body, { attributes: true, attributeFilter: ["q-theme", "class"] });
} catch (e) {}

function buildModeControls(host) {
    const row = document.createElement("div");
    row.className = "liuli-wp-fit liuli-mode-row";
    const label = document.createElement("span");
    label.textContent = "明暗主题";
    const seg = document.createElement("div");
    seg.className = "liuli-seg";
    row.appendChild(label);
    row.appendChild(seg);
    host.appendChild(row);
    const btns = {};
    [["auto", "跟随 QQ"], ["light", "亮色"], ["dark", "暗色"]].forEach(function (p) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "liuli-seg__item";
        b.textContent = p[1];
        b.addEventListener("click", function (e) {
            try {
                if (p[0] === "auto") localStorage.removeItem(LL_MODE_KEY);
                else localStorage.setItem(LL_MODE_KEY, p[0]);
            } catch (err) {}
            llApplyMode(true, e.clientX, e.clientY);
            refresh();
        });
        seg.appendChild(b);
        btns[p[0]] = b;
    });
    function refresh() {
        const m = llThemeMode();
        Object.keys(btns).forEach(function (k) { btns[k].classList.toggle("is-active", k === m); });
    }
    llModeRefresh = refresh;
    refresh();
}

function buildPanelContent(host, settings) {
    host.innerHTML = "";

    const head = document.createElement("div");
    head.className = "liuli-panel__head";
    head.innerHTML = '<div class="liuli-panel__title">琉璃 · 电波推送</div>';
    host.appendChild(head);

    const sub = document.createElement("div");
    sub.className = "liuli-panel__sub";
    sub.textContent = "材质与外观 · 实时生效";
    host.appendChild(sub);

    const info = document.createElement("div");
    info.className = "liuli-info";
    const swatch = document.createElement("div");
    swatch.className = "liuli-swatch";
    const infoText = document.createElement("span");
    info.appendChild(swatch);
    info.appendChild(infoText);
    host.appendChild(info);
    buildModeControls(host);
    buildMarkdownControls(host);
    buildFontControls(host);
    const refreshInfo = () => {
        const src = document.body.dataset.liuliSource || DEFAULT_SOURCE;
        const brand = getComputedStyle(document.body).getPropertyValue("--ll-brand").trim();
        swatch.style.background = brand || src;
        infoText.textContent = "壁纸取色 " + src + " → 品牌 " + brand;
    };
    refreshInfo();
    setInterval(refreshInfo, 3000);

    const group = document.createElement("div");
    group.className = "liuli-panel__group";
    group.textContent = "材质";
    host.appendChild(group);

    const inputs = {};
    for (const f of FIELDS) {
        const wrap = document.createElement("div");
        wrap.className = "liuli-field";
        const row = document.createElement("div");
        row.className = "liuli-field__row";
        const label = document.createElement("div");
        label.className = "liuli-field__label";
        label.textContent = f.label;
        const value = document.createElement("div");
        value.className = "liuli-field__value";
        row.appendChild(label);
        row.appendChild(value);
        wrap.appendChild(row);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "liuli-slider";
        slider.min = f.min;
        slider.max = f.max;
        slider.step = f.step;
        slider.value = settings[f.key];
        wrap.appendChild(slider);

        const hint = document.createElement("div");
        hint.className = "liuli-field__hint";
        hint.textContent = f.hint;
        wrap.appendChild(hint);

        const sync = () => {
            const v = Number(slider.value);
            settings[f.key] = v;
            const pct = f.pct ? f.pct(v) : ((v - f.min) / (f.max - f.min)) * 100;
            slider.style.setProperty("--liuli-pct", Math.max(0, Math.min(100, pct)) + "%");
            value.textContent = f.key === "opacity" ? v.toFixed(2) : (f.unit ? v + f.unit : v.toFixed(2));
            applySettings(settings);
        };
        slider.addEventListener("input", sync);
        slider.addEventListener("change", () => saveSettings(settings));
        sync();
        inputs[f.key] = slider;
        host.appendChild(wrap);
    }

    buildWallpaperControls(host);

    const reset = document.createElement("div");
    reset.className = "liuli-field__hint";
    reset.style.cssText = "cursor:pointer;color:var(--ll-brand);margin-top:14px;";
    reset.textContent = "恢复默认";
    reset.addEventListener("click", () => {
        Object.assign(settings, DEFAULT_SETTINGS);
        for (const f of FIELDS) {
            inputs[f.key].value = settings[f.key];
            inputs[f.key].dispatchEvent(new Event("input"));
        }
        saveSettings(settings);
        toast("已恢复默认");
    });
    host.appendChild(reset);
}

let embeddedSettings = null;
// 暴露重建入口：设置页窗口里的面板是加载时构建的，改了代码需要能热重建
window.__liuliRebuildPanel = function () {
    const box = document.getElementById("liuli-embedded");
    if (!box) return "no embedded panel";
    if (!embeddedSettings) embeddedSettings = loadSettingsSync();
    buildPanelContent(box, embeddedSettings);
    return "rebuilt";
};

/* 同步版：面板构建需要立即拿到配置（loadSettings 是 async） */
function loadSettingsSync() {
    const s = Object.assign({}, DEFAULT_SETTINGS);
    const raw = (window.__liuliSettingsCache || null);
    if (raw) Object.assign(s, raw);
    return s;
}
async function initPanel() {
    const settings = await loadSettings();
    window.__liuliSettingsCache = settings;
    applySettings(settings, true);
}

(async () => {
    const started = Date.now();
    installRouteScope();
    try {
        const chunks = [];
        for (const file of FILES) {
            // wallpaper.css 是可选的本地默认壁纸（不随仓库发布），没有就跳过
            try { chunks.push(await loadText(file)); }
            catch (e) { if (!OPTIONAL_FILES.has(file)) throw e; }
        }
        ensureStyle().textContent = chunks.join("\n");
        document.body.dataset.liuliTheme = "dsh";
        llApplyFont();

        // 静态色板先兜底，再按壁纸动态覆盖（失败时保持静态值）
        try {
            const m0 = llThemeMode();
            if (m0 !== "auto") document.body.dataset.liuliMode = m0;
            document.body.dataset.liuliDark = llIsDark() ? "1" : "0";
        } catch (e) {}
        try { await applyDynamicPalette(); }
        catch (e) { console.warn("[liuli-dsh-theme] dynamic palette failed:", e && e.message); }

        renderWallpaper(loadWallpaperState());
        applyOverrides();
        fixContrast();
        normalizeColors();
        setInterval(() => { if (window.__liuliPause) return; if (document.querySelector(".q-dialog-modal")) { mountInputBar(); return; } applyOverrides(); fixContrast(); normalizeColors(); keepWindowControlsVisible(); mountInputBar(); groupMessages(); stickAvatars(); markQuoteRoots(); moveSenderIntoBubble(); ensureHoverEntries(); llWatchContactList(); llGroupMembersPass(); llMarkdownPass(); }, 1500);
        installMarkdownObserver();
        installAvatarStick();
        ensureHoverEntries();
        installMessageObserver();
        installSideListObserver();
        llWatchContactList();
        liuliMessagePass();
        try { await initPanel(); } catch (e) { console.warn("[liuli-dsh-theme] panel failed:", e && e.message); }
        console.log("[liuli-dsh-theme] ready in " + (Date.now() - started) + "ms");
    } catch (error) {
        console.error("[liuli-dsh-theme] inject failed:", error && error.message);
        try { document.body.dataset.liuliTheme = "failed"; } catch (e) {}
    }
})();


/* ---------- 设置入口（LiteLoader 官方） ----------
 * LiteLoader 会在设置页左栏为每个插件加一项，点进去就是这个 view。
 */
export const onSettingWindowCreated = async view => {
    let cfg;
    try { cfg = await loadSettings(); } catch (e) { cfg = Object.assign({}, DEFAULT_SETTINGS); }
    window.__liuliSettingsCache = cfg;
    embeddedSettings = cfg;
    const box = document.createElement("div");
    box.id = "liuli-embedded";
    box.className = "liuli-embedded";
    view.appendChild(box);
    buildPanelContent(box, embeddedSettings);
};


/* ---------- Markdown 渲染（移植自 BetterQQNT 的 inlineMarkdown） ----------
 * 只认行内语法：`代码`、**粗体**、*斜体*、~~删除线~~、||剧透||，换行保留。
 * 先整体转义再替换，所以消息里的 < > & 不会变成标签。
 * 只处理聊天记录里的 .text-normal；原文存在 data-ll-md-src，关掉开关时原样还原。
 * 开关存 localStorage（设置窗口与主窗口同源，storage 事件实时同步）。
 */
const LL_MD_KEY = "liuli-md-render";
const LL_MD_TRIGGER = /`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\|/;

function llMdEnabled() {
    try { return localStorage.getItem(LL_MD_KEY) !== "0"; } catch (e) { return true; }
}

function llInlineMarkdown(md) {
    return md
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\s][^*\n]*)\*/g, "<em>$1</em>")
        .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
        .replace(/\|\|([^|\n]+)\|\|/g, '<span class="ll-spoiler">$1</span>')
        .replace(/\n/g, "<br>");
}

function llMarkdownPass() {
    // 性能：滚动时这里会被频繁调用。只读 textContent（不触发排版），
    // 判过的元素在节点上记一个属性，文本没变就直接跳过。
    try {
        const on = llMdEnabled();
        const els = document.querySelectorAll(".ml-item .text-normal");
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (!on) {
                if (el.__llMdSrc !== undefined) {
                    el.textContent = el.__llMdSrc;
                    el.__llMdSrc = undefined;
                    el.__llMdSeen = undefined;
                    const box = el.closest(".message-content");
                    if (box) box.classList.remove("ll-inline-md");
                }
                continue;
            }
            const text = el.textContent;
            if (el.__llMdSeen === text) continue;          // 原文没变 / 渲染结果没被 Vue 改写
            if (!LL_MD_TRIGGER.test(text)) { el.__llMdSeen = text; el.__llMdSrc = undefined; continue; }
            el.__llMdSrc = text;
            el.innerHTML = llInlineMarkdown(text);
            el.__llMdSeen = el.textContent;
            const box = el.closest(".message-content");
            if (box) box.classList.add("ll-inline-md");
        }
    } catch (e) { /* 静默 */ }
}

/* ---------- 消息入场：级联 ----------
 * 只给两种情况做动画，滚动加载历史时不做（否则一滚就闪）：
 *   1. 刚切到一个会话：600ms 内出现的消息，从下往上依次浮入，每条错开 28ms，最多 14 条
 *   2. 新消息：加到列表最末尾的那条
 * 动画只用 opacity + transform，交给合成层，不触发排版。 */
let llEnterPeer = "";
let llEnterUntil = 0;
const LL_ENTER_MAX = 14;

function llCurrentPeer() {
    const rec = llMsgRecordOf(document.querySelector(".chat-msg-area .message"));
    return rec ? String(rec.peerUid) : "";
}

function llAnimateEnter(items) {
    if (!items.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 越靠下（越新）越先出来
    items.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    items.slice(0, LL_ENTER_MAX).forEach((el, i) => {
        el.style.setProperty("--ll-enter-i", String(i));
        el.classList.remove("ll-enter");
        void el.offsetWidth;
        el.classList.add("ll-enter");
        clearTimeout(el.__llEnterT);
        el.__llEnterT = setTimeout(() => el.classList.remove("ll-enter"), 400 + i * 28);
    });
}

function llHandleAdded(records) {
    const added = [];
    for (const r of records) {
        for (const n of r.addedNodes) {
            if (n.nodeType === 1 && n.classList.contains("ml-item")) added.push(n);
        }
    }
    if (!added.length) return;
    const now = Date.now();
    const peer = llCurrentPeer();
    if (peer && peer !== llEnterPeer) { llEnterPeer = peer; llEnterUntil = now + 600; }
    if (now < llEnterUntil) { llAnimateEnter(added); return; }
    // 新消息：节点是列表里最后一条
    const fresh = added.filter(n => !n.nextElementSibling);
    if (fresh.length) llAnimateEnter(fresh);
}

function installMarkdownObserver() {
    if (window.__llMdObserver) return;
    // 性能：DOM 变动后 150ms 才跑一次（滚动期间合并成一次），不再每帧跑
    let timer = 0;
    const run = () => { timer = 0; llMarkdownPass(); llAtPass(); };
    window.__llMdObserver = new MutationObserver(records => {
        try { llHandleAdded(records); } catch (e) {}
        if (!timer) timer = setTimeout(run, 150);
    });
    window.__llMdObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", e => { if (e.key === LL_MD_KEY) llMarkdownPass(); });
    run();
}

function buildMarkdownControls(host) {
    const row = document.createElement("div");
    row.className = "liuli-wp-fit liuli-mode-row";
    const label = document.createElement("span");
    label.textContent = "Markdown 渲染";
    const seg = document.createElement("div");
    seg.className = "liuli-seg";
    row.appendChild(label);
    row.appendChild(seg);
    host.appendChild(row);
    const btns = {};
    [["1", "开启"], ["0", "关闭"]].forEach(function (p) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "liuli-seg__item";
        b.textContent = p[1];
        b.addEventListener("click", function () {
            try { localStorage.setItem(LL_MD_KEY, p[0]); } catch (err) {}
            llMarkdownPass();
            refresh();
        });
        seg.appendChild(b);
        btns[p[0]] = b;
    });
    function refresh() {
        const cur = llMdEnabled() ? "1" : "0";
        Object.keys(btns).forEach(function (k) { btns[k].classList.toggle("is-active", k === cur); });
    }
    refresh();
}


/* ---------- 读消息数据 ----------
 * QQ 9.9.36 在 .message 元素上挂了 __VUE__（组件实例数组），props.msgRecord 就是这条消息。
 * 实测见 probe/ll-probe。 */
function llMsgRecordOf(el) {
    try {
        const m = el && el.closest && el.closest(".message");
        const inst = m && m.__VUE__ && m.__VUE__[0];
        return (inst && inst.props && inst.props.msgRecord) || null;
    } catch (e) { return null; }
}

/* ---------- @ 高亮：@我 与 @别人 分两种颜色 ----------
 * 每个 @ 是 .text-element[data-element-id] > .text-element--at，
 * 用 elementId 在 msgRecord.elements 里找到对应元素，比对 atNtUid 与自己的 uid。
 * atType 1 是 @全体成员，算作 @我。 */
let llSelfUid = "";
function llLoadSelfUid() {
    if (llSelfUid || !window.liuli_api) return;
    window.liuli_api.selfUid().then(uid => { if (uid) { llSelfUid = String(uid); llAtPass(); } }).catch(() => {});
}

function llAtPass() {
    try {
        if (!llSelfUid) { llLoadSelfUid(); return; }
        const ats = document.querySelectorAll(".ml-item .text-element--at");
        for (let i = 0; i < ats.length; i++) {
            const at = ats[i];
            const holder = at.closest("[data-element-id]");
            if (!holder) continue;
            const id = holder.getAttribute("data-element-id");
            if (at.dataset.llAtId === id) continue;   // 已判过（节点被复用时 id 会变）
            const rec = llMsgRecordOf(at);
            if (!rec || !Array.isArray(rec.elements)) continue;
            const el = rec.elements.find(e => String(e.elementId) === id);
            const te = el && el.textElement;
            if (!te) continue;
            const me = te.atType === 1 || (te.atNtUid && String(te.atNtUid) === llSelfUid);
            at.dataset.llAt = me ? "me" : "other";
            at.dataset.llAtId = id;
        }
    } catch (e) { /* 静默 */ }
}


/* ---------- 字体 ----------
 * 设置页里选一个本机已安装的字体，整个 QQ 界面换成它（代码块仍用等宽字体）。
 * 存 localStorage（设置窗口与主窗口同源，storage 事件实时同步）；空 = 默认 MiSans。
 * 候选列表：先试 Chromium 的 queryLocalFonts（要权限，QQ 可能不给），
 * 不给就用常见中文字体名单，靠 canvas 量宽度判断本机装没装。 */
const LL_FONT_KEY = "liuli-font";
const LL_FONT_CANDIDATES = [
    "MiSans", "HarmonyOS Sans SC", "OPPOSans", "vivo Sans", "Alibaba PuHuiTi 3.0", "阿里巴巴普惠体 3.0",
    "LXGW WenKai", "霞鹜文楷", "LXGW WenKai Screen", "霞鹜文楷 屏幕阅读版",
    "Source Han Sans SC", "思源黑体", "Noto Sans SC", "Noto Sans CJK SC", "Sarasa UI SC", "更纱黑体 UI SC",
    "Microsoft YaHei UI", "Microsoft YaHei", "微软雅黑", "DengXian", "等线", "PingFang SC",
    "Inter", "Segoe UI", "SimHei", "黑体", "KaiTi", "楷体", "SimSun", "宋体", "FangSong", "仿宋",
];

function llFontName() {
    try { return (localStorage.getItem(LL_FONT_KEY) || "").trim(); } catch (e) { return ""; }
}

// 只留字体名里正常的字符，防止拼进 CSS 时出问题
function llCleanFont(name) {
    return String(name || "").replace(/["'\\;{}<>]/g, "").trim().slice(0, 64);
}

function llApplyFont() {
    const name = llCleanFont(llFontName());
    const b = document.body;
    if (!b) return;
    if (!name) {
        b.style.removeProperty("--ll-font");
        delete b.dataset.llFont;
        return;
    }
    b.style.setProperty("--ll-font", '"' + name + '", "MiSans", "Microsoft YaHei UI", system-ui, sans-serif, "Segoe UI Emoji"');
    b.dataset.llFont = "1";
}
window.addEventListener("storage", e => { if (e.key === LL_FONT_KEY) llApplyFont(); });

let llFontCtx = null;
function llFontInstalled(name) {
    try {
        if (!llFontCtx) llFontCtx = document.createElement("canvas").getContext("2d");
        const sample = "永和九年岁在癸丑 Hamburgefonstiv 0123";
        for (const base of ["monospace", "serif"]) {
            llFontCtx.font = "32px " + base;
            const w0 = llFontCtx.measureText(sample).width;
            llFontCtx.font = '32px "' + name + '", ' + base;
            if (llFontCtx.measureText(sample).width !== w0) return true;
        }
    } catch (e) {}
    return false;
}

async function llListFonts() {
    try {
        if (window.queryLocalFonts) {
            const fonts = await window.queryLocalFonts();
            const names = Array.from(new Set(fonts.map(f => f.family))).sort((a, b) => a.localeCompare(b, "zh"));
            if (names.length) return names;
        }
    } catch (e) { /* 没权限，退回名单 */ }
    return LL_FONT_CANDIDATES.filter(llFontInstalled);
}

function buildFontControls(host) {
    const row = document.createElement("div");
    row.className = "liuli-wp-fit liuli-mode-row";
    const label = document.createElement("span");
    label.textContent = "字体";
    const box = document.createElement("div");
    box.style.cssText = "display:flex;gap:6px;align-items:center;flex:1;justify-content:flex-end;";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "默认（MiSans）";
    input.value = llFontName();
    input.setAttribute("list", "liuli-font-list");
    input.style.cssText = "width:180px;height:28px;padding:0 10px;border-radius:8px;border:none;outline:none;" +
        "background:rgba(var(--ll-on-glass-rgb),0.08);color:var(--ll-on-glass);font:inherit;font-size:13px;";
    const list = document.createElement("datalist");
    list.id = "liuli-font-list";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "liuli-seg__item";
    reset.textContent = "默认";
    box.appendChild(input);
    box.appendChild(list);
    box.appendChild(reset);
    row.appendChild(label);
    row.appendChild(box);
    host.appendChild(row);

    const apply = name => {
        name = llCleanFont(name);
        try {
            if (name) localStorage.setItem(LL_FONT_KEY, name);
            else localStorage.removeItem(LL_FONT_KEY);
        } catch (e) {}
        input.value = name;
        llApplyFont();
    };
    input.addEventListener("change", () => apply(input.value));
    input.addEventListener("keydown", e => { if (e.key === "Enter") apply(input.value); });
    reset.addEventListener("click", () => apply(""));

    llListFonts().then(names => {
        list.innerHTML = "";
        for (const n of names) {
            const o = document.createElement("option");
            o.value = n;
            list.appendChild(o);
        }
        input.title = names.length ? "本机可用 " + names.length + " 种，点输入框可选" : "直接输入字体名";
    });
}
