# 开发验证

本目录保存 Node 单元测试、独立浏览器验证和历史版本兼容诊断工具。浏览器验证创建隔离页面，不连接正在运行的 QQ。`fixtures/` 只保留脱敏后的原生布局结构；不要提交聊天记录、账号、头像地址、原始 DOM 捕获或诊断截图。

## Node 单元测试

在仓库根目录运行，无需 Playwright，全部用例仅需 Node 内置模块：

```powershell
node --test dev/color-source-and-message-options.test.cjs dev/qq-loaded-message-sequence.test.cjs dev/scroll-time.test.cjs dev/standalone-profile.test.cjs
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

## QQ 实机手动滚动采样

先打开 QQ 的目标会话并启用本机 `ll-cdp`，再从仓库根目录运行 `node dev/qq-scroll-capture.cjs 20`。看到 `Recording now` 后，在 QQ 消息区正常快速上翻；采样到时自动停止，报告保存到 `output/`。脚本不会帮你滚动、修改主题或读取聊天正文。最慢的长帧明细在 `summary.worstLongFrames`；原始输入、滚动事件及直接挂载、移除的消息行数量使用同一时间轴。

`gaps` 记录页面动画回调的间隔，不等于屏幕实际停顿；消息行统计不包含列表内部的复用。长帧明细只覆盖渲染器可归因的部分，不是完整 CPU、GPU 性能跟踪。切到后台会提前停止；无滚动事件、列表断开或日志达到上限的记录不能当作无卡顿的证据。

需要调用栈时，安装支持性能记录的调试桥，并用 `LL_CDP_SCROLL_TRACE=1` 启动 QQ，然后运行 `node dev/qq-scroll-capture.cjs 12 --trace`。报告的 `trace` 部分以同一时钟对齐当前聊天窗口和原生记录，默认汇总最慢的 8 个长帧内采到的函数调用栈和长任务。采样次数不是执行毫秒数，长任务可能嵌套，时长不可相加。原始记录覆盖整个 QQ 进程组，请勿分享或提交。性能采样本身有开销；应与普通模式分开使用。

需要逐条 CSS 选择器统计时，运行 `node dev/qq-scroll-capture.cjs 4 --selectors`，看到采集提示就快速上翻。报告只汇总 QQ 聊天渲染线程的最慢帧间隔，包含样式重算、匹配计时、布局调用栈和样式失效事件；检查 `trace.coverage` 是否有丢失。选择器计时不等于完整的样式或布局耗时，详细录制只用于定位，不用于比较优化前后的帧间隔。

`node dev/qq-scroll-style-ab.cjs --timing-only` 会在当前会话执行交替滚动对照，临时停用主题样式表，最后恢复样式和初始位置。它不会停用主题脚本。运行时不要操作 QQ 或切换窗口。报告里的消息编号只在本轮有效，用于比较经过的消息是否相同。去掉 `--timing-only` 才会录制样式重算明细；如果 trace 有丢块，耗时仅统计保留的事件。停用样式可能改变消息高度和挂载数量，所以结果不能当作同外观优化后的提速。

`node dev/qq-module-ab.cjs` 对照单个主题模块的开关，不改已保存的设置。先在 QQ 主窗口选中目标会话，确保它在侧栏可见。每轮会重载主窗口并重新打开同一会话；结束后再次重载并检查是否恢复。不要在测试期间编辑消息、操作 QQ 或切换窗口。报告仅保留本轮映射的消息序号，不写入聊天正文、会话 ID 或原始消息 ID。只有滚轮输入、视口、位移和两端消息均相近的组才标为可比；模块停用仍可能改变局部外观，不能视为等价优化。

持续高速上翻：先打开目标会话，运行 `node dev/qq-sustained-scroll.cjs 60 capsule-ab`。脚本用相同的滚轮序列交替测试时间胶囊开、关、关、开，全程采样，不保存设置。结束恢复开关和起始滚动位置。报告记录视口及匿名化的历史首尾；历史批次不同时，只用来判断卡顿是否仍然出现，不算同一批消息上的精确差值。

`node dev/qq-sustained-scroll.cjs 60 message-audit` 额外统计消息入屏后的属性写入，不保存属性值。`picture-style` 包括 QQ 自身的图片样式改动；`sameValue` 表示该条变更记录的前后属性值一致，不等于浏览器实际做了一次重排。此模式有额外开销，不用它判定帧率收益。

启动 QQ 前设置 `LL_CDP_SCROLL_TRACE=1`，再运行 `node dev/qq-sustained-scroll.cjs 30 theme profile`，在连续上翻的中段录制并对齐最慢帧。`timing` 分开统计样式计算、布局和主线程绘制；`task` 含渲染工作，不能再相加。有丢块时只解读保留下来的事件；`selectors` 模式若丢失起止标记，不用于帧级归因。原始录制留在本机，不提交、不分享。

固定 QQ `9.9.36-53644` 的渲染入口探针：打开实际显示发送者昵称的群聊，运行 `node dev/qq-sustained-scroll.cjs 10 native-probe`。探针临时统计 QQ 原生方法返回的气泡节点是否已接入页面、昵称和正文是否同时存在，以及挂载后有没有原生昵称。不写安装文件或设置，不保存消息正文、昵称或属性值。未观察到昵称的样本不能验证昵称的挂载时机；探针不用于比较帧率。

同一版本的 `node dev/qq-sustained-scroll.cjs 60 early-sender-ab` 是临时原型对照：只在 TIM「昵称在气泡内」模式下，把昵称布局提前到挂载之前，其他主题功能保持开启。两组都记录挂载时的昵称位置；脚本退出或超时会撤销钩子。只在测试会话中运行，不能当作安装版使用。

`node dev/qq-sustained-scroll.cjs 60 flatten-scope-ab` 临时展开 `@scope`；`node dev/qq-sustained-scroll.cjs 20 narrow-bubble-ab` 仅收窄气泡的部分 `:has()` 查找路径。两种模式都先对比可见消息的计算样式，后一种还在每轮前后检查选择器命中的节点。抽查一致不代表所有消息类型等价。这两项实测均未证实能降低长停顿，不作为安装候选。

原生性能报告的 `styleContexts` 按保留下来的外层事件拆分样式计算耗时，并标出可识别的调用脚本。事件嵌套只说明重算发生在哪个回调内，不说明哪条样式规则触发了重算。缺少外层事件的记录标为 `unattributed`；有丢块的录制也不能用于精确归因。

`node dev/qq-sustained-scroll.cjs 20 sheet-ab geometry` 用临时探针统计高速上翻中段的 4 秒内，聊天列表读取位置、调整位置和测量矩形各花多久。探针不改变参数和返回值，结束后还原；它有额外开销，不用于验收帧率。`omit:layout.css,bubbles.css` 可以一起停用两个主题文件，找出需要继续排查的范围。报告中 `valid` 只代表本轮采样有效；`comparisons` 另查两轮视口、历史首尾和经过的消息是否相同，不可比的轮次不能当作等外观提速。

## 历史基线与兼容诊断

部分脚本比较某次修复前后的表现，必须提供那次验证保存的 before 文件；它们不是在任意新克隆上直接运行的统一测试套件。例如：

- `message-spacing-browser.cjs` 需要原 `bubbles.css`，`self-link-emphasis-browser.cjs` 需要原 `color-roles.js`。
- `same-name-switch-compat-browser.cjs`、`scroll-row-entry-browser.cjs`、`pin-measurement-browser.cjs`、`tim-layout-options-browser.cjs` 使用相应历史 renderer 基线；第四个位置参数可覆盖默认路径。
- `tim-group-stability-browser.cjs` 还使用第五个位置参数指定旧版 index，并依赖对应历史 patch 源文件。
- `background-performance-batching-browser.cjs`、`message-color-idle-browser.cjs`、`scroll-geometry-compat-browser.cjs`、`scroll-time-io-visibility-browser.cjs`、`scroll-time-perf-browser.cjs` 读取脚本中标注的 `../../output/playwright/` 历史证据路径。

运行前检查脚本顶部的读取路径和额外参数。缺少对应证据时，不运行该历史比较；不要为补齐路径把原始聊天捕获、完整 output 目录或私人环境文件带入仓库。`ark-card-roles-browser.cjs` 的 before 比较可选；`forward-card-roles-browser.cjs` 的默认验证完全使用已提交的脱敏夹具。

`patch-*-live.cjs` 是开发用兼容脚本生成器；直接运行通常只在指定位置输出 JavaScript，`require()` 可取得生成函数。它们不会自动连接 QQ 或部署。`patch-layout-live.js` 是供显式注入时执行的浏览器桥接源码。只有手动把这些生成结果注入页面才会安装兼容处理；正常窗口加载使用生产 renderer，无需部署这些工具。
