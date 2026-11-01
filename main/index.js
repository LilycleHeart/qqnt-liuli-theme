// 琉璃主题插件 · 主进程侧
// 负责：日志、自己的 uid（给 @ 高亮区分 @我 / @别人）、诊断包导出（main/diag.js）。
// 功能性的东西（防撤回、复读、引用不带 @、记住位置）都在 qq-enhance 插件里。
const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, shell } = require("electron");

const SLUG = "liuli-dsh-theme";
const LOG = path.join(LiteLoader.path.data, SLUG, "plugin.log");

function log(message) {
    try {
        fs.mkdirSync(path.dirname(LOG), { recursive: true });
        fs.appendFileSync(LOG, new Date().toISOString() + " " + message + "\n");
    } catch (e) {}
}

log("main loaded | liteloader=" + LiteLoader.versions.liteloader + " qqnt=" + LiteLoader.versions.qqnt);

/* ---------- 诊断（每次启动写 session.log + 注册导出 IPC） ----------
 * 契约见 installer/DIAG-COVERAGE.md 第三 / 3.1 / 3.4 节。
 * 任何一步失败都只记 plugin.log，绝不影响插件原有功能。 */
let diag = null;
try {
    const diagModule = require("./diag.js");
    diag = diagModule.createDiag({ ipcMain: ipcMain, electron: require("electron") });
} catch (e) {
    log("diag create failed: " + (e && e.message));
}

try {
    if (diag) {
        const info = diag.install({ ipcMain: ipcMain });
        log("diag installed | ipc=" + info.ipcRegistered + " session=" + (info.sessionLog || "?"));
    }
} catch (e) {
    log("diag install failed: " + (e && e.message));
    diag = null;
}

/* LiteLoader 在内核报 onSessionInitComplete 时触发 onLogin(uid)。 */
let selfUid = "";
ipcMain.handle("LiteLoader.liuli.selfUid", () => selfUid);

/* 小程序卡片用默认浏览器打开：只放行 http/https */
ipcMain.handle("LiteLoader.liuli.openExternal", async (_e, url) => {
    try {
        const u = new URL(String(url));
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        await shell.openExternal(u.href);
        log("open external " + u.href);
        return true;
    } catch (e) {
        log("open external failed: " + e.message);
        try { if (diag) diag.sessionLog("error", "main", "openExternal 失败：" + e.message, { url: String(url) }); } catch (err) {}
        return false;
    }
});

module.exports = {
    onLogin(uid) {
        selfUid = String(uid || "");
        log("login uid=" + selfUid);
        try { if (diag) diag.sessionLog("info", "main", "登录完成", { uid: selfUid }); } catch (e) {}
    },
};
