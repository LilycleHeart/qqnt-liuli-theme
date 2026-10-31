// 琉璃 · 小程序分享卡片用默认浏览器打开
// 装了 LiteLoader 后 QQ 文件被改过，点 B 站、腾讯文档等「QQ小程序」卡片会弹「文件已损坏，请重新安装QQ」。
// 这里截下点击，从卡片数据里取网页链接交给默认浏览器。
// 和 QQ 增强不冲突：页面里有 QQ 增强（window.qq_enhance）时，琉璃什么都不做，交给 QQ 增强（它有自己的开关）。

function recordOf(el) {
    try {
        const m = el && el.closest && el.closest(".message");
        const inst = m && m.__VUE__ && m.__VUE__[0];
        return (inst && inst.props && inst.props.msgRecord) || null;
    } catch (e) { return null; }
}

function fixUrl(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (!/^[a-z]+:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
    return /^https?:\/\//i.test(u) ? u : "";
}

function arkUrl(rec) {
    const el = rec && Array.isArray(rec.elements) && rec.elements.find(x => x && x.arkElement);
    if (!el) return "";
    let data;
    try { data = JSON.parse(el.arkElement.bytesData); } catch (e) { return ""; }
    for (const v of Object.values((data && data.meta) || {})) {
        if (!v || typeof v !== "object") continue;
        const u = fixUrl(v.qqdocurl) || fixUrl(v.jumpUrl) || fixUrl(v.url);
        if (u) return u;
    }
    return "";
}

export function installArkExternal(api) {
    if (window.__liuliArkExternal || !api || typeof api.openExternal !== "function") return;
    window.__liuliArkExternal = true;
    const target = e => {
        if (window.qq_enhance || e.button !== 0) return "";
        const card = e.target && e.target.closest && e.target.closest(".ark-msg-content-container .ark-item-container");
        return card ? arkUrl(recordOf(card)) : "";
    };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"].forEach(type =>
        document.addEventListener(type, e => {
            const url = target(e);
            if (!url) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (type === "click") api.openExternal(url).catch(() => {});
        }, true));
}
