<div align="center">

# 琉璃 Liuli

**把 DSH 客户端的「琉璃」视觉语言搬到 QQNT 上的主题插件（SnowLora 版）**

[![SnowLora](https://img.shields.io/badge/SnowLora-0.3.0%2B-7c6ce6?style=flat-square)](#)
[![QQ](https://img.shields.io/badge/QQ-9.9.36%20%28Win%29-1d9bf0?style=flat-square)](https://im.qq.com/)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#)

<img src="https://count.getloli.com/get/@qqnt-liuli-theme?theme=gelbooru" alt="访问计数" />

</div>

> LiteLoaderQQNT 版在 [liteloader 分支](https://github.com/LilycleHeart/qqnt-liuli-theme/tree/liteloader)，安装器见 [Releases](https://github.com/LilycleHeart/qqnt-liuli-theme/releases/latest)。

---

> 从壁纸取色，用 Material Color Utilities 派生整套 M3 配色，给 QQNT 换上一层会跟着壁纸呼吸的磨砂玻璃外观。

本仓库的 main 分支是 **SnowLora 版**：由 SnowLora 外部注入，不修改 QQ 安装文件，插件在 QQ 设置 → SnowLora 页管理。

> [!IMPORTANT]
> 只在 **Windows 版 QQ 9.9.36** + **SnowLora 0.3.0 及以上**上开发和测试，其它版本不保证兼容。

## 预览

<div align="center">

<img src="https://raw.githubusercontent.com/LilycleHeart/qqnt-liuli-theme/liteloader/assets/screenshots/chat.jpg" alt="聊天界面实机截图" width="760" />
<br/>
<sub>实机截图（名字、消息、头像为演示内容）</sub>

<br/><br/>

<img src="https://raw.githubusercontent.com/LilycleHeart/qqnt-liuli-theme/liteloader/assets/screenshots/settings.jpg" alt="设置页实机截图" width="560" />

<br/>
<sub>设置页实机截图（LiteLoader 版画面；SnowLora 版面板相同，入口在 QQ 设置 → 琉璃）</sub>

</div>

## 功能

| 功能 | 说明 |
|---|---|
| **动态色板** | 从壁纸取色，用 Material Color Utilities 派生整套 M3 配色，亮/暗跟随 QQ；「配色」里可以指定强调色、选中项、自己和对方的气泡各用哪种角色 |
| **磨砂玻璃** | 会话列表、详情栏、弹层、右键菜单都是壁纸上的半透明材质 |
| **聊天气泡** | TG / 原版 / TIM；原版与 TIM 保留各自气泡形状，颜色角色、不透明度、模糊和阴影跟随主题；TG / TIM 连续消息合并头像，可选头像居上或居下；TIM 可选名称与标签置于气泡内或外；气泡最大宽度 40%–100%，大小独立设置，纯图片消息可隐藏昵称和头衔 |
| **消息文字** | 正文、昵称、头衔字号分别设置；昵称不超过正文大小，长昵称在消息范围内省略 |
| **置顶分组** | 置顶会话合为可折叠的一组，显示数量，支持可选强调色；选中态保留完整圆角 |
| **视频壁纸** | 本地 H.264 MP4 / WebM，静音循环，首帧取色；窗口隐藏时暂停，减少动态效果时显示首帧 |
| **Markdown 行内渲染** | `` `代码` ``、`**粗体**`、`*斜体*`、`~~删除线~~`、`\|\|剧透\|\|`（移植自 BetterQQNT） |
| **@ 高亮** | @我 / @全体成员 暖色淡底，@别人 品牌色 |
| **名字颜色** | 统一用 MCU 派生的第三色（tertiary），和主题同源又一眼可分 |
| **消息入场** | 打开会话时级联浮入，新消息单条浮入（遵守系统「减少动画」） |
| **自定义字体** | 设置页「文字」里填本机已安装的字体名，留空回默认 |
| **布局自定义** | 悬浮标题栏与导航栏仅效率模式生效，经典模式保留 QQ 原生布局；右键菜单可切「只显示图标」并自定义顺序；输入框可选悬浮／原版布局，原版保留 QQ 工具栏、编辑区、发送按钮和高度拖动；悬浮布局可调整按钮数量和顺序；左侧边栏可隐藏分区 |
| **卡片用浏览器打开** | 点 B 站、腾讯文档等「QQ小程序」卡片时不再走 QQ 内置的打开逻辑，改取卡片里的网页链接用默认浏览器打开；同时装了 QQ 增强时也会优先使用琉璃的处理 |
| **设置面板** | 「外观 / 壁纸 / 配色 / 布局 / 文字 / 诊断」六个分区：材质模糊、不透明度、泛光、阴影、亮色与暗色主题遮罩、壁纸与适应模式、布局及字体等 |
| **导出诊断包** | 「诊断」分区把运行环境、主题资源、日志、UI/壁纸状态打成 zip，附带「打开文件夹」和最近错误列表 |

## 安装

### 方式一：琉璃套件版安装器

在本仓库 [v1.3.5+snowlora.2](https://github.com/LilycleHeart/qqnt-liuli-theme/releases/tag/v1.3.5%2Bsnowlora.2) 下载 `SnowLora-Liuli-Installer-2.0.0.exe`，一次装好加载器 SnowLora 和琉璃主题。

### 方式二：从本地安装

在本仓库 [Releases](https://github.com/LilycleHeart/qqnt-liuli-theme/releases) 下载 `qqnt-liuli-theme-<版本>.zip`（SnowLora 版的 release tag 形如 `v1.3.5+snowlora.2`），到 QQ 设置 → SnowLora → 插件管理 → 本地安装，选择 zip 文件。

### 方式三：在线安装

插件索引 [SnowLuma/snowlora-plugins](https://github.com/SnowLuma/snowlora-plugins) 当前未公开。索引公开后，本插件会出现在 SnowLora 设置页的「可安装插件」里，可直接安装或更新。

### 手动放置（开发者）

把本仓库文件复制到 SnowLora 目录下的 `assets/qqnt-liuli-theme/`，确认 `snowlora-plugin.json` 里规则的 `script` 指向 `load.js`，重启 QQ。

## 设置入口

QQ 设置 → **琉璃**。

## 与 LiteLoader 版的差异

- **宿主接口**：读资源、开外部链接、导诊断包走 SnowLora 的宿主通道（`window.LiuliHost`），不再用 LiteLoader 的 preload / `contextBridge`；设置项存在 localStorage。
- **设置面板**：挂在 QQ 设置窗的「琉璃」导航页里，不再使用 LiteLoader 的设置窗口组件；标题栏也不放主题齿轮。
- **多窗口**：`load.js` 在 JS 侧接管窗口选择——主窗、独立聊天窗（`#/chat`）、聊天记录（`#/forward`）、设置（`#/setting`）、图片查看器等都会注入；`#/mini` 等迷你窗不注入。
- **日志与诊断**：SnowLora 没有 LiteLoader 的 `plugin.log` 机制，主进程日志轮转不适用；诊断包由 SnowLora 侧的 `diagnostics.cjs` 生成，格式与 LiteLoader 版 main/diag.js 不同。
- **壁纸比例**：沿用 SnowLora 适配版的 `primeImageRatio` + boot 前解码，未重复移植 LiteLoader 版的对应修复。
- **版本号**：形如 `<LiteLoader 版版本>+snowlora.N`（如 `1.3.5+snowlora.2`），前半段对应 LiteLoader 版的功能基线。

## 目录结构

```
snowlora-plugin.json  插件清单：id、版本、minSnowLora、窗口规则（script 指向 load.js）
load.js               主进程侧：窗口选择、注入时机、按 wc 串行注入、日志
diagnostics.cjs       宿主诊断：收集环境/资源/日志/UI 状态，导出 zip
window-state.cjs      记住 QQ 设置窗的位置
resources.cjs         预读 CSS 与 renderer 脚本，注入时一并交给渲染侧
zip.cjs               诊断包的 zip 打包
renderer/index.js     注入 CSS、路由作用域、动态色板、布局修补、Markdown、@ 高亮、入场、设置面板
renderer/host.js      宿主桥：selfUid / openExternal / diagExport / diagOpenPath
renderer/qq.js        QQ 内核与消息数据访问
renderer/color-roles.js  配色角色（强调色、选中项、气泡等）
renderer/layout-custom.js 布局自定义
renderer/ark-external.js  「QQ小程序」卡片改用外部浏览器打开
renderer/motion.js    消息入场动画
renderer/diag.js      渲染进程诊断：启动标记、错误环形缓冲、壁纸状态
assets/               各层 CSS、MCU（mcu.js）
```

## 诊断包

QQ 设置 → 琉璃 →「诊断」分区：可勾选是否包含聊天窗口截图（默认不勾），点「导出诊断包」，旁边的「打开文件夹」定位到 zip；「最近错误」列表可展开查看本次启动捕获的错误和警告。

包里是运行环境、主题资源、日志、UI 与壁纸状态；不含聊天记录。

## 发布

```bash
node <snowlora-plugins>/tools/pack-plugin.mjs . --repo LilycleHeart/qqnt-liuli-theme
gh release create "v<版本>" --repo LilycleHeart/qqnt-liuli-theme --latest=false "dist/qqnt-liuli-theme-<版本>.zip"
```

`--latest=false` 是必须的：本仓库的 `releases/latest` 留给 **LiteLoader 版的一键安装器**——liteloader 分支 README 里的安装器链接、QQ 增强 README 里的安装说明都依赖它。

发完之后把 `dist/*.index-entry.json` 的内容提 PR 到 [SnowLuma/snowlora-plugins](https://github.com/SnowLuma/snowlora-plugins) 的 `plugins.json`，规范见该仓库的 `docs/`。

## 致谢

感谢 [MliKiowa](https://github.com/MliKiowa) 开发的 [SnowLora](https://github.com/SnowLuma/SnowLora) 加载器，以及 [SnowLuma](https://github.com/SnowLuma) 的维护工作。SnowLora 提供了本项目运行所需的加载与窗口注入能力，是 SnowLora 版的重要基础，采用 MIT 许可。

完整贡献说明见 [贡献者](CONTRIBUTORS.md)。

## 问题反馈

到 [Issues](https://github.com/LilycleHeart/qqnt-liuli-theme/issues) 提。请先确认 QQ 是 9.9.36、SnowLora 是 0.3.0 以上，并附上设置页导出的诊断包（不含聊天内容）。
