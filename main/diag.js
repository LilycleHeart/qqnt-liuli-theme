// 琉璃主题插件 · 主进程诊断（main/diag.js）
// ----------------------------------------------------------------------------
// 契约：installer/DIAG-COVERAGE.md 第三 / 3.1 / 3.4 节。要点：
//   1. session.log：每次启动留痕，单文件 ≤256KB，超出轮转为 session.1.log，最多 2 个历史。
//   2. diagLog：渲染进程单向转发错误，主进程再截断（≤8KB/条）后落 session.log。
//   3. diagExport：采集环境 / 插件 / 配置 / 安装器日志 / QQ 日志尾部 / 窗口快照（可选截图），
//      输出 report.txt + meta.json + environment.json + snapshots + logs [+ screenshots/wallpaper]，
//      纯 JS 写 ZIP（zlib.deflateRawSync + 手写 CRC32/中央目录 + UTF-8 标志 0x0800）。
//   4. 主输出 桌面 → documents → temp → data/liuli-dsh-theme/diag 回退；成功后复制一份到 diag/（保留 3 个）。
//   5. 任何一项采集失败都不影响整包：失败写 report.txt 的「采集失败清单」。
//   6. 所有文本过 sanitizeText 脱敏（uin=/uid=/u_xxx/邮箱/长 base64/sk-/Bearer），单行 ≤1000 字符。
//
// 依赖一律「延迟取」：本文件在纯 Node 下 require 不报错（便于单测），
// 只有真正调用 createDiag() 时才去拿 electron / LiteLoader。
// ----------------------------------------------------------------------------
"use strict";

const SLUG = "liuli-dsh-theme";
const SCHEMA = 1;
const FALLBACK_VERSION = "1.3.0";

const SESSION_MAX_BYTES = 256 * 1024;   // session.log 单文件上限
const SESSION_HISTORY = 2;              // session.1.log / session.2.log
const MAX_LOG_LINE_BYTES = 8 * 1024;    // diagLog 单条上限
const DIAG_KEEP = 3;                    // diag/ 最多保留 3 个 zip

const QQ_LOG_MAX_BYTES = 120 * 1024;    // QQ 日志每个文件尾部上限
const QQ_LOG_FILES = 8;                 // 最新 8 个
const LL_LOG_MAX_BYTES = 64 * 1024;     // 其它插件 data 日志每个尾部上限
const LL_LOG_FILES = 10;                // 最多 10 个
const LL_LOG_FILE_MAX = 2 * 1024 * 1024;
const LL_LOG_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

const CONFIG_MAX_BYTES = 4096;
const MANIFEST_RAW_MAX = 2048;          // manifest 原文展示上限（解析仍用全文）
const MANIFEST_PARSE_MAX = 256 * 1024;
const INSTALLER_TAIL_LINES = 200;

const SHOT_MAX_BYTES = 4 * 1024 * 1024; // 单张截图上限
const SHOTS_TOTAL_MAX = 12 * 1024 * 1024;
const SNAPSHOT_TIMEOUT_MS = 6000;       // 异步 collectDiagnostics 限时（导出是用户主动操作，6s 可接受）
const SNAPSHOT_TIMEOUT_SYNC_MS = 3000;  // 回退同步 __liuliDiagSnapshot 限时
const CAPTURE_TIMEOUT_MS = 5000;
const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;
const REPORT_LINE_MAX = 1000;

const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_VERSION = 20;

// 同步快照：老渲染进程 / 异步失败时的回退（契约 3.2）；拿不到就写「未定义」说明。
const SNAP_SCRIPT =
    "(function(){try{var fn=window.__liuliDiagSnapshot;" +
    "if(typeof fn===\"function\"){return JSON.stringify(fn());}return \"null\";}" +
    "catch(e){return JSON.stringify({_snapshotError:String((e&&e.message)||e)});}})()";

// 窗口快照优先走异步 collectDiagnostics（逐文件 fetch/inStyle/optional/chars 只有异步版才有）；
// 渲染进程没有异步入口时脚本内部直接回退同步；异步异常则返回 {mode:"async-error"} 让主进程再回退。
// 返回统一信封：{ mode: "async"|"sync"|"async-error"|"error"|"none", snapshot?, error? }
const SNAP_SCRIPT_ASYNC =
    "(function(){try{var C=window.__liuliDiagCollect;" +
    "if(typeof C===\"function\"){" +
    "return Promise.resolve().then(function(){return C({files:true,quota:false,wallpaperDecode:false,defaultWallpaper:false});})" +
    ".then(function(s){return JSON.stringify({mode:\"async\",snapshot:(s&&typeof s===\"object\")?s:null});})" +
    ".catch(function(e){return JSON.stringify({mode:\"async-error\",error:String((e&&e.message)||e)});});" +
    "}" +
    "var F=window.__liuliDiagSnapshot;" +
    "if(typeof F===\"function\"){var v=F();return JSON.stringify({mode:\"sync\",snapshot:(v&&typeof v===\"object\")?v:null});}" +
    "return JSON.stringify({mode:\"none\"});" +
    "}catch(e){return JSON.stringify({mode:\"error\",error:String((e&&e.message)||e)});}})()";

const EXCLUDED_WINDOW_URLS = [
    /screenshot\.html/i,
    /hiddenWindow\.html/i,
    /^about:blank$/i
];

const LEVELS = ["error", "warn", "info", "debug"];

/* ══════════════════════════════════════════════════════════════════════════
 * 一、极小工具
 * ══════════════════════════════════════════════════════════════════════════ */

function lazyRequire(id) {
    try { return require(id); } catch (e) { return null; }
}

function nowIso() { return new Date().toISOString(); }

function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

function clip(text, max) {
    const s = text === null || text === undefined ? "" : String(text);
    return s.length > max ? s.slice(0, max) + "…" : s;
}

function clipBytes(text, maxBytes) {
    const s = text === null || text === undefined ? "" : String(text);
    const buf = Buffer.from(s, "utf8");
    if (buf.length <= maxBytes) return s;
    // 按字节截断后可能切坏多字节字符，再转一次字符串会带替换符，可接受
    let cut = buf.slice(0, maxBytes).toString("utf8");
    if (cut.endsWith("\uFFFD")) cut = cut.slice(0, -1);
    return cut + "\n…[单条日志超长，已截断]";
}

function errMsg(error) {
    if (!error) return "未知错误";
    if (typeof error === "string") return error;
    return String(error.message || error.name || error);
}

function stringifySafe(value) {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
}

function bytesText(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return "?";
    if (num < 1024) return num + " B";
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + " KB";
    if (num < 1024 * 1024 * 1024) return (num / 1024 / 1024).toFixed(2) + " MB";
    return (num / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function pad2(n) { return String(n).padStart(2, "0"); }

function localStamp(d) {
    const dt = d instanceof Date ? d : new Date();
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate()) +
        " " + pad2(dt.getHours()) + ":" + pad2(dt.getMinutes()) + ":" + pad2(dt.getSeconds());
}

function fileStamp(d) {
    const dt = d instanceof Date ? d : new Date();
    return "" + dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()) +
        "-" + pad2(dt.getHours()) + pad2(dt.getMinutes()) + pad2(dt.getSeconds());
}

function tzOffsetText(d) {
    const dt = d instanceof Date ? d : new Date();
    const minutes = -dt.getTimezoneOffset();
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    return "UTC" + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
}

function isoOf(dateLike) {
    try {
        const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
        return isNaN(d.getTime()) ? null : d.toISOString();
    } catch (e) { return null; }
}

function stripBom(text) {
    const s = String(text === null || text === undefined ? "" : text);
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function bomKind(buf) {
    if (!buf || buf.length < 3) return null;
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return "utf8-bom";
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return "utf16le-bom";
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return "utf16be-bom";
    return null;
}

function decodeBuffer(buf) {
    if (!buf || !buf.length) return "";
    const bom = bomKind(buf);
    if (bom === "utf16le-bom") return buf.slice(2).toString("utf16le");
    if (bom === "utf8-bom") return buf.slice(3).toString("utf8");
    return buf.toString("utf8");
}

/** 简单二进制判定：NUL 或大量不可打印控制字符就认为是二进制 */
function looksBinary(buf) {
    if (!buf || !buf.length) return false;
    if (bomKind(buf)) return false;
    const n = Math.min(buf.length, 4096);
    let bad = 0;
    for (let i = 0; i < n; i++) {
        const b = buf[i];
        if (b === 0) return true;
        if (b < 9 || (b > 13 && b < 32)) bad++;
    }
    return bad / n > 0.1;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 二、脱敏（隐私契约 3.4）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 行内脱敏：不改变行结构，只替换敏感片段。
 * 覆盖 uin= / uid= / 裸 u_xxx / 邮箱 / 长 base64（含 dataURL） / sk- / Bearer。
 */
function maskInline(input) {
    if (input === null || input === undefined) return "";
    let s = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);

    // 1) dataURL：整段 base64 换成长度说明（壁纸/头像最容易从这里泄漏）
    s = s.replace(/data:([\w.+-]+\/[\w.+-]+);base64,[A-Za-z0-9+/=_-]{32,}/g,
        (m, mime) => "data:" + mime + ";base64,<已脱敏 base64，" + m.length + " 字符>");

    // 2) 裸长 base64（≥160 连续字符，首尾不接 base64 字符，避免把普通文本切碎）
    s = s.replace(/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{160,}={0,2}(?![A-Za-z0-9+/=_-])/g,
        m => "<已脱敏 base64，" + m.length + " 字符>");

    // 3) Bearer token / sk- 密钥
    s = s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***");
    s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***");

    // 4) 邮箱：保留域名，本地部分抹掉
    s = s.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "***@$2");

    // 5) uin= / uin: / "uin": 123456789（键名带引号时中间还有一层引号）
    s = s.replace(/(\buin\b["']?\s*[:=]\s*)(["']?)(\d{3,20})\2/gi, "$1$2***$2");
    // 6) uid= / uid: / "uid": u_xxx（先按键名脱，再兜裸 u_xxx）
    s = s.replace(/(\buid\b["']?\s*[:=]\s*)(["']?)([A-Za-z0-9_-]{4,64})\2/gi, "$1$2***$2");
    // 7) 裸 u_xxx（QQNT uid）
    s = s.replace(/\bu_[A-Za-z0-9_-]{4,}\b/g, "u_***");

    return s;
}

/**
 * 文本脱敏：行内脱敏 + 单行 ≤1000 字符（契约 3.4「单行 ≤1000 字符」）。
 * 用于 report.txt / logs/*.log 这类人读文本。
 */
function sanitizeText(input) {
    if (input === null || input === undefined) return "";
    let text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
    text = maskInline(text);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > REPORT_LINE_MAX) {
            lines[i] = lines[i].slice(0, REPORT_LINE_MAX) + "…[本行超长已截断]";
        }
    }
    return lines.join("\n");
}

/**
 * 深层脱敏：给 JSON 用。字符串逐个 maskInline 并截到 900 字符，
 * 数组/对象限深度/数量，防止渲染进程塞进来一个巨型对象把 zip 撑爆。
 */
function deepSanitize(value, depth) {
    const d = typeof depth === "number" ? depth : 0;
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === "string") return clip(maskInline(value), 900);
    if (t === "number" || t === "boolean") return value;
    if (t === "bigint") return String(value);
    if (t === "function" || t === "symbol") return "<" + t + ">";
    if (d >= 9) return "<深度截断>";
    if (Array.isArray(value)) {
        const out = value.slice(0, 200).map(item => deepSanitize(item, d + 1));
        if (value.length > 200) out.push("<还有 " + (value.length - 200) + " 项>");
        return out;
    }
    if (t === "object") {
        const out = {};
        let idx = 0;
        for (const key of Object.keys(value)) {
            if (idx++ >= 200) { out["<更多键>"] = Object.keys(value).length - 200; break; }
            out[clip(String(key), 120)] = deepSanitize(value[key], d + 1);
        }
        return out;
    }
    return String(value);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 三、纯 JS ZIP（CRC32 + local header + central directory + EOCD）
 * ══════════════════════════════════════════════════════════════════════════ */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ""), "utf8");
    for (let i = 0; i < data.length; i++) {
        c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(dateLike) {
    const d = dateLike instanceof Date ? dateLike : new Date();
    const year = Math.max(1980, Math.min(2107, d.getFullYear()));
    return {
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
    };
}

function uniqueEntryName(name, seen) {
    if (!seen.has(name)) return name;
    const slash = name.lastIndexOf("/");
    const dot = name.lastIndexOf(".");
    const head = slash >= 0 ? name.slice(0, slash + 1) : "";
    const file = slash >= 0 ? name.slice(slash + 1) : name;
    const base = dot > slash ? name.slice(0, dot) : name;
    const ext = dot > slash ? name.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
        const candidate = dot > slash ? base + "-" + i + ext : head + file + "-" + i;
        if (!seen.has(candidate)) return candidate;
    }
    return head + file + "-" + Date.now();
}

/**
 * 打包 zip。条目名字正斜杠、UTF-8（flags 0x0800）。
 * @param {Array<{name:string,data:Buffer|string}>} entries
 * @param {{mtime?:Date, zlib?:object}} [options]
 * @returns {Buffer}
 */
function buildZip(entries, options) {
    if (!Array.isArray(entries)) throw new Error("buildZip 需要 entries 数组");
    const opts = options || {};
    const zlib = opts.zlib || lazyRequire("node:zlib");
    if (!zlib || typeof zlib.deflateRawSync !== "function") throw new Error("缺少 zlib.deflateRawSync");
    const mtime = opts.mtime instanceof Date ? opts.mtime : new Date();
    const dos = dosDateTime(mtime);

    const localChunks = [];
    const centralChunks = [];
    const seen = new Set();
    let offset = 0;

    for (const item of entries) {
        if (!item || typeof item.name !== "string") throw new Error("ZIP 条目缺少 name");
        let name = item.name.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\.\//g, "");
        if (!name) throw new Error("ZIP 条目名为空");
        name = uniqueEntryName(name, seen);
        seen.add(name);

        const data = Buffer.isBuffer(item.data)
            ? item.data
            : Buffer.from(item.data === undefined || item.data === null ? "" : String(item.data), "utf8");
        if (data.length > 0xFFFFFFFF) throw new Error("ZIP 条目超过 4GB：" + name);

        const compressed = zlib.deflateRawSync(data, { level: 9 });
        const crc = crc32(data);
        const nameBuf = Buffer.from(name, "utf8");

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(ZIP_VERSION, 4);
        local.writeUInt16LE(ZIP_FLAG_UTF8, 6);
        local.writeUInt16LE(ZIP_METHOD_DEFLATE, 8);
        local.writeUInt16LE(dos.time, 10);
        local.writeUInt16LE(dos.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        localChunks.push(local, nameBuf, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x0014, 4);        // version made by: DOS/FAT
        central.writeUInt16LE(ZIP_VERSION, 6);   // version needed
        central.writeUInt16LE(ZIP_FLAG_UTF8, 8);
        central.writeUInt16LE(ZIP_METHOD_DEFLATE, 10);
        central.writeUInt16LE(dos.time, 12);
        central.writeUInt16LE(dos.date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);            // extra len
        central.writeUInt16LE(0, 32);            // comment len
        central.writeUInt16LE(0, 34);            // disk start
        central.writeUInt16LE(0, 36);            // internal attrs
        central.writeUInt32LE(0, 38);            // external attrs
        central.writeUInt32LE(offset, 42);       // local header offset
        centralChunks.push(central, nameBuf);

        offset += local.length + nameBuf.length + compressed.length;
    }

    if (seen.size > 0xFFFF) throw new Error("ZIP 条目过多（>65535），不做 zip64");

    const centralDir = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);                    // disk number
    eocd.writeUInt16LE(0, 6);                    // central dir start disk
    eocd.writeUInt16LE(seen.size, 8);
    eocd.writeUInt16LE(seen.size, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);                   // comment len

    return Buffer.concat(localChunks.concat([centralDir, eocd]));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 四、session.log（有界流水）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {{fs:any,path:any}} D
 * @param {string} dir  <data>/liuli-dsh-theme
 */
function createSessionLog(D, dir) {
    const fileOf = i => D.path.join(dir, i === 0 ? "session.log" : "session." + i + ".log");
    const file = fileOf(0);
    let cachedSize = -1;

    function ensureDir() {
        try { D.fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 落盘失败也不能炸 */ }
    }

    function sizeOf(name) {
        try {
            const st = D.fs.statSync(name);
            return st.isFile() ? st.size : 0;
        } catch (e) { return 0; }
    }

    function currentSize() {
        if (cachedSize < 0) cachedSize = sizeOf(file);
        return cachedSize;
    }

    function rotate() {
        try {
            // 最老的先删：session.<history>.log
            try { D.fs.unlinkSync(fileOf(SESSION_HISTORY)); } catch (e) { }
            for (let i = SESSION_HISTORY - 1; i >= 1; i--) {
                const from = fileOf(i);
                if (sizeOf(from) > 0) {
                    try { D.fs.renameSync(from, fileOf(i + 1)); } catch (e) { }
                }
            }
            try { D.fs.renameSync(file, fileOf(1)); } catch (e) { }
        } catch (e) { /* 轮转失败继续追加，不抛 */ }
        cachedSize = 0;
    }

    function write(text) {
        if (!text) return;
        const buf = Buffer.from(String(text), "utf8");
        ensureDir();
        if (currentSize() + buf.length > SESSION_MAX_BYTES) rotate();
        try {
            D.fs.appendFileSync(file, buf);
            cachedSize = currentSize() + buf.length;
        } catch (e) {
            cachedSize = -1; // 下次重新 stat
        }
    }

    function log(level, scope, message, extra) {
        const lv = LEVELS.indexOf(String(level)) >= 0 ? String(level) : "info";
        let text = nowIso() + " [" + lv + "] " + clip(sanitizeText(scope || "main"), 80) +
            ": " + clip(sanitizeText(message === undefined ? "" : message), 4000);
        if (extra !== undefined) {
            text += " | extra=" + clip(sanitizeText(stringifySafe(extra)), 2000);
        }
        write(text + "\n");
    }

    /** 渲染进程 diagLog 条目：{t, level, scope, msg, stack?, extra?} */
    function entry(raw) {
        const e = isObject(raw) ? raw : { msg: raw };
        const lv = LEVELS.indexOf(String(e.level)) >= 0 ? String(e.level) : "info";
        const when = (typeof e.t === "string" && e.t.length <= 40) ? sanitizeText(e.t) : nowIso();
        const scope = clip(sanitizeText(e.scope === undefined ? "renderer" : e.scope), 80);
        const msg = clip(sanitizeText(e.msg === undefined ? "" : e.msg), 4000);
        let text = when + " [" + lv + "] " + scope + ": " + msg;
        if (e.stack) {
            const stackLines = String(e.stack).split(/\r?\n/).slice(0, 30);
            for (const line of stackLines) text += "\n    stack: " + clip(sanitizeText(line), 500);
        }
        if (e.extra !== undefined) {
            text += "\n    extra: " + clip(sanitizeText(stringifySafe(e.extra)), 1500);
        }
        let out = clipBytes(text + "\n", MAX_LOG_LINE_BYTES);
        if (!out.endsWith("\n")) out += "\n";
        write(out);
    }

    function banner(info) {
        write("\n===== 琉璃诊断 session =====\n");
        log("info", "main", "启动", info);
    }

    /** 读回 session.log（含轮转历史），用于打包 */
    function readAll() {
        const list = [];
        for (let i = 0; i <= SESSION_HISTORY; i++) {
            const name = fileOf(i);
            let st;
            try { st = D.fs.statSync(name); } catch (e) { continue; }
            if (!st.isFile()) continue;
            let buf;
            try {
                const len = Math.min(st.size, SESSION_MAX_BYTES + 4096);
                buf = Buffer.alloc(len);
                const fd = D.fs.openSync(name, "r");
                try { D.fs.readSync(fd, buf, 0, len, 0); } finally { D.fs.closeSync(fd); }
            } catch (e) { continue; }
            list.push({
                name: i === 0 ? "session.log" : "session." + i + ".log",
                text: decodeBuffer(buf),
                size: st.size,
                mtime: isoOf(st.mtime)
            });
        }
        return list;
    }

    return { file, log, entry, banner, readAll, write };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 五、路径解析 / 文件读取
 * ══════════════════════════════════════════════════════════════════════════ */

function safeGet(obj, keys) {
    let cur = obj;
    for (const key of keys) {
        if (cur === null || cur === undefined) return null;
        try { cur = cur[key]; } catch (e) { return null; }
    }
    return cur === undefined ? null : cur;
}

function statSafe(D, file) {
    try {
        const st = D.fs.statSync(file);
        return {
            exists: true,
            isFile: st.isFile(),
            isDirectory: st.isDirectory(),
            size: st.size,
            mtime: isoOf(st.mtime),
            mtimeMs: st.mtimeMs
        };
    } catch (e) {
        return { exists: false, error: errMsg(e) };
    }
}

function readdirSafe(D, dir) {
    try {
        return D.fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) { return []; }
}

/**
 * 读文件尾部。返回 {ok, text, size, truncated, binary, mtime}，不抛异常。
 * @param {{D:any,file:string,maxBytes:number,keepLines?:number}} opts
 */
function readTail(D, file, maxBytes, keepWholeLines) {
    const out = { ok: false, text: "", size: 0, truncated: false, binary: false, mtime: null, error: null };
    let st;
    try { st = D.fs.statSync(file); } catch (e) { out.error = errMsg(e); return out; }
    if (!st.isFile()) { out.error = "不是文件"; return out; }
    out.size = st.size;
    out.mtime = isoOf(st.mtime);
    if (st.size === 0) { out.ok = true; return out; }

    const start = Math.max(0, st.size - maxBytes);
    const len = st.size - start;
    let buf;
    try {
        buf = Buffer.alloc(len);
        const fd = D.fs.openSync(file, "r");
        try { D.fs.readSync(fd, buf, 0, len, start); } finally { D.fs.closeSync(fd); }
    } catch (e) { out.error = errMsg(e); return out; }

    if (looksBinary(buf)) { out.binary = true; out.ok = true; return out; }

    let text = decodeBuffer(buf);
    out.truncated = start > 0;
    if (start > 0 && keepWholeLines !== false) {
        const nl = text.indexOf("\n");
        if (nl >= 0) text = text.slice(nl + 1);
    }
    out.text = text;
    out.ok = true;
    return out;
}

function readWholeText(D, file, maxBytes) {
    const out = { ok: false, text: "", size: 0, truncated: false, error: null };
    let st;
    try { st = D.fs.statSync(file); } catch (e) { out.error = errMsg(e); return out; }
    if (!st.isFile()) { out.error = "不是文件"; return out; }
    out.size = st.size;
    const len = Math.min(st.size, typeof maxBytes === "number" ? maxBytes : st.size);
    let buf;
    try {
        buf = Buffer.alloc(len);
        const fd = D.fs.openSync(file, "r");
        try { D.fs.readSync(fd, buf, 0, len, 0); } finally { D.fs.closeSync(fd); }
    } catch (e) { out.error = errMsg(e); return out; }
    out.text = decodeBuffer(buf);
    out.truncated = st.size > len;
    out.ok = true;
    return out;
}

/** 目录统计（限制深度/条目数，避免被巨型缓存目录拖死） */
function dirStats(D, dir, maxDepth, maxEntries) {
    const out = { exists: false, files: 0, dirs: 0, bytes: 0, entries: [] };
    const depthLimit = typeof maxDepth === "number" ? maxDepth : 3;
    const entryLimit = typeof maxEntries === "number" ? maxEntries : 60;
    const rootStat = statSafe(D, dir);
    if (!rootStat.exists || !rootStat.isDirectory) return out;
    out.exists = true;

    const walk = (current, depth) => {
        if (depth > depthLimit) return;
        const list = readdirSafe(D, current);
        for (const ent of list) {
            const full = D.path.join(current, ent.name);
            const rel = D.path.relative(dir, full).replace(/\\/g, "/");
            if (ent.isDirectory()) {
                out.dirs++;
                if (out.entries.length < entryLimit) out.entries.push({ name: rel, dir: true });
                walk(full, depth + 1);
            } else if (ent.isFile()) {
                const st = statSafe(D, full);
                out.files++;
                if (st.size) out.bytes += st.size;
                if (out.entries.length < entryLimit) {
                    out.entries.push({ name: rel, size: st.size || 0, mtime: st.mtime });
                }
            }
        }
    };
    walk(dir, 0);
    return out;
}

function sha256File(D, file, maxBytes) {
    const crypto = D.crypto || lazyRequire("node:crypto");
    const st = statSafe(D, file);
    if (!st.exists || !st.isFile) return null;
    if (typeof maxBytes === "number" && st.size > maxBytes) return { skipped: true, size: st.size };
    try {
        const buf = D.fs.readFileSync(file);
        return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
    } catch (e) {
        return { error: errMsg(e) };
    }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 六、日志错误聚合（installer/DIAG-COVERAGE.md 第二节规则，主进程只扫自己收集到的日志）
 * ══════════════════════════════════════════════════════════════════════════ */

const DIGEST_PATTERNS = [
    "error", "exception", "failed", "fail ", "无法", "失败", "错误", "异常",
    "cannot find", "ENOENT", "EACCES", "EPERM", "已损坏", "文件校验", "版本不支持",
    "not supported", "LiteLoader", "找不到", "拒绝访问", "0x800", "crash"
];
const DIGEST_RE = new RegExp(DIGEST_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

const TS_RE_1 = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const TS_RE_2 = /\[(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/;

function parseLineTime(line) {
    let m = TS_RE_1.exec(line);
    if (m) return m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + ":" + m[6];
    m = TS_RE_2.exec(line);
    if (m) {
        return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]) + " " +
            pad2(m[4]) + ":" + m[5] + ":" + m[6];
    }
    return null;
}

/**
 * @param {Array<{zipName:string, display:string, text:string, mtime:string|null}>} logFiles
 * @returns {string}
 */
function buildErrorsDigest(logFiles) {
    const groups = [];
    let totalHits = 0;

    for (const item of logFiles) {
        if (!item || typeof item.text !== "string" || !item.text) continue;
        const lines = item.text.split(/\r?\n/);
        let hits = 0;
        let first = null;
        let last = null;
        const samples = [];
        for (const line of lines) {
            if (!line) continue;
            if (!DIGEST_RE.test(line)) continue;
            hits++;
            const ts = parseLineTime(line);
            if (ts) {
                if (!first) first = ts;
                last = ts;
            }
            if (samples.length < 3) samples.push(clip(sanitizeText(line), 400));
            if (hits >= 200) break;
        }
        if (!hits) continue;
        totalHits += hits;
        groups.push({
            file: item.zipName || item.display || "?",
            source: item.display || "",
            hits: hits,
            first: first,
            last: last,
            mtime: item.mtime || null,
            samples: samples
        });
        if (totalHits >= 600) break;
    }

    groups.sort((a, b) => b.hits - a.hits);

    const lines = [];
    lines.push("说明：这里是**自动筛选**（按关键字命中），不保证是根因；先看 report.txt 顶部「结论清单」。");
    lines.push("");
    if (!groups.length) {
        lines.push("没有命中任何错误关键字。");
        return lines.join("\n");
    }
    lines.push("按文件 → 命中次数 → 首/末时间 → 样例（最多 3 条）排列：");
    lines.push("");
    for (const g of groups) {
        lines.push("## " + g.file + "  （" + g.hits + " 条命中）");
        if (g.source && g.source !== g.file) lines.push("   来源: " + g.source);
        if (g.first || g.last) {
            lines.push("   首/末: " + (g.first || "?") + "  →  " + (g.last || "?"));
        } else {
            lines.push("   首/末: 行内无时间戳（文件 mtime " + (g.mtime || "?") + "）");
        }
        for (const sample of g.samples) lines.push("   · " + sample);
        lines.push("");
    }
    return lines.join("\n");
}

/* ══════════════════════════════════════════════════════════════════════════
 * 七、createDiag
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 创建诊断实例。
 * @param {object} [deps] 可注入依赖（单测用），全部可选：
 *   electron / app / shell / webContents / BrowserWindow / ipcMain / liteLoader(LiteLoader) /
 *   fs / path / os / zlib / crypto / processRef / dataDir / pluginsRoot / profileDir / qqDir /
 *   pluginRoot / now
 */
function createDiag(deps) {
    const raw = deps || {};

    const D = {
        fs: raw.fs || lazyRequire("node:fs"),
        path: raw.path || lazyRequire("node:path"),
        os: raw.os || lazyRequire("node:os"),
        zlib: raw.zlib || lazyRequire("node:zlib"),
        crypto: raw.crypto || lazyRequire("node:crypto"),
        processRef: raw.processRef || process
    };

    const electron = raw.electron || lazyRequire("electron") || {};
    D.electron = electron;
    D.app = raw.app || electron.app || null;
    D.shell = raw.shell || electron.shell || null;
    D.webContents = raw.webContents || electron.webContents || null;
    D.BrowserWindow = raw.BrowserWindow || electron.BrowserWindow || null;
    D.ipcMain = raw.ipcMain || electron.ipcMain || null;
    D.liteLoader = raw.liteLoader || raw.LiteLoader ||
        (typeof globalThis !== "undefined" ? globalThis.LiteLoader : null);
    D.pluginRoot = raw.pluginRoot || D.path.resolve(__dirname, "..");

    if (!D.fs || !D.path) {
        throw new Error("diag 初始化失败：缺少 fs/path 模块");
    }

    /* ---------- 路径解析 ---------- */

    function appPath(name) {
        try {
            if (!D.app || typeof D.app.getPath !== "function") return null;
            const p = D.app.getPath(name);
            return typeof p === "string" && p ? p : null;
        } catch (e) { return null; }
    }

    const profileDir = raw.profileDir ||
        safeGet(D.liteLoader, ["path", "profile"]) ||
        (D.processRef.env && D.processRef.env.LITELOADERQQNT_PROFILE) ||
        appPath("appData") && D.path.join(appPath("appData"), "LiteLoaderQQNT") ||
        D.path.join(D.os.tmpdir(), "LiteLoaderQQNT");

    const dataRoot = raw.dataDir ||
        safeGet(D.liteLoader, ["path", "data"]) ||
        (profileDir && D.path.join(profileDir, "data"));

    const pluginsRoot = raw.pluginsRoot ||
        safeGet(D.liteLoader, ["path", "plugins"]) ||
        (profileDir && D.path.join(profileDir, "plugins"));

    const pluginDataDir = dataRoot ? D.path.join(dataRoot, SLUG) : null;
    const diagDir = pluginDataDir ? D.path.join(pluginDataDir, "diag") : null;

    const qqDir = raw.qqDir ||
        (() => {
            const base = appPath("appData");
            if (!base) return null;
            return D.path.join(base, "QQ");
        })();

    /* ---------- 插件版本 ---------- */

    let cachedVersion = null;
    function pluginVersion() {
        if (cachedVersion) return cachedVersion;
        try {
            const manifestPath = D.path.join(D.pluginRoot, "manifest.json");
            const read = readWholeText(D, manifestPath, MANIFEST_PARSE_MAX);
            if (read.ok && read.text) {
                const parsed = JSON.parse(stripBom(read.text));
                if (parsed && typeof parsed.version === "string" && parsed.version) {
                    cachedVersion = parsed.version;
                }
            }
        } catch (e) { /* 回落到常量 */ }
        return cachedVersion || FALLBACK_VERSION;
    }

    /* ---------- session.log ---------- */

    const sessionLogDir = pluginDataDir || D.path.join(D.os.tmpdir(), "liuli-dsh-theme-diag");
    const sessionLog = createSessionLog(D, sessionLogDir);

    /* ---------- 导出上下文 ---------- */

    function makeCtx(payload) {
        const ctx = {
            D: D,
            generatedAt: nowIso(),
            startedAt: Date.now(),
            pluginVersion: pluginVersion(),
            payload: payload,
            entries: [],
            entryNames: new Set(),
            failures: [],
            checks: [],
            logFiles: [],
            sections: {}
        };

        ctx.fail = (item, error) => {
            const msg = errMsg(error);
            ctx.failures.push({ item: String(item), error: msg });
            try { sessionLog.log("warn", "diag", "采集失败：" + item + " → " + msg); } catch (e) { }
        };
        ctx.check = (id, level, text) => {
            const lv = ["ok", "warn", "bad"].indexOf(level) >= 0 ? level : "warn";
            const t = String(text);
            // 同 id + 同文本不重复（窗口快照与 payload 快照常给出一模一样的结论）
            if (ctx.checks.some(c => c.id === String(id) && c.text === t)) return;
            ctx.checks.push({ id: String(id), level: lv, text: t });
        };
        ctx.addEntry = (name, data) => {
            let finalName = name;
            let i = 2;
            while (ctx.entryNames.has(finalName)) finalName = name.replace(/(\.[^.\/]+)?$/, (ext) => "-" + (i++) + (ext || ""));
            ctx.entryNames.add(finalName);
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data === undefined ? "" : data), "utf8");
            ctx.entries.push({ name: finalName, data: buf });
            return finalName;
        };
        ctx.addText = (name, text) => ctx.addEntry(name, sanitizeText(text));
        ctx.addJson = (name, value, pretty) => {
            let text;
            try {
                text = JSON.stringify(deepSanitize(value), null, pretty === false ? 0 : 2);
            } catch (e) {
                text = JSON.stringify({ error: "序列化失败：" + errMsg(e) });
            }
            return ctx.addEntry(name, text === undefined ? "null" : text);
        };
        return ctx;
    }

    /* ---------- 1. 环境 ---------- */

    function collectEnvironment(ctx) {
        const P = D.processRef;
        const env = P.env || {};
        const pickEnv = {};
        for (const key of ["APPDATA", "LOCALAPPDATA", "USERPROFILE", "TEMP", "TMP",
            "LITELOADERQQNT_PROFILE", "COMPUTERNAME", "USERNAME",
            "PROCESSOR_ARCHITECTURE", "OS", "NUMBER_OF_PROCESSORS"]) {
            if (env[key] !== undefined) pickEnv[key] = String(env[key]);
        }

        const osInfo = {
            platform: safeCall(D.os.platform),
            release: safeCall(D.os.release),
            type: safeCall(D.os.type),
            arch: safeCall(D.os.arch),
            hostname: safeCall(D.os.hostname),
            totalmem: safeCall(D.os.totalmem),
            freemem: safeCall(D.os.freemem),
            uptime: safeCall(D.os.uptime),
            tmpdir: safeCall(D.os.tmpdir),
            endianness: safeCall(D.os.endianness),
            cpuCount: (safeCall(D.os.cpus) || []).length || null,
            cpus: (safeCall(D.os.cpus) || []).slice(0, 32).map(c => ({ model: c.model, speed: c.speed }))
        };

        const appPaths = {};
        for (const name of ["appData", "desktop", "documents", "temp", "userData", "exe", "home", "logs", "crashDumps"]) {
            const p = appPath(name);
            if (p) appPaths[name] = p;
        }

        const liteLoaderInfo = {
            present: !!D.liteLoader,
            versions: safeGet(D.liteLoader, ["versions"]) || null,
            path: safeGet(D.liteLoader, ["path"]) || null,
            os: safeGet(D.liteLoader, ["os"]) || null,
            pluginCount: (() => {
                const plugins = safeGet(D.liteLoader, ["plugins"]);
                return plugins && typeof plugins === "object" ? Object.keys(plugins).length : null;
            })()
        };

        let admin = null;
        try {
            if (typeof P.getuid === "function") admin = { getuid: P.getuid(), isRoot: P.getuid() === 0 };
        } catch (e) { admin = { error: errMsg(e) }; }
        if (admin === null) admin = { supported: false, note: "Windows 下 process.getuid 不可用，未探测管理员权限" };

        const dt = new Date();
        ctx.sections.environment = {
            schema: SCHEMA,
            generatedAt: ctx.generatedAt,
            plugin: { slug: SLUG, version: ctx.pluginVersion, root: D.pluginRoot, dataDir: pluginDataDir, diagDir: diagDir },
            process: {
                pid: P.pid,
                ppid: P.ppid,
                execPath: P.execPath,
                argv: (P.argv || []).slice(0, 20),
                versions: P.versions,
                platform: P.platform,
                arch: P.arch,
                cwd: safeCall(() => P.cwd()),
                env: pickEnv
            },
            app: {
                name: safeCall(() => (D.app && D.app.getName ? D.app.getName() : null)),
                version: safeCall(() => (D.app && D.app.getVersion ? D.app.getVersion() : null)),
                isPackaged: safeCall(() => (D.app && D.app.isPackaged !== undefined ? D.app.isPackaged : null)),
                paths: appPaths
            },
            os: osInfo,
            liteloader: liteLoaderInfo,
            qqAppData: qqDir,
            time: {
                now: nowIso(),
                local: localStamp(dt),
                timezone: safeCall(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
                offset: tzOffsetText(dt),
                offsetMinutes: dt.getTimezoneOffset()
            },
            admin: admin
        };
        return ctx.sections.environment;
    }

    /* ---------- 2. 插件清单 ---------- */

    function collectPlugins(ctx) {
        const result = { root: pluginsRoot, enabled: null, disabledPlugins: null, plugins: [], residuals: [] };
        if (!pluginsRoot) {
            ctx.fail("插件目录", "LiteLoader.path.plugins 为空");
            return result;
        }
        const registered = safeGet(D.liteLoader, ["plugins"]) || {};
        const dirs = readdirSafe(D, pluginsRoot);
        if (!dirs.length) {
            const st = statSafe(D, pluginsRoot);
            if (!st.exists) ctx.fail("插件目录", "目录不存在：" + pluginsRoot);
        }

        // 禁用列表来自 LiteLoader 自己的配置（这里只读，不写）
        const llConfigPath = dataRoot ? D.path.join(dataRoot, "LiteLoader", "config.json") : null;
        if (llConfigPath) {
            const cfg = readWholeText(D, llConfigPath, 64 * 1024);
            if (cfg.ok) {
                try {
                    const parsed = JSON.parse(stripBom(cfg.text));
                    result.enabled = parsed.enable_plugins === undefined ? null : !!parsed.enable_plugins;
                    result.disabledPlugins = Array.isArray(parsed.disabled_plugins) ? parsed.disabled_plugins : null;
                } catch (e) { /* 解析失败在下面 config 小节里报告 */ }
            }
        }

        for (const ent of dirs) {
            if (!ent.isDirectory()) continue;
            const dirName = ent.name;
            const dirPath = D.path.join(pluginsRoot, dirName);

            if (/_\d{10,}$/.test(dirName)) {
                result.residuals.push(dirName);
            }

            const manifestPath = D.path.join(dirPath, "manifest.json");
            const rawStat = statSafe(D, manifestPath);
            const item = {
                dirName: dirName,
                dir: dirPath,
                manifestPath: manifestPath,
                manifestExists: !!rawStat.exists,
                manifestSize: rawStat.exists ? rawStat.size : null,
                manifestMtime: rawStat.exists ? rawStat.mtime : null,
                bom: null,
                parsed: false,
                parseError: null,
                manifestRaw: null,
                slug: null,
                version: null,
                name: null,
                type: null,
                platform: null,
                injects: {},
                registered: null,
                dataDir: dataRoot ? D.path.join(dataRoot, dirName) : null,
                residual: /_\d{10,}$/.test(dirName)
            };

            if (rawStat.exists && rawStat.isFile) {
                const read = readWholeText(D, manifestPath, MANIFEST_PARSE_MAX);
                // BOM 判定看原始字节（decodeBuffer 会把 BOM 吃掉，所以单独读头 3 字节）
                try {
                    const head = Buffer.alloc(3);
                    const fd = D.fs.openSync(manifestPath, "r");
                    try { D.fs.readSync(fd, head, 0, 3, 0); } finally { D.fs.closeSync(fd); }
                    item.bom = bomKind(head);
                } catch (e) {
                    item.bom = null;
                }
                item.manifestRaw = clip(sanitizeText(read.text), MANIFEST_RAW_MAX);
                try {
                    const parsed = JSON.parse(stripBom(read.text));
                    item.parsed = true;
                    item.slug = typeof parsed.slug === "string" ? parsed.slug : dirName;
                    item.version = typeof parsed.version === "string" ? parsed.version : null;
                    item.name = typeof parsed.name === "string" ? parsed.name : null;
                    item.type = typeof parsed.type === "string" ? parsed.type : null;
                    item.platform = Array.isArray(parsed.platform) ? parsed.platform : null;
                    const injects = parsed.injects || {};
                    for (const key of ["main", "preload", "renderer"]) {
                        const rel = typeof injects[key] === "string" ? injects[key] : null;
                        const info = { declared: rel };
                        if (rel) {
                            // 只允许落在自己插件目录内（防止 manifest 指到外面去）
                            const abs = D.path.resolve(dirPath, rel);
                            const inside = abs === dirPath || abs.startsWith(dirPath + D.path.sep);
                            info.path = abs;
                            info.insidePluginDir = inside;
                            if (!inside) {
                                info.error = "路径越出插件目录，已跳过";
                            } else {
                                const st = statSafe(D, abs);
                                info.exists = !!st.exists;
                                info.size = st.exists ? st.size : null;
                                info.mtime = st.exists ? st.mtime : null;
                                if (st.exists && st.isFile) {
                                    if (dirName === SLUG || item.slug === SLUG) {
                                        const hash = sha256File(D, abs);
                                        info.sha256 = hash && hash.sha256 || null;
                                        if (hash && hash.error) info.sha256Error = hash.error;
                                    }
                                }
                            }
                        }
                        item.injects[key] = info;
                    }
                } catch (e) {
                    item.parseError = errMsg(e);
                }
            }

            if (registered && item.slug && registered[item.slug]) {
                const reg = registered[item.slug];
                item.registered = {
                    disabled: !!reg.disabled,
                    incompatible: !!reg.incompatible,
                    pluginPath: safeGet(reg, ["path", "plugin"]) || null,
                    dataPath: safeGet(reg, ["path", "data"]) || null,
                    injectsPath: safeGet(reg, ["path", "injects"]) || null
                };
            }

            item.dataFiles = item.dataDir ? dirStats(D, item.dataDir, 2, 40) : { exists: false };
            result.plugins.push(item);
        }

        ctx.sections.plugins = result;

        // ---- 结论 ----
        const serialized = [];
        for (const p of result.plugins) {
            if (p.residual) {
                ctx.check("plugin.residual", "warn",
                    "插件目录存在残留副本：" + p.dirName + "（安装/卸载中断留下的 xxx_<时间戳>）<<==");
            }
            if (!p.manifestExists) {
                ctx.check("plugin.manifest.missing", "bad", "插件目录缺失 manifest.json：" + p.dirName + " <<==");
                continue;
            }
            if (p.bom) {
                ctx.check("plugin.manifest.bom", "warn", "插件 " + p.dirName + " 的 manifest.json 带 BOM（部分解析器会失败）<<==");
            }
            if (p.parseError) {
                ctx.check("plugin.manifest.parse", "bad",
                    "插件 " + p.dirName + " 的 manifest.json 解析失败：" + p.parseError + " <<==");
            }
            if (p.registered && p.registered.disabled) {
                ctx.check("plugin.disabled", "warn", "插件已禁用：" + p.slug);
            }
            if (p.registered && p.registered.incompatible) {
                ctx.check("plugin.incompatible", "bad", "插件与当前平台不兼容：" + p.slug + " <<==");
            }
            for (const key of ["main", "preload", "renderer"]) {
                const inj = p.injects[key];
                if (inj && inj.declared && inj.exists === false && !inj.error) {
                    ctx.check("plugin.inject." + key, "bad",
                        "插件 " + p.dirName + " 的注入文件缺失（" + key + " → " + inj.declared + "）<<==");
                }
            }
            if ((p.slug === SLUG || p.dirName === SLUG) && p.parsed) {
                if (p.version !== ctx.pluginVersion) {
                    // ctx.pluginVersion 来自仓库 manifest；运行目录可能是旧版
                    ctx.check("plugin.version.state", "warn",
                        "运行中的插件版本 " + p.version + " 与当前代码版本 " + ctx.pluginVersion + " 不一致（可能装的是旧版）<<==");
                }
            }
            serialized.push(p.dirName);
        }
        if (serialized.length) {
            ctx.check("plugin.count", "ok", "已安装插件 " + serialized.length + " 个：" + serialized.join("、"));
        }
        return result;
    }

    /* ---------- 3. 插件数据 / LiteLoader 配置 ---------- */

    function collectPluginData(ctx) {
        const result = { dataRoot: dataRoot, entries: [], liteloaderConfig: null };
        if (!dataRoot) {
            ctx.fail("插件数据目录", "dataRoot 为空");
            return result;
        }
        const dirs = readdirSafe(D, dataRoot);
        for (const ent of dirs) {
            if (!ent.isDirectory() || ent.name === "LiteLoader") continue;
            const dir = D.path.join(dataRoot, ent.name);
            const item = { slug: ent.name, dir: dir, config: null, stats: dirStats(D, dir, 2, 50) };
            const cfgPath = D.path.join(dir, "config.json");
            const cfg = readWholeText(D, cfgPath, CONFIG_MAX_BYTES);
            if (cfg.ok) {
                let parsed = null;
                let parseError = null;
                if (cfg.truncated) {
                    parseError = "文件超过 " + bytesText(CONFIG_MAX_BYTES) + "，只取了前 " + bytesText(CONFIG_MAX_BYTES) + "，未解析";
                } else {
                    try { parsed = JSON.parse(stripBom(cfg.text)); } catch (e) { parseError = errMsg(e); }
                }
                item.config = {
                    exists: true,
                    size: cfg.size,
                    truncated: cfg.truncated,
                    parseOk: parsed !== null,
                    parseError: parseError,
                    text: clip(sanitizeText(cfg.text), CONFIG_MAX_BYTES)
                };
                if (!parsed && parseError && !cfg.truncated) {
                    ctx.check("data.config.parse", "warn", "data/" + ent.name + "/config.json 解析失败：" + parseError);
                }
            }
            result.entries.push(item);
        }

        const llCfgPath = D.path.join(dataRoot, "LiteLoader", "config.json");
        const llCfg = readWholeText(D, llCfgPath, 64 * 1024);
        const llItem = { exists: !!llCfg.ok, path: llCfgPath, size: llCfg.ok ? llCfg.size : null };
        if (llCfg.ok) {
            let parsed = null;
            let parseError = null;
            try { parsed = JSON.parse(stripBom(llCfg.text)); } catch (e) { parseError = errMsg(e); }
            llItem.parseOk = parsed !== null;
            llItem.parseError = parseError;
            llItem.text = clip(sanitizeText(llCfg.text), 8192);
            if (parsed) {
                llItem.fields = {
                    enable_plugins: parsed.enable_plugins,
                    disabled_plugins: parsed.disabled_plugins,
                    deleting_plugins: parsed.deleting_plugins,
                    installing_plugins: parsed.installing_plugins
                };
                if (parsed.enable_plugins === false) {
                    ctx.check("liteloader.plugins.disabled", "bad", "LiteLoader config.json 里 enable_plugins=false：所有插件都不会加载 <<==");
                }
            }
        } else {
            llItem.note = "不存在时按默认值理解：enable_plugins=true, disabled_plugins=[]";
        }
        result.liteloaderConfig = llItem;
        ctx.sections.pluginData = result;
        return result;
    }

    /* ---------- 4. 安装器状态 ---------- */

    function collectInstaller(ctx) {
        const result = {
            profileDir: profileDir,
            installerLog: null,
            packageJson: null,
            backupOriginal: [],
            backupExists: false
        };
        if (!profileDir) {
            ctx.fail("安装器状态", "LiteLoader profile 目录未知");
            return result;
        }

        const logPath = D.path.join(profileDir, "installer.log");
        const tailRead = readTail(D, logPath, 512 * 1024, true);
        if (tailRead.ok) {
            const allLines = tailRead.text.split(/\r?\n/);
            const tailLines = allLines.slice(Math.max(0, allLines.length - INSTALLER_TAIL_LINES));
            result.installerLog = {
                exists: true,
                path: logPath,
                size: tailRead.size,
                mtime: tailRead.mtime,
                truncated: tailRead.truncated,
                tailLines: tailLines.length,
                tail: tailLines.join("\n")
            };
            if (tailRead.binary) ctx.check("installer.log.binary", "warn", "installer.log 看起来是二进制，已跳过内容");
        } else {
            result.installerLog = { exists: false, path: logPath, error: tailRead.error };
        }

        const pkgPath = D.path.join(profileDir, "package.json");
        const pkg = readWholeText(D, pkgPath, 64 * 1024);
        if (pkg.ok) {
            let version = null;
            let name = null;
            let parseError = null;
            try {
                const parsed = JSON.parse(stripBom(pkg.text));
                version = parsed.version || null;
                name = parsed.name || null;
            } catch (e) { parseError = errMsg(e); }
            result.packageJson = { exists: true, path: pkgPath, size: pkg.size, version: version, name: name, parseError: parseError };
        } else {
            result.packageJson = { exists: false, path: pkgPath, error: pkg.error };
        }

        const backupRoot = D.path.join(profileDir, "installer-backup", "original");
        const backupStat = statSafe(D, backupRoot);
        if (backupStat.exists && backupStat.isDirectory) {
            result.backupExists = true;
            const entries = readdirSafe(D, backupRoot);
            for (const ent of entries) {
                const full = D.path.join(backupRoot, ent.name);
                const st = statSafe(D, full);
                if (!st.exists || !st.isFile) continue;
                const hash = sha256File(D, full, 8 * 1024 * 1024);
                result.backupOriginal.push({
                    name: ent.name,
                    size: st.size,
                    mtime: st.mtime,
                    sha256: hash && hash.sha256 || null,
                    hashNote: hash && hash.skipped ? "文件 >8MB，未计算哈希" : (hash && hash.error ? "哈希失败：" + hash.error : null)
                });
                if (result.backupOriginal.length >= 50) break;
            }
        }
        ctx.sections.installer = result;
        return result;
    }

    /* ---------- 5. QQ ---------- */

    function collectQQ(ctx) {
        const result = {
            qqDir: qqDir,
            logDir: null,
            logFiles: [],
            crashpad: null,
            localStorage: null,
            preferences: null,
            localState: null
        };
        if (!qqDir) {
            ctx.fail("QQ 数据目录", "app.getPath('appData') 不可用");
            return result;
        }
        const qqStat = statSafe(D, qqDir);
        if (!qqStat.exists) {
            ctx.fail("QQ 数据目录", "不存在：" + qqDir);
            return result;
        }

        const logDir = D.path.join(qqDir, "log");
        const logStat = statSafe(D, logDir);
        if (logStat.exists && logStat.isDirectory) {
            const files = [];
            for (const ent of readdirSafe(D, logDir)) {
                if (!ent.isFile()) continue;
                const full = D.path.join(logDir, ent.name);
                const st = statSafe(D, full);
                if (!st.exists || !st.isFile) continue;
                files.push({ name: ent.name, path: full, size: st.size, mtime: st.mtime, mtimeMs: st.mtimeMs });
            }
            files.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
            result.logDir = { exists: true, path: logDir, fileCount: files.length };
            result.logFiles = files;
        } else {
            result.logDir = { exists: false, path: logDir };
        }

        // Crashpad
        const crashDir = D.path.join(qqDir, "Crashpad", "reports");
        const crashStat = statSafe(D, crashDir);
        if (crashStat.exists && crashStat.isDirectory) {
            const reports = [];
            for (const ent of readdirSafe(D, crashDir)) {
                if (!ent.isFile()) continue;
                const st = statSafe(D, D.path.join(crashDir, ent.name));
                if (!st.exists) continue;
                reports.push({ name: ent.name, size: st.size, mtime: st.mtime });
                if (reports.length >= 40) break;
            }
            result.crashpad = { exists: true, path: crashDir, reportCount: reports.length, reports: reports };
            if (reports.length) {
                ctx.check("qq.crashpad", "warn", "QQ Crashpad 有 " + reports.length + " 个崩溃转储（值得看一眼时间是否对得上）<<==");
            }
        } else {
            result.crashpad = { exists: false, path: crashDir };
        }

        // Local Storage（只元数据，不复制内容）
        const lsDir = D.path.join(qqDir, "Local Storage", "leveldb");
        const lsStat = statSafe(D, lsDir);
        if (lsStat.exists && lsStat.isDirectory) {
            const files = [];
            let total = 0;
            let newest = null;
            let newestMs = 0;
            for (const ent of readdirSafe(D, lsDir)) {
                if (!ent.isFile()) continue;
                const st = statSafe(D, D.path.join(lsDir, ent.name));
                if (!st.exists) continue;
                total += st.size || 0;
                if ((st.mtimeMs || 0) > newestMs) { newestMs = st.mtimeMs; newest = st.mtime; }
                if (files.length < 30) files.push({ name: ent.name, size: st.size, mtime: st.mtime });
            }
            result.localStorage = {
                exists: true,
                path: lsDir,
                fileCount: files.length,
                totalBytes: total,
                newestMtime: newest,
                files: files,
                note: "只列元数据；壁纸细节请用插件设置页导出的诊断包"
            };
        } else {
            result.localStorage = { exists: false, path: lsDir };
        }

        for (const [key, rel] of [["preferences", "Preferences"], ["localState", "Local State"]]) {
            const full = D.path.join(qqDir, rel);
            const st = statSafe(D, full);
            result[key] = { exists: !!st.exists, path: full, size: st.exists ? st.size : null, mtime: st.exists ? st.mtime : null };
        }

        ctx.sections.qq = result;
        return result;
    }

    /* ---------- 6. 日志收集 ---------- */

    function safeFileName(name) {
        return String(name).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "log";
    }

    /** 日志缺失/二进制跳过：不算「采集失败」，记成备注，在 report 第 9 节列出 */
    function noteLogSkip(ctx, text) {
        if (!ctx.sections.logSkips) ctx.sections.logSkips = [];
        if (ctx.sections.logSkips.indexOf(text) < 0) ctx.sections.logSkips.push(text);
    }

    function collectLogs(ctx, pluginsSection, installerSection, qqSection) {
        const files = [];

        // 6.1 本插件 session.log（含轮转历史）
        try {
            for (const item of sessionLog.readAll()) {
                const name = "logs/" + item.name;
                ctx.addText(name, item.text);
                files.push({
                    zipName: name,
                    display: D.path.join(pluginDataDir || "", item.name),
                    text: item.text,
                    mtime: item.mtime,
                    size: item.size
                });
            }
        } catch (e) { ctx.fail("session.log", e); }

        // 6.2 原有 plugin.log（不存在属正常：空 profile / 首次安装时还没写过）
        if (pluginDataDir) {
            const pluginLog = D.path.join(pluginDataDir, "plugin.log");
            const st = statSafe(D, pluginLog);
            if (!st.exists) {
                noteLogSkip(ctx, "plugin.log 不存在，已跳过（空 profile / 还没启动过插件时正常）");
            } else {
                const read = readTail(D, pluginLog, 256 * 1024, true);
                if (read.ok && !read.binary) {
                    const name = ctx.addText("logs/plugin.log", read.text);
                    files.push({ zipName: name, display: pluginLog, text: read.text, mtime: read.mtime, size: read.size });
                } else if (read.ok && read.binary) {
                    noteLogSkip(ctx, "plugin.log 看起来是二进制，已跳过");
                } else if (read.error) {
                    ctx.fail("plugin.log", read.error);
                }
            }
        } else {
            noteLogSkip(ctx, "插件 data 目录未知，plugin.log 已跳过");
        }

        // 6.3 安装器日志尾部（不存在属正常：只装 LiteLoader 未跑安装器 / 手动安装）
        if (installerSection && installerSection.installerLog && installerSection.installerLog.exists) {
            const tail = installerSection.installerLog.tail || "";
            const name = ctx.addText("logs/installer.log", tail);
            files.push({
                zipName: name,
                display: installerSection.installerLog.path,
                text: tail,
                mtime: installerSection.installerLog.mtime,
                size: installerSection.installerLog.size
            });
        } else {
            noteLogSkip(ctx, "installer.log 不存在，已跳过（手动装 LiteLoader / 未跑安装器时正常）");
        }

        // 6.3b LiteLoader 本体主进程日志（安装器内置的 tee：启动 banner、插件加载成功/失败、LiteLoader 弹窗正文）
        if (profileDir) {
            const llMainLog = D.path.join(profileDir, "liteLoader.log");
            const llSt = statSafe(D, llMainLog);
            if (llSt.exists && llSt.isFile) {
                const read = readTail(D, llMainLog, 120 * 1024, true);
                if (read.ok && !read.binary) {
                    const name = ctx.addText("logs/liteLoader.log", read.text);
                    files.push({ zipName: name, display: llMainLog, text: read.text, mtime: read.mtime, size: read.size });
                } else if (read.ok && read.binary) {
                    noteLogSkip(ctx, "liteLoader.log 看起来是二进制，已跳过");
                } else if (read.error) {
                    ctx.fail("liteLoader.log", read.error);
                }
            } else {
                noteLogSkip(ctx, "liteLoader.log 不存在，已跳过（安装器内置 LiteLoader 的 tee 日志还没生成时正常）");
            }
        }

        // 6.4 QQ 日志最新 8 个尾部
        if (qqSection && Array.isArray(qqSection.logFiles)) {
            const picked = qqSection.logFiles.slice(0, QQ_LOG_FILES);
            for (const item of picked) {
                const read = readTail(D, item.path, QQ_LOG_MAX_BYTES, true);
                if (!read.ok) { ctx.fail("QQ 日志 " + item.name, read.error); continue; }
                if (read.binary) {
                    ctx.fail("QQ 日志 " + item.name, "二进制文件，已跳过");
                    continue;
                }
                const zipName = ctx.addText("logs/qq/" + safeFileName(item.name), read.text);
                files.push({
                    zipName: zipName,
                    display: item.path,
                    text: read.text,
                    mtime: item.mtime || read.mtime,
                    size: read.size
                });
            }
        }

        // 6.5 其它插件 data 下的小日志（≤2MB、30 天内、按 mtime 取最新 10 个）
        if (dataRoot) {
            const nowMs = Date.now();
            const candidates = [];
            const walk = (dir, slug, depth) => {
                if (depth > 2) return;
                for (const ent of readdirSafe(D, dir)) {
                    const full = D.path.join(dir, ent.name);
                    if (ent.isDirectory()) { walk(full, slug, depth + 1); continue; }
                    if (!ent.isFile()) continue;
                    if (!/\.(log|txt)$/i.test(ent.name)) continue;
                    if (full === D.path.join(pluginDataDir || "", "plugin.log")) continue;
                    if (full === D.path.join(pluginDataDir || "", "session.log")) continue;
                    const st = statSafe(D, full);
                    if (!st.exists || !st.isFile) continue;
                    if ((st.size || 0) > LL_LOG_FILE_MAX) continue;
                    if (typeof st.mtimeMs === "number" && nowMs - st.mtimeMs > LL_LOG_MAX_AGE_MS) continue;
                    candidates.push({ slug: slug, name: ent.name, path: full, size: st.size, mtime: st.mtime, mtimeMs: st.mtimeMs || 0 });
                }
            };
            for (const ent of readdirSafe(D, dataRoot)) {
                if (!ent.isDirectory()) continue;
                if (ent.name === SLUG || ent.name === "LiteLoader") continue;
                walk(D.path.join(dataRoot, ent.name), ent.name, 0);
            }
            candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
            const usedNames = new Set();
            for (const item of candidates.slice(0, LL_LOG_FILES)) {
                const read = readTail(D, item.path, LL_LOG_MAX_BYTES, true);
                if (!read.ok) { ctx.fail("插件日志 " + item.name, read.error); continue; }
                if (read.binary) continue;
                // 命名：规范文件（<slug>.log / plugin.log）用 <slug>.log，其它带上自己的文件名避免覆盖
                const stem = item.name.replace(/\.[^.]+$/, "");
                const canonical = stem === item.slug || /^(plugin|session|main)$/i.test(stem);
                let baseName = canonical ? safeFileName(item.slug) + ".log"
                    : safeFileName(item.slug) + "-" + safeFileName(stem) + ".log";
                let candidateName = "logs/liteloader-data/" + baseName;
                let n = 2;
                while (usedNames.has(candidateName)) {
                    candidateName = "logs/liteloader-data/" + baseName.replace(/\.log$/i, "-" + (n++) + ".log");
                }
                usedNames.add(candidateName);
                const zipName = ctx.addText(candidateName, read.text);
                files.push({
                    zipName: zipName,
                    display: item.path,
                    text: read.text,
                    mtime: item.mtime || read.mtime,
                    size: read.size
                });
            }
        }

        ctx.logFiles = files;
        return files;
    }

    /* ---------- 7. 窗口 + 快照 + 截图 ---------- */

    function wcSafe(wc, method, fallback) {
        try {
            if (wc && typeof wc[method] === "function") return wc[method]();
        } catch (e) { return fallback; }
        return fallback;
    }

    function isAppUrl(url) {
        return typeof url === "string" && /^app:\/\//i.test(url);
    }

    function isExcludedUrl(url) {
        if (!url) return true;
        return EXCLUDED_WINDOW_URLS.some(re => re.test(String(url).trim()));
    }

    function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                reject(new Error((label || "操作") + " 超时（" + ms + "ms）"));
            }, ms);
            Promise.resolve(promise).then(value => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(value);
            }, error => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    function imageToPng(img) {
        if (!img) return null;
        if (Buffer.isBuffer(img)) return img;
        try { if (typeof img.toPNG === "function") return img.toPNG(); } catch (e) { return null; }
        return null;
    }

    function imageToJpegSmall(img, maxWidth) {
        if (!img || Buffer.isBuffer(img)) return null;
        let target = img;
        try {
            const size = typeof img.getSize === "function" ? img.getSize() : null;
            if (size && size.width > maxWidth && typeof img.resize === "function") {
                target = img.resize({ width: maxWidth });
            }
        } catch (e) { /* 缩放失败就用原图 */ }
        try {
            if (typeof target.toJPEG === "function") return target.toJPEG(72);
        } catch (e) { return null; }
        return null;
    }

    /**
     * 解析快照脚本返回值（同步字符串 / 异步信封 / 直接对象）。
     * 信封：{mode:"async"|"sync"|"async-error"|"error"|"none", snapshot?, error?}
     * @returns {{ok:boolean, mode:string|null, snapshot:object|null, error:string|null}}
     */
    function parseSnapshotEnvelope(raw) {
        const out = { ok: false, mode: null, snapshot: null, error: null };
        if (raw === null || raw === undefined) {
            out.error = "快照脚本返回空值";
            return out;
        }
        let value = raw;
        if (typeof raw === "string") {
            const trimmed = raw.trim();
            if (trimmed === "null" || trimmed === "") {
                out.error = "__liuliDiagSnapshot 未定义（渲染进程诊断未加载或注入失败）";
                return out;
            }
            try {
                value = JSON.parse(trimmed);
            } catch (e) {
                out.error = "快照 JSON 解析失败：" + errMsg(e);
                return out;
            }
        }
        if (!isObject(value)) {
            out.error = "快照返回类型异常：" + typeof value;
            return out;
        }
        // 异步信封
        if (typeof value.mode === "string" && (Object.prototype.hasOwnProperty.call(value, "snapshot") ||
            Object.prototype.hasOwnProperty.call(value, "error"))) {
            out.mode = value.mode;
            if (isObject(value.snapshot)) {
                out.snapshot = value.snapshot;
                out.ok = true;
                return out;
            }
            out.error = value.error || ("异步快照失败（mode=" + value.mode + "）");
            return out;
        }
        // 直接就是快照对象（老脚本 / 渲染进程直接返回对象）
        out.snapshot = value;
        out.mode = null;
        out.ok = true;
        return out;
    }

    /**
     * 抓单个窗口快照：优先异步 collectDiagnostics（files 可用），失败/超时回退同步 __liuliDiagSnapshot。
     * @returns {Promise<{ok:boolean, mode:"async"|"sync"|"error", snapshot:object|null, error:string|null}>}
     */
    async function captureWindowSnapshot(wc, id) {
        const result = { ok: false, mode: "error", snapshot: null, error: null };
        const label = "window-" + id + " 快照";

        // 1) 异步优先（脚本内部：无异步入口就直接同步，异常返回 async-error）
        try {
            const raw = await withTimeout(wc.executeJavaScript(SNAP_SCRIPT_ASYNC, true),
                SNAPSHOT_TIMEOUT_MS, label + "（async）");
            const env = parseSnapshotEnvelope(raw);
            if (env.ok && env.snapshot && !env.snapshot._snapshotError) {
                result.ok = true;
                result.mode = env.mode === "sync" ? "sync" : "async";
                result.snapshot = env.snapshot;
                return result;
            }
            result.error = (env.snapshot && env.snapshot._snapshotError)
                ? "渲染进程快照函数抛错：" + env.snapshot._snapshotError
                : (env.error || "异步快照失败");
        } catch (e) {
            result.error = "异步快照失败：" + errMsg(e);
        }

        // 2) 回退同步
        try {
            const rawSync = await withTimeout(wc.executeJavaScript(SNAP_SCRIPT, true),
                SNAPSHOT_TIMEOUT_SYNC_MS, label + "（sync）");
            const envSync = parseSnapshotEnvelope(rawSync);
            if (envSync.ok && envSync.snapshot && !envSync.snapshot._snapshotError) {
                result.ok = true;
                result.mode = "sync";
                result.snapshot = envSync.snapshot;
                return result;
            }
            result.mode = "error";
            result.error = (result.error || "异步快照失败") +
                "；同步回退也失败：" + (envSync.error || "未知原因");
        } catch (e2) {
            result.mode = "error";
            result.error = (result.error || "异步快照失败") + "；同步回退也失败：" + errMsg(e2);
        }
        return result;
    }

    /** 设置页窗口？契约 3.4：URL 含 #/setting 的窗口截图默认采集 */
    function isSettingsUrl(url) {
        return /#\/setting/i.test(String(url || ""));
    }

    /** 主题 CSS 里的可选文件：安装器版不带默认壁纸，fetch 失败属正常，不能当问题 */
    const OPTIONAL_THEME_FILES = ["wallpaper.css"];
    function isOptionalThemeFile(file) {
        if (!isObject(file)) return false;
        if (file.optional === true) return true;
        const name = String(file.name || "").replace(/\\/g, "/").toLowerCase();
        const base = name.split("/").pop();
        return OPTIONAL_THEME_FILES.indexOf(base) >= 0;
    }

    /**
     * 从渲染进程快照里派生「UI/主题」结论（契约 3.2 / S3）。
     * 触发条件：theme.failed=true / themeStyle.len=0 / themeStyle.ruleCount=0 /
     *          files 里有 fetchOk=false（跳过 optional / wallpaper.css）/ cssVars.missing 非空。
     * @returns {{hash:string, issues:string[]}}
     */
    function deriveThemeIssues(snapshot) {
        const result = { hash: "", issues: [] };
        if (!isObject(snapshot)) return result;
        const win = isObject(snapshot.window) ? snapshot.window : {};
        if (typeof win.hash === "string") result.hash = win.hash;
        const theme = isObject(snapshot.theme) ? snapshot.theme : null;
        if (!theme) {
            result.issues.push("快照缺少 theme 字段（渲染进程可能不是 1.3.0）");
            return result;
        }

        if (theme.failed === true) {
            result.issues.push("主题注入失败（data-liuli-theme=failed）" +
                (theme.failedReason ? "：" + clip(String(theme.failedReason), 200) : ""));
        }

        const ts = isObject(theme.themeStyle) ? theme.themeStyle : null;
        if (ts) {
            if (ts.present === false) {
                result.issues.push("找不到 #liuli-dsh-theme 样式标签");
            } else if (ts.len === 0) {
                result.issues.push("主题样式长度为 0（CSS 没有进 <style>）");
            } else if (ts.ruleCount === 0) {
                result.issues.push(ts.ruleReadError
                    ? "读不到 CSS 规则（" + clip(String(ts.ruleReadError), 160) + "）"
                    : "CSS 规则数为 0（样式标签在但没生效）");
            }
        } else if (theme.themeStyleLen === 0) {
            // 兼容旧快照字段名
            result.issues.push("主题样式长度为 0（CSS 没有进 <style>）");
        }

        const files = Array.isArray(theme.files) ? theme.files : [];
        const badFiles = files.filter(f => isObject(f) && !isOptionalThemeFile(f) &&
            (f.fetchOk === false || (f.fetchOk === undefined && f.ok === false)));
        if (badFiles.length) {
            result.issues.push("CSS 资源加载失败：" + badFiles.slice(0, 8).map(f =>
                String(f.name || "?") + (f.status ? "（HTTP " + f.status + "）" : "")).join("、"));
        }

        const cssVars = isObject(theme.cssVars) ? theme.cssVars : null;
        if (cssVars && Array.isArray(cssVars.missing) && cssVars.missing.length) {
            result.issues.push("关键 CSS 变量缺失：" + cssVars.missing.slice(0, 8).map(String).join("、"));
        }

        return result;
    }

    /**
     * 把单个窗口的主题结论写进 checks（带窗口 id/hash）。
     * 注意：不再把 snapshot.theme.checks 加进全局 checks —— 渲染进程会把这些文案同时塞进
     * 顶层 snapshot.checks（通用循环已收录），再加一次就是成对重复（「渲染: …」+「窗口 N 主题：…」）。
     * 每窗口的渲染进程 checks 仍会原样展示在 report.txt 第 7 节窗口详情里。
     */
    function pushThemeChecks(ctx, windowId, derived, snapshot) {
        const label = "窗口 " + windowId + (derived.hash ? "（" + derived.hash + "）" : "");
        if (derived.issues.length) {
            ctx.check("theme.window-" + windowId, "warn",
                label + "主题样式未生效：" + derived.issues.join("；") + " <<==");
        } else if (isObject(snapshot) && isObject(snapshot.theme)) {
            const ts = isObject(snapshot.theme.themeStyle) ? snapshot.theme.themeStyle : {};
            const parts = [];
            if (typeof ts.len === "number") parts.push("style len=" + ts.len);
            if (typeof ts.ruleCount === "number") parts.push("rules=" + ts.ruleCount);
            ctx.check("theme.window-" + windowId, "ok",
                label + "主题样式正常" + (parts.length ? "（" + parts.join("，") + "）" : ""));
        }
    }

    async function collectWindows(ctx) {
        const out = { windows: [], snapshots: [], screenshots: [], preview: null, failures: [] };
        const wantShots = !!(ctx.payload && ctx.payload.opts && ctx.payload.opts.screenshots);
        out.screenshotsCaptured = wantShots;

        let list = [];
        try {
            if (!D.webContents || typeof D.webContents.getAllWebContents !== "function") {
                throw new Error("webContents.getAllWebContents 不可用");
            }
            list = D.webContents.getAllWebContents() || [];
        } catch (e) {
            ctx.fail("窗口列表", e);
            return out;
        }

        let browserWindows = [];
        try {
            if (D.BrowserWindow && typeof D.BrowserWindow.getAllWindows === "function") {
                browserWindows = D.BrowserWindow.getAllWindows() || [];
            }
        } catch (e) { /* 拿不到窗口也能继续 */ }

        // 主窗口判定：优先 URL 带 #/main 的 app:// 窗口，其次第一个 BrowserWindow，最后第一个 app:// 窗口
        const appWcs = list.filter(wc => isAppUrl(wcSafe(wc, "getURL", "")));
        let mainWc = null;
        for (const wc of appWcs) {
            if (/#\/main\b/i.test(wcSafe(wc, "getURL", ""))) { mainWc = wc; break; }
        }
        if (!mainWc) {
            for (const bw of browserWindows) {
                const wc = bw && bw.webContents;
                if (wc && appWcs.indexOf(wc) >= 0) { mainWc = wc; break; }
            }
        }
        if (!mainWc) mainWc = appWcs[0] || null;

        const mainSession = mainWc ? (() => { try { return mainWc.session || null; } catch (e) { return null; } })() : null;

        let shotTotal = 0;
        let mainImage = null;
        const shotIndex = [];
        const themeResults = [];

        for (const wc of list) {
            // id 是属性不是方法，不能走 wcSafe
            const id = (wc && wc.id !== undefined && wc.id !== null) ? wc.id : null;
            const info = {
                id: id,
                type: wcSafe(wc, "getType", null),
                url: clip(wcSafe(wc, "getURL", ""), 500),
                title: clip(wcSafe(wc, "getTitle", ""), 200),
                destroyed: wcSafe(wc, "isDestroyed", null),
                loading: wcSafe(wc, "isLoading", null),
                visible: wcSafe(wc, "isVisible", null),
                visibility: wcSafe(wc, "getVisibilityState", null),
                osPid: wcSafe(wc, "getOSProcessId", null),
                processId: wcSafe(wc, "getProcessId", null),
                zoomFactor: wcSafe(wc, "getZoomFactor", null),
                userAgent: clip(wcSafe(wc, "getUserAgent", ""), 400),
                isMainWindow: wc === mainWc,
                sessionSameAsMain: null,
                snapshot: null,
                screenshot: null,
                screenshotInfo: null,
                theme: null
            };
            try {
                info.sessionSameAsMain = mainSession ? (wc.session === mainSession) : null;
            } catch (e) { info.sessionSameAsMain = null; }

            const eligible = isAppUrl(info.url) && !isExcludedUrl(info.url);
            const settingsWin = isSettingsUrl(info.url);

            // 截图索引条目：每个窗口都记一条（含跳过的原因），最后写 screenshots/index.json
            const shotEntry = {
                id: id,
                url: info.url,
                title: info.title,
                caption: settingsWin ? "设置页（默认采集，不含聊天）"
                    : (wc === mainWc ? "主窗口（用户勾选）" : (eligible ? "其它窗口（用户勾选）" : "未采集窗口")),
                captured: false,
                bytes: 0,
                path: null,
                reason: null
            };

            if (info.destroyed) {
                shotEntry.reason = "窗口已销毁";
                shotIndex.push(shotEntry);
                info.screenshotInfo = { caption: shotEntry.caption, captured: false, bytes: 0, name: null, reason: shotEntry.reason };
                out.windows.push(info);
                continue;
            }
            if (!eligible) {
                shotEntry.reason = "非 app:// 窗口或已排除（screenshot.html / hiddenWindow.html / about:blank）";
                shotIndex.push(shotEntry);
                info.screenshotInfo = { caption: shotEntry.caption, captured: false, bytes: 0, name: null, reason: shotEntry.reason };
                out.windows.push(info);
                continue;
            }

            // ---- 快照：优先异步 collectDiagnostics（files 可用），失败/超时回退同步 ----
            const snapName = "snapshots/window-" + (id === null ? "x" + out.windows.length : id) + ".json";
            let snapText = null;
            let snapOk = false;
            const snapRes = await captureWindowSnapshot(wc, id);
            let snapMode = snapRes.mode || "error";
            let snapError = snapRes.error || null;

            if (snapRes.ok && snapRes.snapshot) {
                const clean = deepSanitize(snapRes.snapshot);
                const text = JSON.stringify(Object.assign({}, clean, {
                    mode: snapMode,
                    error: snapError ? clip(maskInline(String(snapError)), 800) : null
                }), null, 2);
                if (text && Buffer.byteLength(text, "utf8") <= SNAPSHOT_MAX_BYTES) {
                    snapText = text;
                    snapOk = true;
                    const topChecks = Array.isArray(clean.checks) ? clean.checks : [];
                    const themeChecks = isObject(clean.theme) && Array.isArray(clean.theme.checks) ? clean.theme.checks : [];
                    info.snapshotChecks = topChecks.map(c => ({ id: c && c.id, level: c && c.level, text: c && c.text }))
                        .concat(themeChecks.map(c => ({ id: c && c.id, level: c && c.level, text: "主题：" + ((c && c.text) || (c && c.id) || "") })));

                    // UI/主题结论（契约 S3）：写进 checks，report/meta 都会带上
                    const derived = deriveThemeIssues(clean);
                    info.theme = { hash: derived.hash, ok: derived.issues.length === 0, issues: derived.issues };
                    themeResults.push(info.theme);
                    pushThemeChecks(ctx, id === null ? "x" + out.windows.length : id, derived, clean);
                } else {
                    snapOk = false;
                    snapMode = "error";
                    snapError = "快照超过 " + bytesText(SNAPSHOT_MAX_BYTES) + "，已丢弃";
                }
            }

            if (snapOk && snapText) {
                ctx.addEntry(snapName, snapText);
                info.snapshot = { name: snapName, ok: true, mode: snapMode, error: snapError || null };
                out.snapshots.push({ id: id, name: snapName, ok: true, mode: snapMode, error: snapError || null });
            } else {
                const fallback = {
                    schema: SCHEMA,
                    ok: false,
                    windowId: id === null ? null : id,
                    url: info.url,
                    capturedAt: nowIso(),
                    mode: "error",
                    error: clip(sanitizeText(String(snapError || "未知原因")), 800)
                };
                ctx.addEntry(snapName, JSON.stringify(fallback, null, 2));
                info.snapshot = { name: snapName, ok: false, mode: "error", error: fallback.error };
                out.snapshots.push({ id: id, name: snapName, ok: false, mode: "error", error: fallback.error });
                ctx.fail("window-" + id + " 快照", fallback.error);
            }

            // ---- 截图：设置页默认采集；主窗口/其它窗口仅在勾选时 ----
            const shouldShot = wantShots || settingsWin;
            if (!shouldShot) {
                shotEntry.reason = "非设置页窗口，未勾选「包含聊天窗口截图」";
            } else if (typeof wc.capturePage !== "function") {
                shotEntry.reason = "当前窗口不支持 capturePage";
            } else {
                try {
                    const img = await withTimeout(wc.capturePage(), CAPTURE_TIMEOUT_MS, "window-" + id + " 截图");
                    if (wc === mainWc) mainImage = img;
                    const png = imageToPng(img);
                    if (!img) {
                        shotEntry.reason = "capturePage 返回空图像";
                        ctx.fail("window-" + id + " 截图", shotEntry.reason);
                    } else if (!png || !png.length) {
                        shotEntry.reason = "capturePage 返回空图像";
                        out.failures.push({ id: id, error: shotEntry.reason });
                        ctx.fail("window-" + id + " 截图", shotEntry.reason);
                    } else if (png.length > SHOT_MAX_BYTES) {
                        shotEntry.reason = "单张 " + bytesText(png.length) + " 超过 " + bytesText(SHOT_MAX_BYTES) + " 上限";
                        out.failures.push({ id: id, error: shotEntry.reason });
                        ctx.fail("window-" + id + " 截图", shotEntry.reason);
                    } else if (shotTotal + png.length > SHOTS_TOTAL_MAX) {
                        shotEntry.reason = "截图总大小超过 " + bytesText(SHOTS_TOTAL_MAX) + " 上限";
                        out.failures.push({ id: id, error: shotEntry.reason });
                        ctx.fail("window-" + id + " 截图", shotEntry.reason);
                    } else {
                        const fileName = "screenshots/window-" + (id === null ? "x" + out.windows.length : id) + ".png";
                        const shotName = ctx.addEntry(fileName, png);
                        shotTotal += png.length;
                        shotEntry.captured = true;
                        shotEntry.bytes = png.length;
                        shotEntry.path = shotName;
                        info.screenshot = { name: shotName, bytes: png.length };
                        out.screenshots.push({
                            id: id,
                            name: shotName,
                            bytes: png.length,
                            caption: shotEntry.caption,
                            settings: settingsWin
                        });
                    }
                } catch (e) {
                    shotEntry.reason = "capturePage 失败：" + errMsg(e);
                    out.failures.push({ id: id, error: shotEntry.reason });
                    ctx.fail("window-" + id + " 截图", e);
                }
            }

            info.screenshotInfo = {
                caption: shotEntry.caption,
                captured: shotEntry.captured,
                bytes: shotEntry.bytes,
                name: shotEntry.path,
                reason: shotEntry.reason
            };
            shotIndex.push(shotEntry);
            out.windows.push(info);
        }

        out.shotIndex = shotIndex;
        out.theme = themeResults;

        // ---- screenshots/index.json：id ↔ url ↔ caption ↔ 跳过原因 ----
        if (shotIndex.length) {
            ctx.addJson("screenshots/index.json", {
                schema: SCHEMA,
                generatedAt: ctx.generatedAt,
                screenshotsOpt: wantShots,
                settingsCapturedByDefault: true,
                captured: shotIndex.filter(s => s.captured).length,
                skipped: shotIndex.filter(s => !s.captured).length,
                items: shotIndex,
                note: wantShots
                    ? "用户勾选了「包含聊天窗口截图」：主窗口/其它窗口截图可能含聊天画面，分享前自行确认"
                    : "未勾选聊天窗口截图：只采集了设置页截图（不含聊天内容）"
            });
        }

        // ---- 壁纸缩略图（与截图同一个勾选项；主窗口缩到 ≤480 宽） ----
        if (wantShots) {
            if (!mainImage && mainWc && typeof mainWc.capturePage === "function") {
                try {
                    mainImage = await withTimeout(mainWc.capturePage(), CAPTURE_TIMEOUT_MS, "主窗口缩略图");
                } catch (e) { ctx.fail("壁纸缩略图", e); }
            }
            if (mainImage) {
                const jpeg = imageToJpegSmall(mainImage, 480);
                if (jpeg && jpeg.length) {
                    const name = ctx.addEntry("wallpaper/preview.jpg", jpeg);
                    out.preview = { name: name, bytes: jpeg.length };
                } else {
                    ctx.fail("壁纸缩略图", "无法生成 JPEG（NativeImage 不可用）");
                }
            } else {
                ctx.fail("壁纸缩略图", "主窗口截图不可用");
            }
        }

        // ---- 结论 ----
        const appCount = out.windows.filter(w => isAppUrl(w.url)).length;
        const snapOk = out.snapshots.filter(s => s.ok).length;
        ctx.check("windows.count", "ok",
            "窗口 " + out.windows.length + " 个，其中 app:// 窗口 " + appCount + " 个，快照成功 " + snapOk + "/" + out.snapshots.length + " 个");

        if (out.windows.length && mainWc) {
            for (const w of out.windows) {
                if (w.sessionSameAsMain === false) {
                    ctx.check("windows.session.mismatch", "warn",
                        "窗口 " + w.id + "（" + clip(w.url, 120) + "）与主窗口不是同一个 session —— 壁纸/主题状态可能不同步 <<==");
                }
            }
        }
        if (out.snapshots.length && snapOk === 0) {
            ctx.check("windows.snapshot.none", "bad",
                "所有窗口都没拿到 window.__liuliDiagSnapshot（渲染进程诊断未加载），无法判断壁纸/主题状态 <<==");
        }
        if (out.failures.length) {
            ctx.check("windows.capture", "warn", "截图有 " + out.failures.length + " 项失败（详见「采集失败清单」）");
        }

        // ---- 截图策略结论（设置页默认、聊天窗口需勾选） ----
        const settingsItems = shotIndex.filter(s => isSettingsUrl(s.url));
        const settingsShot = settingsItems.find(s => s.captured);
        if (settingsShot) {
            ctx.check("screenshots.settings", "ok", "已默认采集设置页截图（不含聊天内容）");
        } else if (settingsItems.length) {
            const why = (settingsItems.find(s => s.reason) || {}).reason || "原因未知";
            ctx.check("screenshots.settings", "warn",
                "设置页截图没有采到（" + why + "），UI 渲染异常少了最直接的证据 <<==");
        } else {
            // 没开设置页属正常（例如从主窗口/脚本导出）：从设置页导出时会自动带上截图，不算问题
            ctx.check("screenshots.settings", "ok",
                "当前没有打开设置页窗口（URL 含 #/setting），未默认截取设置界面；从设置页导出时会自动带上");
        }
        if (wantShots) {
            const chatShot = shotIndex.some(s => s.captured && !isSettingsUrl(s.url));
            ctx.check("screenshots.chat", chatShot ? "ok" : "warn",
                chatShot ? "已采集主窗口/其它窗口截图（用户勾选；可能含聊天画面）"
                    : "勾选了聊天窗口截图，但没有采到任何主窗口/其它窗口截图");
        } else {
            ctx.check("screenshots.chat", "ok", "未勾选聊天窗口截图：不会采集聊天画面");
        }

        ctx.sections.windows = out;
        return out;
    }

    /* ---------- 8. payload 校验 ---------- */

    function normalizePayload(rawPayload) {
        const out = {
            received: isObject(rawPayload),
            schema: null,
            generatedAt: null,
            opts: { screenshots: false, wallpaperPreview: false },
            self: null,
            errorCount: null,
            windowsKnown: null,
            snapshot: null,
            rawError: null
        };
        if (!out.received) {
            if (rawPayload !== undefined && rawPayload !== null && rawPayload !== "") {
                out.rawError = "payload 不是对象（" + typeof rawPayload + "），已忽略";
            }
            return out;
        }
        const p = rawPayload;
        if (Number(p.schema) === SCHEMA) out.schema = SCHEMA;
        if (typeof p.generatedAt === "string" && p.generatedAt.length <= 40) out.generatedAt = p.generatedAt;
        if (isObject(p.opts)) {
            out.opts.screenshots = p.opts.screenshots === true;
            out.opts.wallpaperPreview = p.opts.wallpaperPreview === true;
        }
        if (isObject(p.self)) {
            out.self = {
                href: clip(maskInline(p.self.href || ""), 500),
                origin: clip(maskInline(p.self.origin || ""), 200),
                hash: clip(maskInline(p.self.hash || ""), 200),
                scope: clip(maskInline(p.self.scope || ""), 80),
                ua: clip(maskInline(p.self.ua || ""), 400),
                dpr: Number.isFinite(Number(p.self.dpr)) ? Number(p.self.dpr) : null,
                visibility: clip(maskInline(p.self.visibility || ""), 40),
                viewport: isObject(p.self.viewport) ? {
                    w: Number(p.self.viewport.w) || 0,
                    h: Number(p.self.viewport.h) || 0
                } : null
            };
        }
        const ec = Number(p.errorCount);
        if (Number.isFinite(ec)) out.errorCount = Math.max(0, Math.min(100000, Math.round(ec)));
        const wk = Number(p.windowsKnown);
        if (Number.isFinite(wk)) out.windowsKnown = Math.max(0, Math.min(1000, Math.round(wk)));
        if (isObject(p.snapshot)) out.snapshot = p.snapshot;
        else if (p.snapshot !== undefined && p.snapshot !== null) out.rawError = "snapshot 字段不是对象，已忽略";
        return out;
    }

    /* ---------- 9. report.txt ---------- */

    function prettyLines(value, maxLines) {
        let text;
        try { text = JSON.stringify(deepSanitize(value), null, 2); } catch (e) { text = String(value); }
        if (typeof text !== "string") text = String(text);
        const lines = text.split("\n");
        if (lines.length > maxLines) {
            return lines.slice(0, maxLines).join("\n") + "\n…（还有 " + (lines.length - maxLines) + " 行，见 meta.json/对应 json 文件）";
        }
        return lines.join("\n");
    }

    function renderReport(m) {
        const L = [];
        const push = (...items) => { for (const it of items) L.push(it === undefined || it === null ? "" : String(it)); };

        const mark = lv => lv === "ok" ? "[OK]" : (lv === "warn" ? "[!]" : "[X]");

        push("琉璃诊断包（" + SLUG + "）· report.txt");
        push("schema: " + SCHEMA);
        push("生成时间: " + m.generatedAt + "（本地 " + localStamp(new Date()) + " " + tzOffsetText(new Date()) + "）");
        push("插件版本: " + m.pluginVersion);
        push("LiteLoader: " + (m.liteLoaderVersion || "未知"));
        push("QQ: " + (m.qqVersion || "未知"));
        push("Electron / Chrome / Node: " + [m.versions.electron, m.versions.chrome, m.versions.node].map(v => v || "?").join(" / "));
        push("导出路径: " + (m.outputPath || "未写出") + (m.outputLabel ? "（主选 " + m.outputLabel + "）" : ""));
        push("附带副本: " + (m.copiedTo || "无"));
        if (m.outputFallbacks && m.outputFallbacks.length) {
            push("输出回退记录（前面的位置写入失败）:");
            for (const t of m.outputFallbacks) push("   - " + t.label + " → " + (t.dir || "") + " ： " + (t.error || t.ok || "?"));
        }
        push("采集范围: 主进程环境 / 插件清单与注入文件 / 插件配置 / LiteLoader 配置 / 安装器日志与备份 / " +
            "QQ 日志尾部 / 其它插件小日志尾部 / 窗口快照与 UI 主题结论 / 设置页截图（默认）" +
            (m.screenshotIncluded ? " / 聊天窗口截图（已勾选）" : ""));
        push("未采集: 聊天记录 nt_msg.db、表情图片、聊天内容正文、插件源码全文");
        push("包含截图: " + (m.screenshotSummary || (m.screenshotIncluded ? "是" : "否")));
        push("隐私声明: 所有文本已经 sanitizeText 脱敏（uin= / uid= / u_xxx / 邮箱 / 长 base64 / sk- / Bearer）；" +
            "单行 ≤" + REPORT_LINE_MAX + " 字符；设置页截图默认包含（不含聊天内容），" +
            "主窗口/其它窗口截图仅在你勾选「包含聊天窗口截图」时包含。");
        push("");

        // ---- 结论清单 ----
        push("==================== 结论清单（先看这里） ====================");
        if (!m.checks.length) {
            push("（没有生成任何结论）");
        } else {
            const order = { bad: 0, warn: 1, ok: 2 };
            const sorted = m.checks.slice().sort((a, b) => (order[a.level] - order[b.level]));
            for (const c of sorted) {
                const needsMark = c.level === "bad" || c.level === "warn";
                const hasMark = String(c.text || "").includes("<<==");
                const suffix = (needsMark && !hasMark) ? "  <<==" : "";
                push(mark(c.level) + " " + c.text + suffix);
            }
        }
        push("");
        push("图例: [OK] 正常 / [!] 需要留意 / [X] 明显问题（带 <<== 的是重点）");
        push("");

        // ---- 1. 环境 ----
        const envSafe = m.env || { error: "环境采集失败" };
        push("==================== 1. 环境 ====================");
        push(prettyLines({
            process: envSafe.process,
            app: envSafe.app,
            os: envSafe.os,
            time: envSafe.time,
            admin: envSafe.admin
        }, 400));
        push("");

        // ---- 2. LiteLoader ----
        const llSafe = envSafe.liteloader || {};
        push("==================== 2. LiteLoader ====================");
        push(prettyLines({
            versions: llSafe.versions,
            path: llSafe.path,
            os: llSafe.os,
            pluginCount: llSafe.pluginCount
        }, 120));
        push("");

        // ---- 3. 已安装插件 ----
        push("==================== 3. 已安装插件 ====================");
        push("插件目录: " + (m.plugins.root || "未知") + "    enable_plugins=" + String(m.plugins.enabled) +
            "    disabled=" + JSON.stringify(m.plugins.disabledPlugins));
        if (m.plugins.residuals.length) push("残留副本目录: " + m.plugins.residuals.join("、"));
        for (const p of m.plugins.plugins) {
            push("");
            push("── " + p.dirName + (p.residual ? "（残留副本）" : ""));
            push("   slug: " + (p.slug || "?") + "    version: " + (p.version || "?") + "    name: " + (p.name || "?"));
            push("   manifest: " + (p.manifestExists ? bytesText(p.manifestSize) + "  " + (p.manifestMtime || "") : "缺失") +
                "    BOM: " + (p.bom || "无") + "    JSON: " + (p.parsed ? "解析成功" : ("失败 → " + (p.parseError || "?"))));
            if (p.registered) {
                push("   LiteLoader: disabled=" + p.registered.disabled + " incompatible=" + p.registered.incompatible);
            } else {
                push("   LiteLoader: 未注册（可能没有 manifest.slug 或加载失败）");
            }
            for (const key of ["main", "preload", "renderer"]) {
                const inj = p.injects[key] || {};
                if (!inj.declared) { push("   injects." + key + ": 未声明"); continue; }
                const st = inj.error ? inj.error
                    : (inj.exists
                        ? bytesText(inj.size) + (inj.mtime ? "  mtime " + inj.mtime : "") + (inj.sha256 ? "  sha256=" + inj.sha256 : "")
                        : "缺失");
                push("   injects." + key + ": " + inj.declared + " → " + st);
            }
            push("   data: " + (p.dataFiles && p.dataFiles.exists
                ? p.dataFiles.files + " 个文件 / " + bytesText(p.dataFiles.bytes)
                : "无"));
            if (p.manifestRaw) {
                push("   manifest 原文（截断 " + MANIFEST_RAW_MAX + " 字符）:");
                for (const line of String(p.manifestRaw).split("\n")) push("     | " + line);
            }
        }
        push("");

        // ---- 4. 插件数据与配置 ----
        push("==================== 4. 插件数据与配置（data/） ====================");
        push("data 根目录: " + (m.pluginData.dataRoot || "未知"));
        push("");
        push("-- data/LiteLoader/config.json --");
        push(prettyLines(m.pluginData.liteloaderConfig, 120));
        for (const item of m.pluginData.entries) {
            push("");
            push("-- data/" + item.slug + " --");
            push("   文件 " + (item.stats.files || 0) + " 个 / " + bytesText(item.stats.bytes) + "，目录条目 " + (item.stats.entries || []).length + " 个" + (item.stats.exists ? "" : "（目录不存在）"));
            if (item.stats.entries && item.stats.entries.length) {
                push("   内容: " + item.stats.entries.map(e => e.name + (e.dir ? "/" : "")).join("  "));
            }
            if (item.config && item.config.exists) {
                push("   config.json（" + bytesText(item.config.size) + (item.config.truncated ? "，已截断到 4KB" : "") +
                    "，JSON " + (item.config.parseOk ? "解析成功" : ("失败：" + item.config.parseError)) + "）:");
                for (const line of String(item.config.text || "").split("\n")) push("     | " + line);
            } else {
                push("   config.json: 不存在");
            }
        }
        push("");

        // ---- 5. 安装器状态 ----
        push("==================== 5. 安装器状态 ====================");
        push("profile: " + (m.installer.profileDir || "未知"));
        push("LiteLoader package.json: " + (m.installer.packageJson
            ? (m.installer.packageJson.exists ? "version=" + m.installer.packageJson.version + "（" + bytesText(m.installer.packageJson.size) + "）" : "不存在")
            : "?"));
        if (m.installer.installerLog) {
            const il = m.installer.installerLog;
            push("installer.log: " + (il.exists
                ? bytesText(il.size) + "，mtime " + (il.mtime || "?") + "，尾部 " + il.tailLines + " 行"
                : "不存在（" + (il.error || "?") + "）"));
        }
        if (m.installer.backupExists) {
            push("installer-backup/original: " + m.installer.backupOriginal.length + " 个文件（只列元数据）");
            for (const f of m.installer.backupOriginal) {
                push("   - " + f.name + "  " + bytesText(f.size) + "  " + (f.mtime || "") +
                    (f.sha256 ? "  sha256=" + f.sha256 : "") + (f.hashNote ? "  (" + f.hashNote + ")" : ""));
            }
        } else {
            push("installer-backup/original: 不存在");
        }
        push("");
        push("installer.log 尾部（最多 " + INSTALLER_TAIL_LINES + " 行）:");
        const ilTail = m.installer.installerLog && m.installer.installerLog.tail;
        if (ilTail) {
            for (const line of String(ilTail).split("\n")) push("   | " + line);
        } else {
            push("   （无）");
        }
        push("");

        // ---- 6. QQ ----
        push("==================== 6. QQ 数据与日志 ====================");
        const qq = m.qq;
        push("QQ 目录: " + (qq.qqDir || "未知"));
        if (qq.logDir) {
            push("QQ 日志目录: " + (qq.logDir.exists ? qq.logDir.fileCount + " 个文件" : "不存在") + "（" + qq.logDir.path + "）");
            if (qq.logFiles && qq.logFiles.length) {
                push("最近文件（按 mtime 倒序，最多列 12 个）:");
                for (const f of qq.logFiles.slice(0, 12)) {
                    push("   - " + f.name + "  " + bytesText(f.size) + "  " + (f.mtime || ""));
                }
            }
        }
        if (qq.crashpad) {
            push("Crashpad: " + (qq.crashpad.exists ? qq.crashpad.reportCount + " 个转储（" + qq.crashpad.path + "）" : "无 reports 目录"));
            if (qq.crashpad.exists && qq.crashpad.reports) {
                for (const r of qq.crashpad.reports.slice(0, 15)) push("   - " + r.name + "  " + bytesText(r.size) + "  " + (r.mtime || ""));
            }
        }
        if (qq.localStorage) {
            push("Local Storage: " + (qq.localStorage.exists
                ? qq.localStorage.fileCount + " 个文件 / " + bytesText(qq.localStorage.totalBytes) + "，最新 " + qq.localStorage.newestMtime
                : "不存在") + "（只元数据，不复制内容）");
        }
        push("Preferences: " + (qq.preferences && qq.preferences.exists ? bytesText(qq.preferences.size) + "  " + qq.preferences.mtime : "不存在"));
        push("Local State: " + (qq.localState && qq.localState.exists ? bytesText(qq.localState.size) + "  " + qq.localState.mtime : "不存在"));
        push("");

        // ---- 7. 窗口与快照 ----
        push("==================== 7. 窗口与渲染快照 ====================");
        const win = m.windows;
        const winShots = (win.screenshots || []).length;
        push("窗口总数: " + win.windows.length + "    快照成功: " + win.snapshots.filter(s => s.ok).length + "/" + win.snapshots.length +
            "    截图: " + (winShots ? winShots + " 张（索引 screenshots/index.json）" : "未采集"));
        for (const w of win.windows) {
            push("");
            push("── window " + w.id + (w.isMainWindow ? "（主窗口）" : "") + (isSettingsUrl(w.url) ? "（设置页）" : ""));
            push("   type=" + w.type + "  url=" + w.url);
            push("   title=" + w.title + "  destroyed=" + w.destroyed + "  loading=" + w.loading + "  visible=" + w.visible + "/" + w.visibility);
            push("   osPid=" + w.osPid + "  processId=" + w.processId + "  zoomFactor=" + w.zoomFactor);
            push("   session 与主窗口相同: " + String(w.sessionSameAsMain) + (w.sessionSameAsMain === false ? "  <<==" : ""));
            push("   userAgent=" + w.userAgent);
            push("   快照: " + (w.snapshot
                ? (w.snapshot.ok
                    ? w.snapshot.name + "（mode=" + (w.snapshot.mode || "?") +
                        (w.snapshot.error ? "，async 回退原因：" + clip(String(w.snapshot.error), 200) : "") + "）"
                    : "失败（mode=error）：" + clip(String(w.snapshot.error || "?"), 300) + " → " + w.snapshot.name)
                : "未采集（非 app:// 或已排除）"));
            if (w.theme) {
                push("   主题: " + (w.theme.ok ? "正常" : "未生效 → " + w.theme.issues.join("；")) +
                    (w.theme.hash ? "（hash " + w.theme.hash + "）" : ""));
            }
            if (w.snapshotChecks && w.snapshotChecks.length) {
                for (const c of w.snapshotChecks) {
                    push("     " + mark(c.level) + " " + (c.text || c.id || ""));
                }
            }
            if (w.screenshotInfo) {
                push("   截图: " + (w.screenshotInfo.captured
                    ? w.screenshotInfo.name + "（" + bytesText(w.screenshotInfo.bytes) + "，" + w.screenshotInfo.caption + "）"
                    : "未采集（" + (w.screenshotInfo.reason || "原因未知") + "）"));
            } else if (w.screenshot) {
                push("   截图: " + w.screenshot.name + "（" + bytesText(w.screenshot.bytes) + "）");
            }
        }
        push("");
        push("截图索引: screenshots/index.json（" + (win.shotIndex || []).filter(s => s.captured).length + " 张已采集 / " +
            (win.shotIndex || []).filter(s => !s.captured).length + " 个窗口跳过；设置页默认采集，聊天窗口需勾选）");
        push("镜像/缩略图: " + (win.preview ? win.preview.name + "（" + bytesText(win.preview.bytes) + "）" : "无"));
        push("");

        // ---- 8. 渲染进程上报（payload） ----
        push("==================== 8. 渲染进程上报（payload） ====================");
        const pay = m.payload;
        push("收到 payload: " + String(pay.received) + (pay.rawError ? "（" + pay.rawError + "）" : ""));
        if (pay.received) {
            push("schema=" + String(pay.schema) + "  generatedAt=" + String(pay.generatedAt));
            push("opts: " + JSON.stringify(pay.opts));
            push("errorCount=" + String(pay.errorCount) + "  windowsKnown=" + String(pay.windowsKnown));
            if (pay.self) push("self: " + JSON.stringify(pay.self));
            if (pay.snapshot) {
                const snap = deepSanitize(pay.snapshot);
                push("");
                push("-- 当前窗口快照摘要（payload.snapshot） --");
                push("window: " + JSON.stringify(snap.window));
                push("boot: " + JSON.stringify(snap.boot));
                push("wallpaper: " + JSON.stringify(snap.wallpaper));
                push("storage: " + JSON.stringify(snap.storage));
                const th = isObject(snap.theme) ? snap.theme : {};
                push("theme: " + JSON.stringify({
                    failed: th.failed, failedReason: th.failedReason, bootOk: th.bootOk,
                    dataset: th.dataset, styleTags: th.styleTags, themeStyle: th.themeStyle,
                    wallpaperStyle: th.wallpaperStyle, cssVars: th.cssVars, panel: th.panel
                }).slice(0, 1600));
                const themeFiles = Array.isArray(th.files) ? th.files : [];
                push("theme.files: " + JSON.stringify(themeFiles.map(f => ({
                    name: f && f.name, fetchOk: f && f.fetchOk, status: f && f.status,
                    bytes: f && f.bytes, inStyle: f && f.inStyle, markerOk: f && f.markerOk
                }))).slice(0, 1200));
                if (Array.isArray(th.checks)) push("theme.checks: " + JSON.stringify(th.checks).slice(0, 800));
                push("dom: " + JSON.stringify(snap.dom));
                push("events.wallpaperOps(最近): " + JSON.stringify((snap.events && snap.events.wallpaperOps) || []));
                push("errors(最近 10 条):");
                for (const e of (Array.isArray(snap.errors) ? snap.errors.slice(0, 10) : [])) {
                    push("   " + JSON.stringify(e));
                }
                push("checks:");
                const checks = Array.isArray(snap.checks) ? snap.checks : [];
                if (!checks.length) push("   （渲染进程未上报 checks）");
                for (const c of checks) push("   " + mark(c && c.level) + " " + ((c && c.text) || (c && c.id) || ""));
            }
        }
        push("");

        // ---- 9. 日志文件清单 ----
        push("==================== 9. 日志文件清单 ====================");
        if (!m.logFiles.length) {
            push("（没有收集到日志）");
        } else {
            for (const f of m.logFiles) {
                push("   " + f.zipName + "  ←  " + f.display + "  （原文件 " + bytesText(f.size) + "，mtime " + (f.mtime || "?") +
                    "，收录 " + bytesText(Buffer.byteLength(f.text || "", "utf8")) + "）");
            }
        }
        const logSkips = (m.logSkips || []);
        if (logSkips.length) {
            push("");
            push("未收集（属正常，不算采集失败）:");
            for (const note of logSkips) push("   · " + note);
        }
        push("");

        // ---- 10. 日志错误摘要 ----
        push("==================== 10. 日志错误摘要 ====================");
        push(m.digestText);
        push("");

        // ---- 11. 采集失败清单 ----
        push("==================== 11. 采集失败清单 ====================");
        if (!m.failures.length) {
            push("无（所有采集项都成功）");
        } else {
            for (const f of m.failures) push("   - " + f.item + " → " + f.error);
        }
        push("");

        // ---- 12. 包内结构 ----
        push("==================== 12. 包内结构 ====================");
        for (const e of m.entries) {
            push("   " + e.name + "  (" + bytesText(e.bytes) + ")");
        }
        push("");
        push("提交方式：把整个 zip 发给插件作者；必要时对照 installer/DIAG-COVERAGE.md 的字段说明。");
        push("");

        return L.join("\n") + "\n";
    }

    /* ---------- 10. 输出路径与回退 ---------- */

    function candidateTargets() {
        const list = [];
        const seen = new Set();
        const push = (label, dir) => {
            if (!dir) return;
            const resolved = D.path.resolve(dir);
            if (seen.has(resolved)) return;
            seen.add(resolved);
            list.push({ label: label, dir: resolved });
        };
        push("desktop", appPath("desktop"));
        push("documents", appPath("documents"));
        push("temp", appPath("temp"));
        push("diag", diagDir);
        if (!list.length) {
            push("tmpdir", D.os.tmpdir());
        }
        return list;
    }

    function pruneDiagDir() {
        if (!diagDir) return;
        let files = [];
        try {
            files = D.fs.readdirSync(diagDir)
                .filter(name => /\.zip$/i.test(name))
                .map(name => {
                    const full = D.path.join(diagDir, name);
                    const st = statSafe(D, full);
                    return { name: name, path: full, mtimeMs: st.mtimeMs || 0 };
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);
        } catch (e) { return; }
        for (let i = DIAG_KEEP; i < files.length; i++) {
            try { D.fs.unlinkSync(files[i].path); } catch (e) { /* 删不掉就算了 */ }
        }
    }

    /* 输出位置选择在 exportDiag 里做（要先探测可写目录，好把最终路径写进 report.txt） */

    /* ---------- 11. 导出主流程 ---------- */

    async function exportDiag(rawPayload) {
        const started = Date.now();
        let payload = null;
        try {
            payload = normalizePayload(rawPayload);
        } catch (e) {
            payload = normalizePayload(null);
            payload.rawError = "payload 校验异常：" + errMsg(e);
        }
        const ctx = makeCtx(payload);
        try { sessionLog.log("info", "diag", "开始导出诊断包", { screenshots: payload.opts.screenshots }); } catch (e) { }

        try {
            /* --- 采集：逐项 try/catch，失败进清单 --- */
            let env = null;
            try { env = collectEnvironment(ctx); } catch (e) { ctx.fail("环境采集", e); env = { error: errMsg(e) }; }
            ctx.addJson("environment.json", env || { error: "环境采集失败" });

            let plugins = null;
            try { plugins = collectPlugins(ctx); } catch (e) { ctx.fail("插件清单", e); plugins = { root: pluginsRoot, plugins: [], residuals: [], enabled: null, disabledPlugins: null }; }

            let pluginData = null;
            try { pluginData = collectPluginData(ctx); } catch (e) { ctx.fail("插件数据", e); pluginData = { dataRoot: dataRoot, entries: [], liteloaderConfig: null }; }

            let installer = null;
            try { installer = collectInstaller(ctx); } catch (e) { ctx.fail("安装器状态", e); installer = { profileDir: profileDir, installerLog: null, packageJson: null, backupOriginal: [], backupExists: false }; }

            let qq = null;
            try { qq = collectQQ(ctx); } catch (e) { ctx.fail("QQ 状态", e); qq = { qqDir: qqDir }; }

            let logFiles = [];
            try { logFiles = collectLogs(ctx, plugins, installer, qq); } catch (e) { ctx.fail("日志收集", e); }

            let windows = { windows: [], snapshots: [], screenshots: [], preview: null, failures: [], screenshotsCaptured: false };
            try { windows = await collectWindows(ctx); } catch (e) { ctx.fail("窗口快照", e); }

            /* --- 渲染进程上报的 checks 汇入结论 --- */
            if (payload.snapshot) {
                const snapChecks = Array.isArray(payload.snapshot.checks) ? payload.snapshot.checks : [];
                for (const c of snapChecks.slice(0, 40)) {
                    if (!c || typeof c !== "object") continue;
                    const text = String(c.text || c.id || "");
                    // boot 未就绪在「旧版渲染进程 + 新主进程」出现属正常，补一句解释，免得用户以为主题坏了
                    const bootish = (String(c.id || "") === "boot" || /启动标记未完成|尚未就绪/.test(text)) &&
                        (c.level === "warn" || c.level === "bad");
                    const bootNote = (bootish && !text.includes("旧版渲染进程可能没有启动标记"))
                        ? "（旧版渲染进程可能没有启动标记；重装 1.3.0 后消失）"
                        : "";
                    ctx.check("renderer." + (c.id || "check"), c.level, "渲染: " + text + bootNote);
                }
                // 主题/UI 结论：窗口快照都拿不到时才用 payload 快照兜底（避免与窗口结论重复）
                if (!(windows.theme || []).length) {
                    const derived = deriveThemeIssues(payload.snapshot);
                    const label = "当前窗口" + (derived.hash ? "（" + derived.hash + "）" : "");
                    if (derived.issues.length) {
                        ctx.check("theme.payload", "warn", label + "主题样式未生效：" + derived.issues.join("；") + " <<==");
                    } else if (isObject(payload.snapshot.theme)) {
                        ctx.check("theme.payload", "ok", label + "主题样式正常（payload 快照）");
                    }
                    // 注：payload.snapshot.theme.checks 不再这里重复收录 —— 上面的通用循环已经把它们
                    // （渲染进程会同时写进顶层 checks）收录成「渲染: …」，再收一次就是成对重复。
                }
                const wall = payload.snapshot.wallpaper;
                if (wall && typeof wall === "object") {
                    if (wall.present === false) {
                        ctx.check("wallpaper.absent", "warn", "渲染快照：localStorage 里没有壁纸记录（还没选图或写入失败）");
                    } else if (wall.present === true && wall.srcLen) {
                        ctx.check("wallpaper.present", "ok",
                            "渲染快照：壁纸已写入 localStorage（" + bytesText(Math.round(wall.srcLen * 0.75)) + " 估算，srcLen=" + wall.srcLen + "）");
                    }
                    if (wall.decodeOk === false) {
                        ctx.check("wallpaper.decode", "bad", "渲染快照：壁纸 dataURL 解码失败（图片可能损坏或格式不支持）<<==");
                    }
                    const applied = wall.applied || {};
                    if (applied.appFound === false) {
                        ctx.check("wallpaper.app", "bad", "渲染快照：#app 不存在，壁纸 CSS 无法生效 <<==");
                    } else if (applied.pseudoBgContainsUrl === false) {
                        ctx.check("wallpaper.applied", "bad", "渲染快照：#app::before 没有当前壁纸背景 —— 壁纸没应用上 <<==");
                    }
                }
                if (payload.self && payload.self.scope) {
                    ctx.check("payload.scope", "ok", "当前窗口 scope=" + payload.self.scope);
                }
            } else if (payload.received) {
                ctx.check("payload.snapshot", "warn", "渲染进程 payload 没有 snapshot 字段，壁纸细节可能缺失");
            } else {
                ctx.check("payload.missing", "warn", "没有收到渲染进程 payload（用主进程侧数据打包）");
            }

            /* --- 截图策略文案（设置页默认含截图） --- */
            const shotItems = windows.shotIndex || [];
            const capturedShots = shotItems.filter(s => s.captured);
            const settingsShots = capturedShots.filter(s => /#\/setting/i.test(s.url || ""));
            const chatShots = capturedShots.filter(s => !/#\/setting/i.test(s.url || ""));
            let screenshotSummary;
            if (!capturedShots.length) {
                screenshotSummary = "否（没有采到截图" + (shotItems.length ? "，原因见 screenshots/index.json" : "") + "）";
            } else if (settingsShots.length && chatShots.length) {
                screenshotSummary = "是（设置页 " + settingsShots.length + " 张默认采集 + 聊天窗口 " + chatShots.length +
                    " 张已勾选；可能含聊天画面，注意分享范围）";
            } else if (settingsShots.length) {
                screenshotSummary = "是（仅设置页 " + settingsShots.length + " 张，默认采集，不含聊天内容）";
            } else {
                screenshotSummary = "是（仅聊天窗口 " + chatShots.length + " 张，用户已勾选；可能含聊天画面）";
            }
            if (payload.opts.screenshots) {
                ctx.check("screenshots.optin", "warn",
                    "用户勾选了「包含聊天窗口截图」：包内可能含当前聊天画面，分享前自行确认 <<==");
            } else {
                ctx.check("screenshots.optin", "ok", "未勾选聊天窗口截图：包内只有设置页截图（不含聊天内容）");
            }

            /* --- 兜底结论 --- */
            if (!plugins.plugins.some(p => p.slug === SLUG || p.dirName === SLUG)) {
                ctx.check("plugin.self.missing", "bad", "在插件目录里没找到 " + SLUG + "（可能装到别处或没装）<<==");
            }
            if (env && env.liteloader && !env.liteloader.present) {
                ctx.check("liteloader.missing", "bad", "LiteLoader 全局对象不可用（LiteLoaderQQNT 可能没加载）<<==");
            }

            /* --- 摘要文本 --- */
            const digestText = buildErrorsDigest(logFiles);
            const digestHits = (digestText.match(/（\d+ 条命中）/g) || []).length;
            if (digestHits) {
                ctx.check("logs.digest", "warn", "日志里命中 " + digestHits + " 个文件有错误关键字（详见「日志错误摘要」）");
            } else {
                ctx.check("logs.digest", "ok", "日志错误摘要没有命中（不代表没问题，只是关键字没撞上）");
            }
            if (ctx.failures.length) {
                ctx.check("collect.failures", "warn", "有 " + ctx.failures.length + " 项采集失败（见「采集失败清单」，其余内容照常）");
            }

            /* --- 元信息 --- */
            const versions = {
                liteloader: safeGet(D.liteLoader, ["versions", "liteloader"]) || null,
                qqnt: safeGet(D.liteLoader, ["versions", "qqnt"]) || null,
                electron: safeGet(D.processRef, ["versions", "electron"]) ||
                    safeGet(D.liteLoader, ["versions", "electron"]) || null,
                node: safeGet(D.processRef, ["versions", "node"]) || null,
                chrome: safeGet(D.processRef, ["versions", "chrome"]) ||
                    safeGet(D.liteLoader, ["versions", "chrome"]) || null
            };

            const outputName = "琉璃诊断包-" + fileStamp(new Date()) + ".zip";
            const metaBase = {
                schema: SCHEMA,
                generatedAt: ctx.generatedAt,
                plugin: { slug: SLUG, version: ctx.pluginVersion },
                versions: versions,
                host: {
                    platform: D.processRef.platform,
                    arch: D.processRef.arch,
                    hostname: safeCall(D.os.hostname)
                },
                payload: {
                    received: payload.received,
                    schema: payload.schema,
                    generatedAt: payload.generatedAt,
                    opts: payload.opts,
                    self: payload.self,
                    errorCount: payload.errorCount,
                    windowsKnown: payload.windowsKnown,
                    snapshotBytes: payload.snapshot ? Buffer.byteLength(JSON.stringify(deepSanitize(payload.snapshot)), "utf8") : 0
                },
                checks: ctx.checks,
                failures: ctx.failures,
                windows: (windows.windows || []).map(w => ({
                    id: w.id,
                    type: w.type,
                    url: w.url,
                    title: w.title,
                    destroyed: w.destroyed,
                    visible: w.visible,
                    osPid: w.osPid,
                    zoomFactor: w.zoomFactor,
                    isMainWindow: w.isMainWindow,
                    sessionSameAsMain: w.sessionSameAsMain,
                    snapshot: w.snapshot,
                    theme: w.theme || null,
                    screenshot: w.screenshotInfo
                        ? {
                            captured: w.screenshotInfo.captured,
                            name: w.screenshotInfo.name,
                            bytes: w.screenshotInfo.bytes,
                            caption: w.screenshotInfo.caption,
                            reason: w.screenshotInfo.reason
                        }
                        : (w.screenshot || null)
                })),
                screenshots: {
                    requested: payload.opts.screenshots,
                    settingsCapturedByDefault: true,
                    index: "screenshots/index.json",
                    items: (windows.shotIndex || []).map(s => ({
                        id: s.id, url: s.url, caption: s.caption, captured: s.captured, bytes: s.bytes, reason: s.reason
                    }))
                },
                paths: {
                    dataRoot: dataRoot,
                    pluginDataDir: pluginDataDir,
                    diagDir: diagDir,
                    profileDir: profileDir,
                    pluginsRoot: pluginsRoot,
                    qqDir: qqDir,
                    sessionLog: sessionLog.file
                }
            };

            /* --- report.txt --- */
            const model = {
                generatedAt: ctx.generatedAt,
                pluginVersion: ctx.pluginVersion,
                liteLoaderVersion: versions.liteloader,
                qqVersion: versions.qqnt,
                versions: versions,
                outputPath: null,
                outputLabel: null,
                copiedTo: null,
                screenshotIncluded: payload.opts.screenshots,
                screenshotSummary: screenshotSummary,
                checks: ctx.checks,
                failures: ctx.failures,
                env: env,
                plugins: plugins,
                pluginData: pluginData,
                installer: installer,
                qq: qq,
                windows: windows,
                payload: payload,
                logFiles: logFiles,
                logSkips: (ctx.sections && ctx.sections.logSkips) || [],
                digestText: digestText,
                entries: []
            };

            /* --- report.txt 与 meta.json 互相包含大小：迭代收敛几轮 --- */
            const realEntries = ctx.entries.slice(); // 已采集条目（不含 report.txt / meta.json）
            const logsMeta = logFiles.map(f => ({
                name: f.zipName,
                source: f.display,
                bytes: Buffer.byteLength(f.text || "", "utf8"),
                size: f.size,
                mtime: f.mtime
            }));

            function renderMetaReport() {
                let reportBuf = Buffer.from("", "utf8");
                let metaBuf = Buffer.from("{}", "utf8");
                let entriesView = [];
                for (let pass = 0; pass < 4; pass++) {
                    entriesView = [{ name: "report.txt", bytes: reportBuf.length }]
                        .concat(realEntries.map(e => ({ name: e.name, bytes: e.data.length })))
                        .concat([{ name: "meta.json", bytes: metaBuf.length }]);
                    model.entries = entriesView;
                    reportBuf = Buffer.from(sanitizeText(renderReport(model)), "utf8");

                    const meta = Object.assign({}, metaBase, {
                        output: {
                            path: model.outputPath,
                            label: model.outputLabel,
                            copiedTo: model.copiedTo,
                            fallbacks: model.outputFallbacks || []
                        },
                        entries: entriesView.map(e => ({ name: e.name, bytes: e.bytes })),
                        logs: logsMeta
                    });
                    metaBuf = Buffer.from(JSON.stringify(deepSanitize(meta), null, 2), "utf8");

                    const stable = entriesView[0].bytes === reportBuf.length &&
                        entriesView[entriesView.length - 1].bytes === metaBuf.length;
                    if (stable) break;
                }
                return { reportBuf, metaBuf };
            }

            /* --- 先探测可写目录 → 把最终路径写进 report → 再打包写出（失败继续回退） --- */
            const targets = candidateTargets();
            const triedAll = [];
            let written = null;
            let zipBuf = null;
            for (let attempt = 0; attempt < targets.length; attempt++) {
                const target = targets[attempt];
                try {
                    D.fs.mkdirSync(target.dir, { recursive: true });
                } catch (e) {
                    triedAll.push({ label: target.label, dir: target.dir, error: errMsg(e) });
                    continue;
                }
                const probe = D.path.join(target.dir, ".liuli-diag-probe-" + (D.processRef.pid || "x"));
                try {
                    D.fs.writeFileSync(probe, "probe");
                    D.fs.unlinkSync(probe);
                } catch (e) {
                    triedAll.push({ label: target.label, dir: target.dir, error: errMsg(e) });
                    continue;
                }

                const fullPath = D.path.join(target.dir, outputName);
                model.outputPath = fullPath;
                model.outputLabel = target.label;
                model.outputFallbacks = triedAll.slice();
                model.copiedTo = diagDir
                    ? (D.path.resolve(target.dir) === D.path.resolve(diagDir) ? fullPath : D.path.join(diagDir, outputName))
                    : null;

                const { reportBuf, metaBuf } = renderMetaReport();
                const entries = [{ name: "report.txt", data: reportBuf }]
                    .concat(realEntries, [{ name: "meta.json", data: metaBuf }]);
                try {
                    const buf = buildZip(entries, { mtime: new Date(), zlib: D.zlib });
                    D.fs.writeFileSync(fullPath, buf);
                    zipBuf = buf;
                    ctx.entries = entries;
                    written = {
                        path: fullPath,
                        dir: target.dir,
                        label: target.label,
                        tried: triedAll.concat([{ label: target.label, dir: target.dir, ok: true }])
                    };
                    break; // 成功就停，不再尝试后面的回退位置
                } catch (e) {
                    triedAll.push({ label: target.label, dir: target.dir, error: "写入失败：" + errMsg(e) });
                }
            }
            if (!written) {
                const detail = triedAll.map(t => t.label + ": " + (t.ok ? t.dir : t.error)).join("; ");
                throw new Error("所有输出位置都写入失败（" + detail + "）");
            }

            /* --- 复制一份到 diag/ --- */
            let copiedTo = null;
            if (diagDir && D.path.resolve(written.dir) !== D.path.resolve(diagDir)) {
                try {
                    D.fs.mkdirSync(diagDir, { recursive: true });
                    const dest = D.path.join(diagDir, outputName);
                    D.fs.copyFileSync(written.path, dest);
                    copiedTo = dest;
                } catch (e) {
                    ctx.fail("复制到 diag/", e);
                }
            } else if (diagDir && D.path.resolve(written.dir) === D.path.resolve(diagDir)) {
                copiedTo = written.path;
            }
            try { pruneDiagDir(); } catch (e) { ctx.fail("清理旧诊断包", e); }

            /* --- 打开文件夹 --- */
            try {
                if (D.shell && typeof D.shell.showItemInFolder === "function") {
                    D.shell.showItemInFolder(written.path);
                }
            } catch (e) { ctx.fail("打开文件夹", e); }

            const result = {
                ok: true,
                path: written.path,
                copiedTo: copiedTo,
                error: null,
                size: zipBuf.length,
                entries: ctx.entries.length,
                checks: ctx.checks,
                failures: ctx.failures,
                fallback: written.tried,
                ms: Date.now() - started
            };
            try {
                sessionLog.log("info", "diag", "导出完成", {
                    path: written.path,
                    size: zipBuf.length,
                    copiedTo: copiedTo,
                    ms: result.ms,
                    failures: ctx.failures.length
                });
            } catch (e) { }
            return result;
        } catch (e) {
            const msg = errMsg(e);
            try { sessionLog.log("error", "diag", "导出失败：" + msg); } catch (err) { }
            return {
                ok: false,
                path: null,
                copiedTo: null,
                error: msg,
                size: 0,
                entries: ctx.entries.length,
                checks: ctx.checks,
                failures: ctx.failures.concat([{ item: "导出", error: msg }]),
                ms: Date.now() - started
            };
        }
    }

    /* ---------- 12. IPC ---------- */

    function registerIpc(ipcMain) {
        const target = ipcMain || D.ipcMain;
        if (!target || typeof target.handle !== "function") {
            sessionLog.log("warn", "diag", "无法注册 IPC：ipcMain 不可用");
            return false;
        }
        const handle = (channel, fn) => {
            // 插件热重载时同一个 channel 会重复注册：先摘掉旧的（channel 是琉璃专用的）
            try {
                if (typeof target.removeHandler === "function") target.removeHandler(channel);
            } catch (e) { }
            try {
                target.handle(channel, fn);
            } catch (e) {
                // 重复注册（热重载）时 ipcMain.handle 会抛，这里咽掉，不影响原功能
                sessionLog.log("warn", "diag", "IPC 注册失败：" + channel + " → " + errMsg(e));
            }
        };

        handle("LiteLoader.liuli.diagExport", async (_event, payload) => {
            try {
                return await exportDiag(payload);
            } catch (e) {
                const msg = errMsg(e);
                try { sessionLog.log("error", "diag", "diagExport 处理异常：" + msg); } catch (err) { }
                return { ok: false, path: null, copiedTo: null, error: msg, size: 0 };
            }
        });

        try {
            if (typeof target.on === "function") {
                // 同样防止热重载后一条日志被记录两次
                try {
                    if (typeof target.removeAllListeners === "function") target.removeAllListeners("LiteLoader.liuli.diagLog");
                } catch (e) { }
                target.on("LiteLoader.liuli.diagLog", (_event, entry) => {
                    try { sessionLog.entry(entry); } catch (e) { }
                });
            }
        } catch (e) {
            sessionLog.log("warn", "diag", "diagLog 监听注册失败：" + errMsg(e));
        }

        handle("LiteLoader.liuli.diagOpenPath", async (_event, p) => {
            try { return await openPath(p); } catch (e) { return false; }
        });

        return true;
    }

    function allowedOutputPrefixes() {
        const prefixes = [];
        for (const dir of [diagDir, appPath("desktop"), appPath("documents"), appPath("temp")]) {
            if (!dir) continue;
            try { prefixes.push(D.path.resolve(dir)); } catch (e) { }
        }
        return prefixes;
    }

    function isAllowedRevealPath(p) {
        let resolved;
        try { resolved = D.path.resolve(p); } catch (e) { return false; }
        for (const prefix of allowedOutputPrefixes()) {
            if (resolved === prefix) return true;
            if (resolved.startsWith(prefix + D.path.sep)) return true;
        }
        return false;
    }

    async function openPath(p) {
        if (typeof p !== "string" || !p || p.length > 4096) return false;
        let resolved;
        try { resolved = D.path.resolve(p); } catch (e) { return false; }
        if (!isAllowedRevealPath(resolved)) {
            try { sessionLog.log("warn", "diag", "diagOpenPath 被拒绝（不在允许目录）：" + resolved); } catch (e) { }
            return false;
        }
        const st = statSafe(D, resolved);
        if (!st.exists) return false;
        try {
            if (st.isDirectory) {
                if (D.shell && typeof D.shell.openPath === "function") {
                    await D.shell.openPath(resolved);
                } else if (D.shell && typeof D.shell.showItemInFolder === "function") {
                    D.shell.showItemInFolder(resolved);
                }
            } else if (D.shell && typeof D.shell.showItemInFolder === "function") {
                D.shell.showItemInFolder(resolved);
            } else {
                return false;
            }
            return true;
        } catch (e) {
            try { sessionLog.log("error", "diag", "diagOpenPath 失败：" + errMsg(e)); } catch (err) { }
            return false;
        }
    }

    /* ---------- 13. 启动 ---------- */

    function startup(extra) {
        const versions = {
            liteloader: safeGet(D.liteLoader, ["versions", "liteloader"]) || null,
            qqnt: safeGet(D.liteLoader, ["versions", "qqnt"]) || null,
            electron: safeGet(D.processRef, ["versions", "electron"]) || null,
            node: safeGet(D.processRef, ["versions", "node"]) || null,
            chrome: safeGet(D.processRef, ["versions", "chrome"]) || null
        };
        sessionLog.banner({
            pluginVersion: pluginVersion(),
            liteloader: versions.liteloader,
            qqnt: versions.qqnt,
            electron: versions.electron,
            node: versions.node,
            chrome: versions.chrome,
            pid: D.processRef.pid,
            platform: D.processRef.platform,
            arch: D.processRef.arch,
            electronReady: safeCall(() => (D.app && D.app.isReady ? D.app.isReady() : null)),
            dataDir: pluginDataDir,
            diagDir: diagDir,
            extra: extra || null
        });
        return { dataDir: pluginDataDir, diagDir: diagDir, sessionLog: sessionLog.file };
    }

    function install(options) {
        const opts = options || {};
        const ipc = opts.ipcMain || D.ipcMain;
        const registered = registerIpc(ipc);
        let started = null;
        try {
            started = startup(opts.extra);
        } catch (e) {
            try { sessionLog.log("error", "diag", "启动记录失败：" + errMsg(e)); } catch (err) { }
        }
        return Object.assign({ ipcRegistered: registered }, started || {});
    }

    const api = {
        install: install,
        registerIpc: registerIpc,
        startup: startup,
        exportDiag: exportDiag,
        openPath: openPath,
        sessionLog: function (level, scope, message, extra) {
            try { sessionLog.log(level, scope, message, extra); } catch (e) { }
        },
        diagLog: function (entry) {
            try { sessionLog.entry(entry); } catch (e) { }
        },
        paths: function () {
            return {
                dataRoot: dataRoot,
                pluginDataDir: pluginDataDir,
                diagDir: diagDir,
                profileDir: profileDir,
                pluginsRoot: pluginsRoot,
                qqDir: qqDir,
                sessionLog: sessionLog.file,
                pluginRoot: D.pluginRoot
            };
        },
        // 单测/排查用
        _internals: {
            D: D,
            pluginVersion: pluginVersion,
            sessionLog: sessionLog,
            normalizePayload: normalizePayload,
            renderReport: renderReport,
            buildErrorsDigest: buildErrorsDigest,
            maskInline: maskInline,
            sanitizeText: sanitizeText,
            deepSanitize: deepSanitize,
            buildZip: buildZip,
            crc32: crc32
        }
    };
    return api;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 八、工具小包装
 * ══════════════════════════════════════════════════════════════════════════ */

function safeCall(fn) {
    try { return fn(); } catch (e) { return null; }
}

module.exports = {
    createDiag: createDiag,
    // 下面这些导出主要给单测/排查用
    sanitizeText: sanitizeText,
    maskInline: maskInline,
    deepSanitize: deepSanitize,
    buildZip: buildZip,
    crc32: crc32,
    dosDateTime: dosDateTime,
    createSessionLog: createSessionLog,
    buildErrorsDigest: buildErrorsDigest,
    SNAP_SCRIPT: SNAP_SCRIPT,
    SNAP_SCRIPT_ASYNC: SNAP_SCRIPT_ASYNC,
    SLUG: SLUG,
    SCHEMA: SCHEMA
};
