# 琉璃 — QQNT 主题插件（LiteLoaderQQNT）

把 [dsh-liuli-ui-enhance](https://github.com/LilycleHeart/dsh-liuli-ui-enhance)（DSH 客户端的琉璃 UI）的设计语言搬到 QQNT 上，做成标准 LiteLoaderQQNT 插件。不依赖 BetterQQNT。

功能性的改动（防撤回、复读、引用不带 @、记住浏览位置）在姊妹插件 [qqnt-enhance](https://github.com/LilycleHeart/qqnt-enhance) 里。

## 功能

- **动态色板**：从壁纸取色，用 Material Color Utilities 派生整套 M3 配色，亮/暗跟随 QQ
- **磨砂玻璃**：会话列表、详情栏、弹层、右键菜单都是壁纸上的半透明材质
- **TG 式布局**：连续消息合并、名字进气泡、单行输入栏、指向唤出的顶部胶囊
- **Markdown 行内渲染**（移植自 BetterQQNT）：`` `代码` ``、`**粗体**`、`*斜体*`、`~~删除线~~`、`||剧透||`
- **@ 高亮**：@我 / @全体成员 暖色淡底，@别人 品牌色
- **名字颜色**：统一用 MCU 派生的第三色（tertiary）
- **消息入场**：打开会话时级联浮入，新消息单条浮入（遵守系统「减少动画」）
- **自定义字体**：设置页里选本机已安装的字体
- **设置页**：QQ 设置左栏「琉璃」：材质模糊/透明度/泛光/阴影/壁纸压暗、自定义壁纸、明暗模式、Markdown 开关、字体

## 安装

1. 按 [LiteLoaderQQNT 官方文档](https://liteloaderqqnt.github.io/guide/install.html) 装好 LiteLoaderQQNT
2. 把本仓库放到 `LiteLoaderQQNT\plugins\liuli-dsh-theme\`
3. 重启 QQ

在 QQ 9.9.36（Windows，Electron 40）上测试。LiteLoaderQQNT 1.4.1 在这个版本上需要把 `src/main/store.js` 里的 `dirent.path` 改成 `LiteLoader.path.plugins`（Electron 40 去掉了 `fs.Dirent.path`）。

## 结构

```
manifest.json
main/index.js        主进程：日志、自己的 uid（给 @ 高亮用）
preload/index.js     暴露 selfUid 给界面
renderer/index.js    注入 CSS、路由作用域、动态色板、布局修补、Markdown、@ 高亮、入场动画、设置页
assets/              各层 CSS、MCU（mcu.js）、图标
```

## 踩过的坑（改之前必看）

1. **`data-hash` / `data-liuli-scope` 必须自己同步**。主题规则挂在 `body[data-hash^="#/main"]` 和 `body[data-liuli-scope="main"]` 下。QQ 9.9.36 的 vue-router 不派发 hashchange，要用定时器轮询兜底（400ms）。
2. **`--ll-*` 令牌必须齐**。缺一个可能让整条声明作废：`--ll-scrim` 缺失时 `rgba(var(--ll-scrim), …)` 解析失败，壁纸静默消失。
3. **CSS 里不能用 `url("local://…")`**，`background-image` 会被 CSP 挡掉。壁纸必须 base64 内联。
4. **`#app::before` 承载壁纸**，不能放 body：`#app` 有 `overflow:hidden`，`.global-container` 是 `position:fixed; z-index:1`。
5. **右键菜单不能挂 backdrop-filter / transform**：「输入"/"时唤起」的子菜单是嵌在父菜单里的 `position:fixed`，父级一旦成为定位参照，子菜单就错位。模糊放在 `::before` 上。
6. **不要盖全屏噪点层、不要给气泡文字加阴影**：两者都会让字发虚。半透明层上的字只能用灰度抗锯齿，本来就比 ClearType 软。
7. **滚动时不要读 `innerText`**：会强制排版。DOM 观察回调要合并（150ms），只读 `textContent`。
8. **消息数据**：`.message` 元素上的 `__VUE__[0].props.msgRecord`。

## 壁纸

插件不带默认壁纸。装好后在设置页「琉璃」里选一张图，主题色会从这张图取。

也可以放一张本地默认壁纸（不会被提交）：
- `assets/wallpaper.jpg`：取色用
- `assets/wallpaper.css`：内联成 base64 的 `#app::before` 背景（CSS 里不能用 `local://`，见坑 3）

没有壁纸时取色回退到 `#1d9bf0`。

## 待办

- 亮色模式尚未完整实测
- BetterQQNT 里「单条消息右键禁用 Markdown」未移植
