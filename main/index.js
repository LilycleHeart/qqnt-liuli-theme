// 琉璃主题插件 · 主进程侧
// 负责：日志、自己的 uid（给 @ 高亮区分 @我 / @别人）。
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
    } catch (e) { log("open external failed: " + e.message); return false; }
});

module.exports = {
    onLogin(uid) {
        selfUid = String(uid || "");
        log("login uid=" + selfUid);
    },
};
