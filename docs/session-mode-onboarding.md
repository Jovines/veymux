# 会话模式引导

普通对话的空白页在示例问题下方提供一行灰色文字「更习惯命令行？切换到终端」。
不增加分隔线或重复解释当前界面，保持标题、描述和示例问题的顺序。它是空态正文，
不按首次使用或引导缓存决定是否展示；已有消息、待发送消息和历史加载状态继续使用原有分支。
输入草稿时保留说明，出现消息后自然退场。导航及分屏标题的切换按钮显示目标名称「终端 / 对话」。

终端没有稳定空态，因此首次进入可使用普通对话的 Agent 会话时，在「对话」入口旁显示可关闭气泡。
只绑定当前活动、已连接、终端就绪的所有者工作区；共享会话不继承所有者引导。
识别沿用 `getChatEligibility`，不修改白名单、不启动 Agent、不写入终端。

气泡通过 portal 挂在 document.body，使用 `z-chrome-hint`，避开 Swiper 和分屏的 stacking context。
优先指向顶部导航入口，顶部入口不可见时指向当前分屏入口；没有可见入口则不曝光。
气泡为不透底的 Flexoki surface，边缘受现有 preview-safe-area 约束，窄屏向内避让。
外层 pointer-events:none，只有小气泡响应点击，无全屏遮罩、焦点移动或滚动锁定。
显示和关闭均不占用终端空间，不改变终端网格，不重新挂载终端或输入节点，也不直接 fit / resize。
用户开始输入、滚动、选择、拖动或进行其他操作时收起；识别请求尚未返回时发生这些操作，
本次也不再补插。软键盘打开、有活动浮层、页面隐藏、断线和普通 Shell 均不自动展示。

## 本机记忆

`veymux:onboarding:terminal-chat-hint` 独立于 Session、目标服务和普通应用版本，
不纳入服务端状态同步。记录首次曝光时间及关闭原因。用户主动选择一个明确命名的模式时，
也记为已了解入口，避免刚从空白页切入终端就再次介绍。
该记录只表示用户见过或主动选择过入口，不表示模式保存成功、消息已读或 Agent 内部状态。
原有切换失败提示与保存流程保持独立。

同源标签页通过 Web Locks 串行认领曝光，storage 事件和页内事件同步收起。
无 Web Locks 时使用同步读取 / 写入尽力去重；无法访问或写入 localStorage 时退化为页面内存，
不阻断终端或切换。网页以浏览器资料和 origin 为存储边界，跨 origin 的桌面 WebView
没有统一存储桥接，因此不承诺整台物理设备或不同浏览器之间只显示一次。

## 验证

行为回归：`sessionModeOnboarding.test.tsx`、`SessionChatView.test.tsx`、
`SessionWorkspace.test.tsx`、`chatModeEntry.test.tsx`。
真实浏览器入口：`npx vitest run --config vitest.session-mode-onboarding.config.ts`，
覆盖 320 / 390 / 1280px、DPR 1 / 2、真实 Swiper 外层、保留的 TerminalView、输入焦点、
草稿与终端连接保留，以及气泡显示 / 收起时终端画布和网格保持不变。

同时运行项目规定的 `test:keyboard-layout`、`test:terminal-geometry` 和
`test:terminal-geometry:browser`。截图与诊断日志保存在 `/tmp`，不纳入仓库。
浏览器验收不能替代真实 macOS / iOS 客户端；本次尚未完成这两类实机验收。
