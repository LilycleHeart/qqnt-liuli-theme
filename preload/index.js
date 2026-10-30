// 琉璃主题插件 · preload：给界面开主进程接口
// preload 每页可能跑两次，重复 expose 会报错，先查一下
const { contextBridge, ipcRenderer } = require("electron");

const api = {
    selfUid: () => ipcRenderer.invoke("LiteLoader.liuli.selfUid"),
};

const exists = contextBridge.executeInMainWorld({ func: key => key in globalThis, args: ["liuli_api"] });
if (!exists) contextBridge.exposeInMainWorld("liuli_api", api);
