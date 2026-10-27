# macOS 终端输入法与焦点

用户报告：在 macOS 27 的最新客户端中，启动后可使用系统拼音，使用一段时间后输入源停留在 ABC，无法切回拼音；客户端所有输入框一起失效，重启客户端恢复。另一位用户未遇到。该现象尚未在 macOS 实机复现，不能把浏览器组合输入成功当成问题已解决。

所有输入框一起失效提示需要检查原生输入上下文，而不只是终端组合事件。[WebKit 的 `WebViewImpl::updateSecureInputState`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/mac/WebViewImpl.mm) 中，同一个 WKView 的编辑区共享输入上下文；密码字段通过 `setAllowedInputSourceLocales` 限制输入源，普通字段应清除此限制。它提供了可检查的机制，并不能证明本次故障就是密码状态残留。还需区分输入源限制、Secure Input 与原生焦点状态。

## 已确认的焦点缺陷与修改

桌面终端使用自有 textarea 接收输入。xterm 的 helper textarea 原本只读，但仍可被其鼠标处理器聚焦；旧 focus 监听器再把焦点转回真实输入框。这次往返会触发真实 blur，取消正在进行的组合输入。mousedown 的 rAF 与 mouseup 的 timer 还会再次请求聚焦。

现在仅将 xterm helper 标记为 inert，使其无法获得原生焦点。画布仍接收选区、鼠标协议与滚轮事件；容器在 mousedown capture 阶段直接聚焦真实输入框，覆盖 xterm 强制选区会停止冒泡的路径。已聚焦时保持当前节点，移除延迟聚焦；终端内浮层控件沿用自身焦点行为。移动端保留原有输入路径。

## 自动化证据

`src/lib/components/terminal/desktopTerminalInput.browser.tsx` 使用真实 xterm、Swiper、浏览器鼠标事件与 CDP 组合输入。旧实现连续点击 5 次产生 5 次 helper 的真实 focus 事件；修改后组合输入期间点击不再触发真实输入框 blur。覆盖中文提交、右键、拖选复制、SGR 滚轮、普通搜索框往返与再次组合输入。该回归包含在 `npm run test:keyboard-layout`。

## 全面焦点排查（2026-10-24）

范围包含前端的 `.focus()` / `.blur()`、自动聚焦、定时器与微任务恢复、保留的隐藏工作区、弹层键盘所有权，以及 Rust/WKWebView 和旧 Electron 的窗口聚焦入口。确认存在多个独立竞争点，旧实现已用回归测试复现；这些证据证明焦点管理有缺陷，尚不能证明 macOS 输入源被永久限制为 ABC 的直接原因。

| 位置 | 已确认的问题 | 调整 |
| --- | --- | --- |
| `TerminalView` | 每个终端监听全局 pointerup，连普通按钮也会被延迟收回焦点；窗口恢复重复 focus，窗口失焦后计时器仍执行 | 删除全局 pointerup 恢复；窗口恢复只在前台可见且没有其他控件拥有焦点时执行，已聚焦只刷新渲染，失焦取消计时器 |
| `useViewportHeight` | 页面隐藏/pagehide 时主动 blur 任意编辑框，覆盖桌面与移动端所有输入 | 仅重置键盘布局状态，不结束编辑会话 |
| `TerminalViewport` | 异步初始化与会话重置重复 autofocus；`inputActive` 未参与控制器聚焦判断 | 初始聚焦只保留一个入口，拒绝覆盖已有编辑器；所有显式输入入口检查可见性、工作区与输入资格 |
| `useKeyboardLayer` | 隐藏/inert 的保留弹层仍抢焦点；下层 React 弹层抢走原生桥接确认框焦点；关闭微任务覆盖新控件 | 按实际可见性选择最上层；桥接确认优先；恢复前检查新所有者、宿主可用性与窗口前台状态；兼容 DOM 先移除再清理的条件弹层 |
| `App` / `MultiTerminalView` | 关闭覆盖层后的全局广播、会话加载后的延迟切换不检查新的用户操作 | 执行时重新检查键盘所有者、工作区与窗口状态；切换请求检查导航版本和原焦点 |
| 多个侧栏/预览弹窗 | 清理回调无条件聚焦旧节点 | 统一使用 `focusOwnership.ts`，检查连接状态、隐藏/inert 祖先（含同源 frame）、新控件所有权，避免重复 focus |
| Rust 客户端注入的 `bridge.js` 确认框 | 授权过期或安全上下文变更仍聚焦之前的密码框；清理、首次绘制覆盖新的焦点选择 | 上下文失效关闭不恢复；普通关闭仅在确认框仍拥有焦点时恢复；首次绘制保留用户已选的按钮；组合输入中不处理 Escape |

原生 Rust 的 `WindowEvent::Focused(true)` 只更新状态，没有发现“收到 focus → 再 set_focus”的反馈环。发现的窗口 `set_focus` 用于启动展示、显式服务切换、菜单与通知操作；启动恢复多个窗口仍会依次展示，属于启动路径，不足以解释运行一段时间后所有输入框锁定。旧 Electron 的窗口事件以恢复检查为主，没有找到对应循环。未找到主动强制 ABC 或自定义切换 Secure Input 的实现。

保留用户主动点击、Tab 导航、打开弹层、菜单命令与终端显式输入操作需要的聚焦；保留原生 iOS 对同一真实输入节点同步请求 focus 的路径，没有用统一去重破坏软键盘唤起。

验证包含 `test:keyboard-layout`（实际 TerminalView、xterm、Swiper、弹层、搜索框、隐藏保留层及 CDP 组合输入）、终端尺寸两组检查、焦点所有权单元测试、受影响侧栏/弹层回归和原生桥接 Node 测试。CDP 中文组合输入只验证 DOM 编辑与焦点事件，不能验证 macOS 输入菜单、系统拼音候选窗或 WKWebView 原生输入上下文。

本轮 `npm run build`、键盘专项（60 个单元检查、54 个浏览器检查）、终端尺寸检查（189 个单元检查、6 个浏览器/集成检查）、原生桥接 65 个检查通过。扩大检查中，`MultiTerminalView.test.tsx` 的分屏标题栏固定状态断言仍失败；`npm run lint` 报告 `toolbarCustomization.browser.tsx` 使用了未声明的 `BrowserCommands.toolbarActionDrag`。这些是并行工作区中本轮焦点 hunk 之外的问题，未在本轮修改。

## 尚需 macOS 实机验收

在用户实际使用的签名客户端与 macOS 版本中，用系统拼音反复切换输入源、点击和拖选终端、打开右键菜单、切换会话/分屏、切换应用、最小化后返回，并长时间使用。确认菜单栏输入源能切换到拼音，候选窗出现且候选字只提交一次。

若再次锁定 ABC，在重启前记录客户端及 macOS 的精确版本，并比较当前终端、客户端普通搜索框、其他原生应用的输入源切换结果；检查当前 DOM 聚焦节点及其 readonly/inert/inputMode、原生输入上下文的 allowedInputSourceLocales，以及系统 Secure Input 的持有进程。不要通过自动强切系统输入源、周期性 blur/focus 或刷新整个客户端掩盖故障。

本次远程只读检查可连接的 Mac 为 macOS 27.2，但处于锁屏状态（`CGSSessionScreenIsLocked=Yes`），Secure Input 持有者是 loginwindow；这不是反馈用户的故障现场，不能当作 Veymux 导致安全输入残留的证据。未替换安装包或验收签名客户端的新行为。

## 部分会话中文候选组词卡顿（2026-10-25）

用户补充：macOS 客户端在部分会话输入拼音、选择候选时变慢，切换其他会话恢复。未取得故障会话的 macOS 性能记录，尚不能确认具体根因。

代码与真实 xterm/Swiper 浏览器回归确认：桌面终端在光标变化、重绘和尺寸变化时同步测量候选窗位置，即使焦点已移至其他输入框也继续测量。8 次输出更新的回归场景触发 27 次 `.xterm-screen.getBoundingClientRect()`；修改后该场景为 0 次。现在输出引起的候选窗位置更新按动画帧合并，仅在真实输入框聚焦、页面可见且允许输入时执行；初始化、聚焦和开始组词仍同步测量，终端销毁时取消待执行的帧。

原实现已经在组词期间冻结锚点，因此以上证据只能确认输出路径有额外布局开销，不能据此宣称已复现或解决 macOS 原生拼音候选窗卡顿。浏览器回归另覆盖持续输出中的锚点冻结、焦点保持、组词期间不发送文字，以及中文提交恰好一次。输入框在回车、控制序列与会话重置时清空，没有发现跨命令持续累积历史输入的路径。

验证：`npm run test:keyboard-layout`、`npm run test:terminal-geometry` 和 `npm run test:terminal-geometry:browser` 均通过。macOS 原生输入法实际延迟仍待实机对照验收。
