# 开发验证

本目录保存 Node 单元测试、独立浏览器验证和历史版本兼容诊断工具。浏览器验证创建隔离页面，不连接正在运行的 QQ。`fixtures/` 只保留脱敏后的原生布局结构；不要提交聊天记录、账号、头像地址、原始 DOM 捕获或诊断截图。

## Node 单元测试

在仓库根目录运行，无需 Playwright。`message-overscan.test.cjs` 需要 Vue 3.5 的 `@vue/reactivity`，其余用例仅需 Node 内置模块。下面的命令假设该依赖可被 Node 解析：

```powershell
node --test dev/color-source-and-message-options.test.cjs dev/message-overscan.test.cjs dev/qq-loaded-message-sequence.test.cjs dev/scroll-time.test.cjs dev/standalone-profile.test.cjs
```

若 Vue 安装在独立目录，可单独传入模块路径：

```powershell
node dev/message-overscan.test.cjs '<依赖目录>/node_modules/@vue/reactivity'
```

## 浏览器验证

安装或提供可被 Node 解析的 `playwright`，并准备它的 Chromium，或传入已安装的 Chromium / Edge 可执行文件。`*-browser.cjs` 常用的位置参数如下，具体以脚本顶部为准：

| 位置 | Node 中的位置 | 含义 |
| --- | --- | --- |
| 1 | `process.argv[2]` | Playwright 模块名或绝对路径，默认 `playwright` |
| 2 | `process.argv[3]` | 浏览器可执行文件路径；多数脚本留空时使用 Playwright 的 Chromium |
| 3 | `process.argv[4]` | 输出目录，用于报告和截图；默认位于仓库外的 `../../output/playwright/` |
| 4 | `process.argv[5]` | 可选或必需的历史 before 基线路径，含义由脚本定义 |

例如，仅使用已提交的脱敏夹具验证转发卡片：

```powershell
node dev/forward-card-roles-browser.cjs playwright 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' ./out/forward-cards
```

`image-max-width-browser.cjs` 使用脱敏图片检查最大宽度设置：低于上限时实际图片像素保持一致，超过上限时预览框等比缩小并保留 QQ 原生填充方式；覆盖 TG/TIM/原版、自发与他发消息及文本换行。可按上述三个位置参数指定模块、浏览器和输出目录，第四个参数可选传入历史 `bubbles.css` 验证失败基线。

`message-spacing-browser.cjs`、`same-name-switch-browser.cjs`、`same-name-switch-compat-browser.cjs` 和 `self-link-emphasis-browser.cjs` 支持 `LIULI_PLAYWRIGHT_PATH` 环境变量；显式位置参数优先。除兼容脚本 `same-name-switch-compat-browser.cjs` 外，这组脚本还支持 `LIULI_BROWSER_PATH`，未指定浏览器时保留 Windows Edge 默认路径。其他脚本应通过位置参数传值。

## 历史基线与兼容诊断

部分脚本比较某次修复前后的表现，必须提供那次验证保存的 before 文件；它们不是在任意新克隆上直接运行的统一测试套件。例如：

- `message-spacing-browser.cjs` 需要原 `bubbles.css`，`self-link-emphasis-browser.cjs` 需要原 `color-roles.js`。
- `same-name-switch-compat-browser.cjs`、`scroll-row-entry-browser.cjs`、`pin-measurement-browser.cjs`、`tim-layout-options-browser.cjs` 使用相应历史 renderer 基线；第四个位置参数可覆盖默认路径。
- `tim-group-stability-browser.cjs` 还使用第五个位置参数指定旧版 index，并依赖对应历史 patch 源文件。
- `background-performance-batching-browser.cjs`、`message-color-idle-browser.cjs`、`scroll-geometry-compat-browser.cjs`、`scroll-time-io-visibility-browser.cjs`、`scroll-time-perf-browser.cjs` 读取脚本中标注的 `../../output/playwright/` 历史证据路径。

运行前检查脚本顶部的读取路径和额外参数。缺少对应证据时，不运行该历史比较；不要为补齐路径把原始聊天捕获、完整 output 目录或私人环境文件带入仓库。`ark-card-roles-browser.cjs` 的 before 比较可选；`forward-card-roles-browser.cjs` 的默认验证完全使用已提交的脱敏夹具。

`patch-*-live.cjs` 是开发用兼容脚本生成器；直接运行通常只在指定位置输出 JavaScript，`require()` 可取得生成函数。它们不会自动连接 QQ 或部署。`patch-layout-live.js` 是供显式注入时执行的浏览器桥接源码。只有手动把这些生成结果注入页面才会安装兼容处理；正常窗口加载使用生产 renderer，无需部署这些工具。
