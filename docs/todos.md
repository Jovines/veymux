# Todo 清单

侧栏「待办」提供独立于终端与协作组的清单。待办可以手动添加、由外部程序注入，或由多个自定义收集 Agent 写入。数据保存于服务所在用户的 `~/.termdock/todos.json`，包含收集方向、执行默认值和每轮终端/结果记录。

手机或桌面侧栏收起时，终端顶部右侧以轻量文字显示「待办＋未完成数量」，不使用独立灰色卡片或重复图标，不需要先打开会话侧栏；会话标签横向滚动时，该入口仍留在顶部。待办页左上角「终端」直接回到当前终端，重新进入时保留筛选、选择与页面会话中的草稿。桌面侧栏固定展开时只显示侧栏入口，隐藏顶部入口，避免重复。

## 使用

主流程是「收集待办 → 交给会话」，后续直接在会话中处理。

- 清单默认按「待完成／已完成」展示：宽屏并排两列，窄屏使用同名页签。顶部「管理」打开收集方向管理页面，不直接启动任务；可按方向收集、编辑、确认删除或新增方向。「＋」手动添加待办；搜索、来源筛选、已忽略和多选放在菜单中。
- 不再显示独立详情栏或手机详情页。描述直接显示在卡片内，点标题可就地展开完整内容及此前记录，其他待办仍留在清单中；完成／重新打开、编辑、交给会话均在卡片上操作，忽略和再次交接放在该卡片的更多菜单里。
- 点击卡片的「交给会话」后，左侧现有 Agent 会话显示发送入口，保留原有目录、工作组和分屏分组。仅把「取消」「新建会话」放在对应待办卡片下方；不增加会话下拉框。选择目标后仍弹出原确认面板，补充信息可留空，「更换」返回侧栏选择并保留草稿。
- 桌面可将未完成待办拖到侧栏的 Agent 会话，悬停时高亮目标；松手后先打开确认框，补充信息可留空，确认后才发送。取消不交接；已完成、正在发送的待办及其他服务的拖拽数据不会触发交接。
- 已有会话复用正在运行的 Agent；普通 Shell 不作为直接接收待办的目标。新建默认沿用已记住的 Agent、命令方案及来源项目目录，配置摘要可展开修改，目录支持快捷选择。无需再次填写处理提示词或保存执行设置。
- 多选后一次交给同一个会话，多条待办合成一条消息，共用补充要求；不会按事项分别新建多个会话。成功交接后卡片显示「已交给 ××」及「去会话」，可从卡片菜单再次交给其他会话。
- 交接只记录实际发送、接收会话和补充原文，不推断 Agent 采用、已读或完成状态。处理过程和后续沟通在 Session 中继续；无需 Agent 回传专门报告或用户确认验收。勾掉待办会移入已完成，短暂支持撤销；已完成卡片可重新打开。旧版报告仍可在卡片内的「此前的处理记录」中查看。
- 会话名称与可用性沿用共享会话目录。取消、响应式布局切换、进出终端会保留本页面内未发送草稿；页面刷新不保证保留草稿，最近目标与命令方案在当前浏览器保留。原目标已关闭时可直接重新选择。
- 不确定的网络结果重试沿用原请求标识，不重复创建或发送；服务重启不会自动重放未确认的交接。明确发送失败保留内容供用户检查后重试。
- 收集支持多个方向、外部注入及手动、间隔或每日计划。方向中的提示词、Agent 和目录只需配置一次，之后从管理页面按方向触发收集，计划在服务端执行，不依赖页面在线。收集方向的历史记录按需展开。
- 新会话、待办与收集配置共享当前浏览器中的命令方案，每个 Agent 可命名保存多套命令。已有方向和历史记录保留其所保存的命令，不随共享方案改名或编辑而改变。

收集与执行采用系统已安装的 Agent CLI，继承各自的登录、工作区信任和权限配置。首次启动出现 Agent 自身的授权问题时，在「打开终端」处理。应用不接管各家 Agent 的模型循环。

## 外部写入

在会话内容、侧栏会话或会话标签上右键，选择「插入待办提示」，会在对应会话的输入光标处插入一句话：

> 【待办用法：`td todo --help`】

使用「【待办用法：…】」标明附加指引的边界。仅插入，不自动发送或回车；原有文字保留，光标停在提示词后，可以作为前缀、中缀，继续补充自己的要求。这是通用能力介绍，不限定添加单条待办，也不预设收集方向。例如聊到一个值得关注的渠道后，插入指引，再补充「把刚才这个渠道设为每个工作日早上九点收集的方向」。Agent 可按对话上下文直接创建方向，无需回到表单逐项填写。选中文字时保留原生复制菜单。

别人分享的会话按[共享功能白名单](shared-session-capabilities.md)开放，写入权限不会自动获得本机待办提示、再次分享或会话管理操作；共享内容不弹出应用右键菜单，选中文字仍可复制。

在服务所在机器、同一系统用户下：

```sh
td todo add --title '检查项目依赖' \
  --description '核实升级影响，整理处理建议' \
  --source '项目巡检' --external-id 'deps-review'
td todo list
td todo complete <todo-id>
td todo reopen <todo-id>
td todo ignore <todo-id>
td todo agents
td todo collector list
td todo collector create --name '社区渠道' --agent codex \
  --cwd /path/to/project --at 09:00 --weekdays 1,2,3,4,5 \
  --file /path/to/collection-requirements.txt
```

创建方向前先查看现有方向和可用 Agent，避免重复配置。收集要求可通过 `--prompt`、`--file` 或 `--stdin` 传入，记录来源渠道、访问方式、筛选标准和必要背景；每轮只收集可执行待办、不执行。省略 `--command` 时使用所选 Agent 的启动命令，省略 `--cwd` 时使用 CLI 当前目录。频率支持 `--every <分钟>`、`--at HH:MM` 或 `--at 09:00,14:00,20:00`（服务端时区），不指定则为手动；用户未要求频率时保留手动。`--disabled` 保存停用方向。创建只保存配置，不立即启动收集；计划运行不依赖网页在线。

收集方向的「定时与启用」支持手动、按间隔和定时。定时可增删多个时间点，重复日期可快捷选每天、工作日、周末，或逐一选择星期；折叠摘要与方向卡片使用同一规则展示全部安排。时间保存时排序、去重，同一时间只运行一次；至少保留一个有效时间和一个重复日期。旧单时间配置及未提交草稿兼容保留。

计划持久化继续使用 `kind: 'daily'`：`time` 保留首个时间，多时间另带 `times: ['09:00', '14:00', '20:00']`，`weekdays` 为重复日期。调度会寻找当天尚未经过的时间，再跳到下一个选中日期。`td todo collector create --at` 支持逗号分隔多个时间；JSON save 与页面使用相同服务端校验。

多时间验收：`npx vitest run --config vitest.collector-schedule.config.ts` 覆盖 320、390、1280 宽度的真实组件浏览器，验证增删、日期组合、空值拦截、重复时间、草稿恢复、再次编辑、切换间隔/手动、底部操作可见和无横向溢出；调度与 store 回归覆盖同日多次触发、跳过未选日期、跨周、重复 tick、停用和重启持久化。浏览器保存回调与模型启动使用隔离数据/替身，未创建正式任务，未做真实 iOS/macOS 客户端验收。

`--description` 可换为 `--file <UTF-8 文件>` 或 `--stdin`；来源链接用 `--url https://...`。
关联方向时，同一 `collectorId + externalId` 返回已有记录；未关联方向时使用 `source + externalId`，均不覆盖用户编辑、完成状态或重新打开条目。`--idempotency-key` 用于请求重试；同一 key 携带不同内容返回冲突。不同方向相似内容不会自动合并。
收集 Agent 还可附 `--collector <collector-id>`，应用会在收集任务的提示词中附上正确用法。删除方向后已经启动的收集 Agent 仍可完成写入，原待办与历史保留。

每轮执行的提示词附带对应 run ID。提交结果：

```sh
td todo report <run-id> --status complete --file /path/to/result.txt
# status 还可以是 blocked 或 failed；不会自动完成 Todo
```

报告绑定具体 run，迟到的旧结果不会覆盖新一轮。一个 run 的报告重复提交相同内容可重试；不同内容须新开一轮。`td todo --help` 不依赖运行中的服务。

## 每日 TODO 分类与更新

待办支持 `category`：`short`（短期）、`long`（长期）、`delegated`（我分配出去、待跟进）、`uncategorized`（未分类）。未带分类的老数据继续读取为未分类，无需迁移或根据标题猜测。待完成、已完成及已忽略列表分别按分类分组，空组显示「暂无」；新增和编辑可直接选择分类、修改来源链接。

```sh
td todo add --title '合入 alpha 并通知相关人' --category short \
  --collector <collector-id> --external-id 'stable-issue-id'
td todo list --collector <collector-id> --category short
td todo update <todo-id> --collector <collector-id> --description '两个缺陷已解决，仍待合入和通知' \
  --category delegated --revision 1
```

`update` 只修改提供的字段，支持 `--title`、`--description`（或 `--file` / `--stdin`）、`--category`、`--url` 和 `--external-id`；原 ID、创建时间、来源、状态及历史保留，递增 `revision` 并更新 `updatedAt`。`--description=`、`--url=`、`--external-id=` 清空对应字段；`--category uncategorized` 归回未分类。修改外部标识时，同一 collector（未关联 collector 时为同一 source）内不能与其他待办冲突；跨来源可重复。

Collector 应传入上次读取的 `--revision`；过期更新以退出码 1 拒绝，JSON 带 `currentRevision`，API 返回 HTTP 409。先重新读取并核对新进展，再决定更新，不能自动重试覆盖。不传 `--revision` 的手动编辑会先读取当前 revision，再做条件写入，仍能拦截读取后发生的竞争。界面冲突保留草稿，也提供「放弃修改并重新载入」。

重复 `add` 继续按 collector/source + externalId 返回原条目，不覆盖描述、分类或状态；显式 `update` 才修改，不增加隐式 upsert。完成、忽略、重新打开均保留分类与来源。收集提示词包含这些规则，`processing.mode=manual` 继续只存入清单。

工作日 12:00、16:00、20:00、23:00 的收集计划可用 `--at 12:00,16:00,20:00,23:00 --weekdays 1,2,3,4,5` 或 collector JSON 配置；11:00 汇总提醒可使用独立 `td automation`。本次增加原生待办能力，不创建真实文档服务收集方向或定时提醒。

## Collector 命名空间与所有权

`collectorId` 是不可变归属；collector 名称及卡片标签可重命名，筛选仍使用稳定 ID。`externalId` 的唯一范围为 `(collectorId, externalId)`；无 collector 的人工条目沿用 `(source, externalId)`。更新中的 `collectorId` 是归属前置条件，不会移动条目；`source` / `sourceId` 不能通过更新改写。

```sh
td todo update <todo-id> --collector <collector-id> --revision <n> --category long
td todo complete <todo-id> --collector <collector-id> --revision <n>
td todo ignore <todo-id> --collector <collector-id> --revision <n>
td todo reopen <todo-id> --collector <collector-id> --revision <n>
```

CLI 自动附带实际执行位置（backend session / tmux session）。服务端用现有会话绑定解析稳定 session ID，再从持久化的收集 run 确定 collector，不能用命令里指定的 ID 改变执行身份。TD 发起的 collector 会话执行 add/update/complete/ignore/reopen 时，必须显式提供匹配的 `--collector`；漏传返回 `TODO_COLLECTOR_REQUIRED`，指定别的 collector 或操作其他归属的 todo-id 返回 HTTP 403 / `TODO_OWNERSHIP_MISMATCH`，错误正文包含 `ownership mismatch`。归属检查先于 revision 检查，被拒条目的数据和版本不变。

Collector 的 list/sources/summary 由服务端收窄到自己的命名空间（包括 todos、collectors、runs 和计数），传入其他 collector 的查询会被拒绝。`GET /?collectorId=<id>` 支持人工按稳定 ID 筛选。跨来源的批量交接记录不出现在单来源快照中。收集 Agent 只能报告本 collector 的收集 run，不能用 claim、handoff、收集配置编辑或其他操作绕过门禁。namespace 绑定在该稳定会话生命周期内保留，后续交接不会把 collector 自动提升为管理员；不同 collector 不能复用同一个已绑定收集会话，应使用独立会话。

新版人工 CLI 在非 collector 会话内仍可操作清单；界面仍是用户管理入口，更新时携带条目 collectorId 做归属校验。旧 CLI / 旧本机 token 调用缺少执行上下文时，读取保留兼容，写入返回 `TODO_CALLER_CONTEXT_REQUIRED` 并要求升级，避免自动收集静默落入默认来源。收到无法解析的 Termdock 会话上下文时拒绝执行，不回退为人工身份。

这是 TD 登记收集会话的服务端权限边界。本机系统用户及其管理 token 仍拥有用户管理权限；它不构成同一系统用户下可任意读取状态文件、伪造执行环境或直接改写数据的恶意进程沙箱。

add/update（包括完成、忽略、重开）保留原有 `{todo}` 响应，并增加顶层 `collectorId`、`todoId`、`revision` 供审计。UI 始终显示来源标签，按来源筛选优先使用 collector ID；同名方向仍可分别筛选，改名后标签跟随显示。

## 可恢复的收集轮次（1.4.386）

本节只增加三个有限能力：持久 checkpoint、不可变触发上下文、全周期单飞与显式恢复。它不提供 FIFO、来源适配器平台、全局 exactly-once 或多次 Agent 工具调用事务。已有 Todo 数据仍为 version=1，不迁移；旧轮次没有 cursor 就保持没有，不猜测历史扫描进度。

### 读取与成功提交 checkpoint

checkpoint 以 `collectorId + sourceKey` 隔离。每项保存 `revision`、opaque JSON `cursor`、`lastSuccessfulAt`（TD 成功提交时间）及 `lastSuccessfulRunId`。源系统的 watermark 可自行放入 cursor，TD 不解释它的业务含义。尚未提交的来源读取为 revision=0、cursor=null、成功时间/轮次=null。`/clear`、回收和重启不会清除已提交位置。

```sh
td todo checkpoint get --collector <id> [--source-key <key>]
td todo collector inspect <run-id>
td todo collector finish <run-id> --revision <collection.revision> --file outcome.json
```

`checkpoint get` 返回 `{collectorId, checkpoints:[...]}`，指定 source-key 时也保留数组形态。`inspect` 返回实际 run，包括 `collection.revision`。成功提交示例：

```json
{
  "status": "success",
  "summary": "声明的来源已完整扫描，无新增候选",
  "coverage": [{"sourceKey": "document:chat", "status": "success"}],
  "checkpoints": [{"sourceKey": "document:chat", "expectedRevision": 0, "cursor": {"lastMessageId": "opaque-id"}}]
}
```

finish 要求有效 run revision；各 source 的 expectedRevision 必须等于当前值。所有 checkpoint 更新与 run 结果同一次存储事务落盘；任一 CAS 失败，结果和所有 checkpoint 都不变。HTTP 409 返回 currentRevision，checkpoint 冲突带 CHECKPOINT_CONFLICT。同幂等键/同结果重试不再次推进，同键不同结果拒绝。CLI 默认从结果内容生成稳定提交键，也可显式 `--idempotency-key`。

status 还可为 partial/failed，coverage 逐项为 success/partial/failed，可带 note。success 必须明确声明非空覆盖范围且各项成功；只有其中声明成功的来源可以带 checkpoint。partial/failed 不能附推进位置。普通 `td todo report` 只记录结果、结束本轮，绝不推进 cursor。TD 不从“新增零条”或 Agent 的自然语言推断扫描完整性，只承诺提交者声明的覆盖范围。

此前成功的单条 add/update 不会回滚；部分成功后重扫继续使用 external-id 与 revision。仅本 collector 当前有效 run 能写入或 finish，写待办时须携带 `--collector <id> --run <run-id>`。旧 run 的迟到写入返回 COLLECTOR_RUN_FENCED。人工 owner 从非 collector 会话/界面管理 TODO 的兼容入口保留。

### 触发记录与容量

run.trigger 在接受请求时与 run 原子持久化，之后不改写：

| 字段 | 契约 |
| --- | --- |
| collectorId / runId | 服务端分配并绑定 |
| triggerType | manual / schedule / webhook |
| scheduledAt | 仅定时触发，原计划的绝对时间 |
| receivedAt | 服务端实际接受时间 |
| timezone | 接受时的服务端 IANA 时区 |
| idempotencyKey | collector 内的稳定触发键 |
| payload | 校验后的 JSON 业务通知；可省略 |

HTTP 请求头与原 Authorization/Cookie 永不复制到 trigger、prompt 或普通日志。payload 作为不可信数据提供；已知凭据字段、嵌套 headers/credentials 会被拒绝，不承诺识别任意文本里隐含的秘密，调用方只提交非密业务通知。payload 与单个 cursor 各最多 16000 UTF-8 字节，outcome 最多 40000 字节，每个 collector 最多 128 个 checkpoint source、10000 个 run；另受默认 32MiB 的 TODO 存储预算约束。触发键不自动过期，未决记录不被静默删除。达到容量上限拒绝新增，先导出/维护归档或调整存储预算；本版没有自动归档命令。

Webhook 必须提供稳定 Idempotency-Key（或已支持的通知 ID header）。同 collector+key、同业务 payload 返回原 run，collector 配置改动不改变原触发身份；同键不同 payload 返回 COLLECTOR_TRIGGER_CONFLICT。接受后返回 202 与 runId/state/revision；202 仅表示已持久接受。认证、禁用、大小、限流和 busy 拒绝都不是接受，不会覆盖既有 payload。原每来源 10 次/分钟限流继续适用，429 带 Retry-After。

### 全周期 busy 与恢复

manual、schedule、webhook 共用一份持久门禁。从接受请求到显式 report/finish/结束本轮，仅允许同 collector 一条有效收集轮次；“已发送到终端”不会释放门禁。不同 collector 可并行。同键重试先查询原记录；不同键遇未结束轮次返回 409 COLLECTOR_BUSY、activeRunId，没有隐式等待队列，也不返回假 2xx。

服务重启将未决 collect 标为 interrupted/结果待核对并保留门禁；不会自动重放终端命令。回收了未报告的终端也保留这一事实。owner 在原终端已被观测为不存在后，可以使用：

```sh
td todo collector inspect <old-run-id>
td todo collector retry <old-run-id> --revision <n> --idempotency-key <新的稳定键>
td todo collector cancel <run-id> --revision <n>
```

retry/cancel 是用户管理操作，不能从 collector 会话调用以扩大自身权限。原终端仍存在（或无法确认）时返回 COLLECTOR_RUNTIME_PRESENT；先查看并关闭该终端。retry 创建关联 previousRunId 的新轮次，原轮次保存 retryRunId，并拒绝旧 run 的后续写入/结果；相同重试键返回同一新轮次。cancel 只结束记录，不宣称停止外部工具，不推进 cursor。终端在取消竞态后才完成创建时，保留这个实际终端的关联，但在发送 Agent 命令前拦截。

UI 在收集方向卡片上禁用重复收集，展示“等待本轮结果”或“本轮结果待核对”，提供重试/结束入口及原终端入口。触发数据和声明覆盖在收集记录中按需展开，不把状态推导为 Agent 内部忙闲或来源健康。

定时繁忙时保留 nextRunAt 的 due 事实；门禁释放后接受一轮合并补扫，再计算下一个服务端计划时间，不逐次重放所有错过的时刻。收集逻辑必须根据 checkpoint 选择回溯范围，依赖瞬时固定窗口的来源没有绝对无缺口保证。保持原服务端日历策略：春季不存在的墙钟时间由 Date 顺延，秋季重复小时仅取首次匹配；已接受的计划键与 nextRunAt 持久化，时钟回拨不重新接受同一时刻。不新增独立的 collector 时区引擎。

CLI 与服务端需要一起升级到 >=1.4.386。新 CLI 在发送 collector 写入、run、checkpoint、finish/retry/cancel 前检查 `/summary` 的 collectorProtocolVersion=1；旧服务不支持时先拒绝，避免参数被旧服务忽略。普通人工 TODO 与只读旧 CLI 入口继续兼容。

## HTTP 接口

统一前缀 `/api/terminal/operations/todos`。继承现有终端 API 的认证、CSRF、服务授权和加密传输规则；浏览器通过页面加密 fetch 使用。本机 CLI 使用 loopback 与私有本机 token。没有匿名写入或业务 HTTP 降级。

| 方法与路径 | 内容 |
| --- | --- |
| `GET /` | todos、collectors、runs、defaults；可用 `?category=short` 等筛选 |
| `GET /summary` | 未完成数量及 collectorProtocolVersion；支持命名空间 |
| `GET /collectors/:id/checkpoints` | 持久 checkpoint，可选 sourceKey；总是返回 checkpoints 数组 |
| `GET /runs/:id` | 本轮触发、状态、collection.revision 与明确结果 |
| `POST /runs/:id/finish` | revision、idempotencyKey、status、summary、coverage、checkpoints；成功 CAS 原子提交 |
| `POST /runs/:id/retry` | owner 操作：revision、全新稳定 idempotencyKey；确认原终端不存在后显式重试 |
| `POST /runs/:id/cancel` | owner 操作：revision；确认原终端不存在后结束此轮，不推进 cursor |
| `POST /` | title、description、category、source、sourceUrl、externalId、collectorId、idempotencyKey |
| `POST /:id` | revision、可选 collectorId 归属前置条件，与 title / description / category / sourceUrl / externalId / status（open、completed、ignored）；revision 冲突返回 409 和 currentRevision |
| `POST /handoff` | todoIds、note、idempotencyKey；已有目标传 sessionId，新建传 config；返回同一批次的持久化交接记录 |
| `POST /:id/run` | 兼容旧版独立执行：config 与 idempotencyKey |
| `POST /defaults` | agentSlug、command、cwd、prompt |
| `POST /collectors` | name、config、enabled、schedule；编辑时加 id 与 revision |
| `POST /collectors/:id/run` | idempotencyKey |
| `POST /collectors/:id/remove` | revision |
| `POST /runs/:id/report` | status（complete、blocked、failed）、content |

启动与注入带稳定请求标识，记录先持久化再创建终端。网络断开后应使用原 key 重试，避免重复创建。清单批量交接为一条消息与一条发送记录，所有关联待办都能跳转到同一会话。首版不提供跨服务汇总、内置来源抓取或自动验收。

## 历次验证记录

- 2026-10-27 所有权补充：168 项回归通过（含 Todo、真实 CLI 子进程、调用会话上下文、相邻 automation/notify CLI、传输/色板/层级守卫），覆盖 A/B 同 external-id、显式及伪装目标归属越权拒绝、漏传 collector、不泄露被拒条目的 revision、重命名、条件更新、独立计数、旧 CLI 拒写、替代写入入口及收集会话防串用。分类/来源筛选的真实浏览器 320/390/1280 宽度测试 3 项通过，前一轮收集计划浏览器 5 项继续适用。TypeScript、完整构建通过，隔离版已重新部署到 9834，健康状态、受管进程、前端资源字节一致性及正式 CLI 分类/来源只读查询通过；未在正式清单中写入测试事项。原有并行 WIP 经比对保留。

- 2026-10-27 分类与更新：148 项 Todo/传输边界/配色/层级回归通过，包含实际 CLI 经本机凭据访问隔离 HTTP 服务的 add/list/update、旧 revision 冲突、重复 add 不覆盖、complete/reopen；320、390、1280 宽度的分类编辑/分组浏览器测试 3 项及收集时间浏览器回归 5 项通过。TypeScript 与完整构建通过，已部署到 9834，health、受管进程、前端资源内容与构建产物一致性及正式 CLI 只读分类筛选通过。浏览器使用隔离数据和 API 替身；尚未实测真实文档服务来源抓取、iOS/macOS 客户端。

- 首轮修复部署使用隔离源码副本，完整生产构建与 64 项回归通过。副本以本轮修复开始时的可构建快照为基础，加入最新 Todo 改动；没有改写其他并行源码。最终构建当时，另一组并行中的共享资源改动触发 `src/server/federation/requestContext.ts` → `src/shared/shareResources.ts` 的 TS6059/rootDir 错误，因此没有把这组未完成改动纳入部署。回归覆盖默认清单保留执行中及已报告事项、记住配置一键处理、新增并处理、收集方向保存并运行、目录快捷选择、跨刷新恢复选择、慢加载保留草稿、不同项目批量处理及重试、切换服务后的迟到响应，以及侧栏、加密边界、配色和层级守卫。
- 在隔离服务中，从实际界面配置真实 Codex：保存并收集 → CLI 写入待办 → 点击处理 → 新建真实 tmux/PTY → 打开关联终端并返回 → 收到 `TD_TODO_EXEC_OK` 结果 → 用户标记完成并在已完成中找到。测试使用当前机器已有的 Codex 登录和权限配置，没有改动正式服务的用户待办。
- 从界面添加第二个方向后点击「全部收集」，两个真实 Codex 终端分别回报结果；新方向成功新增待办，原方向识别已经完成的相同事项并跳过去重，没有重新打开它。
- 在实际手机视口表单中填写不存在的工作目录，验证设置保存与任务启动均明确报错、保留输入；修正目录后重试，真实 Codex 再次回传结果，待办可标记完成。
- 浏览器验证覆盖 1440×960 桌面与 390×844 手机视口，包含新浏览器首次加载、收集/执行、搜索与来源筛选、目录选择器取消、手机与桌面切换时保留配置草稿。此前使用测试 Agent 程序验证的外部注入去重、并行收集和回报仍有回归覆盖。macOS/iOS 原生客户端、真实手机和其他 Agent 提供方尚未实机验收。
- 新界面实际验证：点击目录快捷按钮，保存收集方向后刷新，再次添加方向时自动恢复最近 Agent/目录且收集要求留空；执行默认值保持独立。手机填写一半切到桌面时保留输入和目录选择。新增待办后「保存并处理」直接使用保存的执行配置，不再弹出 Agent/目录表单。
- 最终构建已重启部署至 9834，health 与实际前端资源哈希核对通过；正式待办在部署前后逐字对比一致。已关闭隔离测试服务和 8 个测试终端。
- 入口优化再次验证：在 320×720、390×844 与 1440×960 浏览器视口，终端顶部直达待办、返回当前终端、再次进入后保留筛选均实际走通；手机待办页的新增和设置保持可见。相关 42 项回归与当前工作区完整构建通过，最终服务已更新至最新构建，未改写其他并行源码。入口后续收敛为右侧约 52px 的文字操作，去掉灰底、边框和重复图标；重新验证手机一键进入和返回、320px 窄屏可见性，并核对正式服务 health、实际资源哈希及待办数据一致性。
- 全库 `tsc --noEmit` 仍被既有 `src/lib/components/sidebar/LeftSidebarAttention.test.tsx:59` 语法错误阻挡；仅在检查脚本中排除该文件后，还存在其他既有测试类型错误（9 条），Todo 源码与测试无类型诊断。未修改这些任务范围外的错误，生产构建不受阻。

## 清单与详情简化验收（2026-10-23）

- 当前工作区完整生产构建通过；12 个测试文件共 72 项回归通过，覆盖默认简洁清单、确认完成后返回及撤销、批量资格、配置复用、目录与重试、跨布局草稿、双方向收集、加密边界、配色及层级。
- 隔离服务从首次加载真实操作 Codex：配置第一个方向 → 回传待办 → 清单一键处理（不重复填写 Agent/目录）→ 查看终端及结果 → 确认完成 → 撤销。再添加第二方向，从清单一次启动两个真实 Codex，分别回报结果，原事项正确去重。未操作正式用户待办。
- 浏览器覆盖 320×720、390×844 与 1440×960，验证清单、详情、收集管理、搜索与来源筛选、菜单焦点及多选；最终详情直接展示结果和单一主要操作。此为浏览器视口验收，不代表真实 iPhone/iOS 或 macOS 原生验收。
- 最终构建已部署至正式端口 9834；health、supervisor 与实际前端资源哈希核对通过，部署前后正式待办逐字一致。已关闭隔离浏览器、服务及 5 个测试终端。

## 共享命令方案验收（2026-10-23）

- 8 个测试文件共 44 项回归通过，覆盖旧配置迁移、多方案保留与选择、按 Agent 隔离、编辑及删除、跨新会话/待办共享、刷新恢复、取消草稿、嵌套弹窗 Escape 和现有待办命令保留。当前工作区完整生产构建通过；前端类型检查仍只有前述 9 条任务外诊断。
- 隔离浏览器在桌面保存同一 Codex 的两套方案，在待办新方向中选择并改名，再返回新会话确认同步；刷新后选择和两套方案保留，删除一套未影响另一套。实际启动保存的 `codex --version` 并观测到版本输出，未发起模型任务。
- 桌面 1440×960 与手机 390×844 实际操作独立命令编辑弹窗；手机的名称、命令和保存操作同屏可见，Escape 仅关闭最上层编辑并保留父表单及原配置。此为浏览器验收，未冒充手机原生实机结果。
- 已部署至正式端口 9834，并核对 health、supervisor 和实际前端资源哈希；正式待办部署前后逐字一致。隔离浏览器、服务及两个临时终端已清理。

## 轻量交接验收（2026-10-23）

- 交接前的真实浏览器基线：待办只能直接新建 Agent，不能选现有会话或补充要求；清单仍引导查看结果与确认完成。新版以「交给谁＋补充一句话＋发送」替代必经执行设置及验收步骤，收集能力和历史数据保留。
- 隔离服务真实 Codex 验证：单项新建会话、单项复用现有会话、两项合并交给同一会话；三次输入分别包含对应补充要求，批量回复明确包含两条标题和共同补充。首次原生 Agent 的 Hook 确认选择不信任，未授予新增 Hook 权限；仅做回复验收，未要求改动项目或对外发送消息。
- 浏览器验证 320×720、390×844 与 1440×960：紧凑交接面板、当前会话优先、取消保留补充、响应式切换保留草稿、发送跳转与清单会话链接均实际走通。此为浏览器视口验收，未将其视为真实 iOS/macOS 原生客户端验收。
- 最终 13 个测试文件共 83 项回归通过，覆盖批量单消息交接、补充原文、幂等并发、失败与重启不重放、现有配置保留、旧会话关闭时重新选择、完成及撤销、加密传输与输入队列守卫；当前工作区完整构建通过。前端类型检查仍有 11 条任务范围外诊断，本轮 Todo 与投递改动无类型诊断。实际浏览器还验证了不存在目录报错后保留补充内容，以及关闭旧目标后的重新选择。
- 最终正式服务已切换为项目构建并通过 health、supervisor、交接后端与实际前端资源哈希核对；正式待办 JSON 部署前后逐字一致。隔离浏览器、服务与两个临时终端均已关闭。

## 共享会话数据（2026-10-23）

待办会话列表改用主清单的共享目录，不再单独请求 inventory。选项和已交接会话名称会随主清单的实时标题及重命名更新，目录移除的目标停止可用；补充内容不受元数据更新影响。公共入口与后续功能约束见 [共享会话目录](session-directory.md)。

## 待办短提示插入验收（2026-10-23）

- 复用现有会话菜单和受控粘贴确认链路，激活指定会话并等输入就绪后只插入一次；等待期间用户继续操作或切换服务则取消，不重放。
- 10 个测试文件共 88 项回归、完整 `tsc --noEmit` 和生产构建通过。覆盖菜单入口、精确目标、等待与取消、粘贴归属、已有内容与中间光标、不自动提交，以及加密、颜色和层级守卫。
- 隔离服务桌面浏览器实际验证终端与普通对话：右键插入后前后原文保留，光标后继续补充成功；终端快照确认仍为同一条未提交输入。未启动模型任务、未改动正式待办；尚未做真实 iOS/macOS 原生客户端验收。
- 已部署至正式端口 9834，health、supervisor、实际入口及包含短提示的资源均核对通过；正式待办部署前后逐字一致。隔离浏览器、服务和唯一测试终端均已清理。

## 状态列与卡片操作验收（2026-10-24）

- 删除常驻详情栏及手机详情页，默认待完成/已完成分列，窄屏使用状态页签。卡片直接显示描述、完成/重新打开、编辑和交接入口；长内容、发送补充和历史记录在原卡片展开。已完成的关联会话仍可直达，原会话关闭时提示先重新打开待办，避免进入无法发送的收件人选择。
- 7 个测试文件共 45 项回归通过，包含桌面分列、手机切换、就地编辑、状态迁移/撤销、已完成会话跳转、既有单项/批量交接、收件人目录变更、拖拽、配置恢复，以及加密/配色/层级守卫。
- 隔离组件服务在 1440×960、390×844 与 320×720 实际验证展开不离开清单、完成/撤销、重新打开、保存编辑、来源筛选、侧栏选会话并补充后取消。使用模拟数据，没有发起模型任务或写入正式待办。长列表底部菜单改用现有全局菜单层级，在视口内定位，不受列滚动裁切；选项可点击、滚动关闭。
- 此为浏览器视口验收，不代表真实 iOS/macOS 原生客户端验收；临时浏览器与组件服务已清理，没有创建测试终端。
- 最终完整类型检查及生产构建通过；并行改动补齐后部署至正式端口 9834，health、supervisor、实际入口及包含状态列的新待办资源均核对通过。正式待办部署前后逐字一致。

## 卡片下方的选择控制（2026-10-24）

- 撤回误改的卡片内下拉选择及发送表单，恢复原有侧栏逐会话发送入口；原确认与选填补充面板保留。仅把选择期间的「新建会话」「取消」移到对应卡片下方，移除侧栏顶部的选择说明块，其他布局保持原样。
- 8 个测试文件共 87 项回归通过，包含实际 LeftSidebar 的普通/工作组/分屏会话选择、普通 Shell 禁止交接、取消/Escape、卡片内新建入口、原确认面板与补充草稿保留，以及原有交接、加密/配色/层级检查。完整类型检查与生产构建通过。
- 隔离浏览器实际验证原侧栏选择 → 确认/补充 → 更换目标，以及卡片内新建/取消；手机 390×844 检查控制位置且无横向溢出。没有发送任务或修改正式待办，此为浏览器视口而非原生实机验收；临时浏览器和组件服务均已关闭。
- 已重新部署至 9834，health、supervisor 及实际前端资源核对通过；正式待办逐字保持一致。

## 通用待办指引与收集方向 CLI（2026-10-24）

- 复用会话菜单「插入待办提示」，短提示统一为「【待办用法：`td todo --help`】」。完整帮助介绍清单管理及定期收集；新增 `td todo agents`、`td todo collector list/create`，可从对话整理要求并直接保存方向，无需逐项填写表单。
- 创建支持文字、UTF-8 文件或标准输入，可选择 Agent、启动命令、目录及手动/间隔/每日计划。保存不立即启动任务；已有服务端校验和持久化路径保持一致，失败不自动重试或回退接口。
- 9 个测试文件共 56 项回归通过；最终短文案另通过 4 文件 33 项回归，完整类型检查及生产构建通过。HTTP 集成测试使用临时 TodoStore，验证文件要求与计划持久化、查询和页面快照一致、无额外启动，以及无效目录/文件失败；未启动真实模型任务。
- 隔离组件浏览器在桌面 1440×960、手机 390×844 验证原会话操作与真实聊天编辑器插入链路：光标位置插入、保留原文、不自动发送，最终短提示无横向溢出。此为浏览器验证，未做真实 iOS/macOS 原生验收；没有修改正式待办数据。
- 已部署到正式端口 9834；health、supervisor、前端资源及最终短提示构建核对通过，正式 CLI 的 Agent/方向查询成功。部署前后正式待办文件 SHA-256 一致，临时组件服务及浏览器已关闭。

## 收集方向管理入口（2026-10-24）

- 将清单顶部「收集」改为「管理」，统一进入收集方向页面；无论是否已有方向，点击入口均不启动收集，也不自动弹出创建表单。管理页保留逐方向开始/再次收集、编辑、添加、确认删除，删除方向保留已有待办与终端记录。
- 6 个测试文件共 44 项通过，覆盖管理入口零收集请求、空方向管理页、单方向收集、删除取消及确认、已有待办保留和既有交接流程；完整类型检查与生产构建通过。
- 隔离浏览器在桌面 1440×960 和手机 390×844 验证进入管理没有运行请求、只触发指定方向、删除取消/确认以及移动端操作可见且无横向溢出。使用模拟方向与收集响应，没有运行实际 Agent 或删除正式数据；不代表原生手机验收。
- 已部署至 9834，health、supervisor 和实际前端管理入口资源核对通过；正式待办数据部署前后逐字一致，临时浏览器与组件服务均已关闭。

## 收集会话与生命周期（2026-10-24）

- 自动创建的收集终端放在待办清单内的「收集会话」折叠区，不再占据左侧会话列表。共享目录提供统一的展示名和目录；手动加入协作组或分屏的会话保留用户安排的位置。
- 每个收集方向的「会话与回收」可以选择每次新建或复用。默认自动管理本方向的终端，也能指定已有 Agent 会话。自动复用只沿用同方向、同 Agent/启动命令/目录的终端；上一轮须先提交结束报告。终端已回收时，下次自动创建。
- 复用前命令可留空，例如填写 `/clear`。命令单独提交、等待输出安静一秒后再提交收集要求；目标变化、命令持续输出或发送失败时停止本轮，不自动重放清理命令或另开终端掩盖失败。
- 连续无终端输出默认 **10 分钟**后自动关闭终端并释放运行资源，每方向可配置 1–43200 分钟，0 关闭。任何真实终端输出重新计时；心跳、打开清单和结果报告不算输出。服务器每 30 秒检查一次，重启或观测重连后给予完整观察窗口。
- 静默思考也属于「无输出」，回收不代表 Agent 完成。待办、收集运行记录和结果仍保留，并标明终端已回收。指定的已有会话、后来交接了其他待办的会话、加入协作组的会话不自动回收。
- 自动终端的持久运行记录保存来源及 tmux 身份；回收前重新核实 tmux 服务进程启动身份、不可变会话 ID、pane 和后台实例，输出更新/目标替换/消息待发送时跳过。关闭与发送沿用公共投递屏障、终端输入队列，不另建会话库存或通信入口。
- 旧收集记录首次观察时补记运行身份，后续重启保持此身份，不会按复用后的 tmux 名称误关其他终端。

## 来源、自动处理、Webhook 与领取

- 收集方向就是可配置的来源。待办保留 `collectorId`（稳定身份）与 `source`（显示标签）；同名来源互不混淆，按 `collectorId + externalId` 去重，改名后仍能去重。未关联方向的外部注入按 `source + externalId` 去重。
- 每个来源的「收集后」默认仅入清单；可明确选择自动新建 Agent（每条待办一个会话），或发送到已存在的 Agent，并填写额外处理要求。只影响保存后该来源新注入的待办，不追溯启动旧任务。自动交接先持久记录再发送；重复注入不重复执行，失败会留在卡片上，不换目标或自动重放。
- 「外部通知」可启用来源专用 Webhook，与原有手动、定时触发并存。`POST /hooks/todo/<collector-id>` 接收 JSON；`Authorization: Bearer <source-secret>` 只能触发该来源的收集。UI 保存后可复制调用示例，替换成服务实际可达的 HTTPS 地址；远端明文请求拒绝，本机 loopback 可用于 CLI/测试。不改变任何 `/api` 的鉴权或加密要求。
- 通知正文仅作收集上下文，不能覆盖 Agent 启动命令或权限。建议发送稳定的 `Idempotency-Key`（兼容 `X-Webhook-Id`、`X-GitHub-Delivery`）；同一通知不重复发起。限制 32 KB JSON 解析、16 KB 通知正文和每来源每分钟 10 次请求；停用来源或 Webhook 后不触发。
- UI 与 CLI 共用 `/operations/todos/collectors` 和同一份持久化配置。`td todo collector schema` 输出配置示例，`collector save --file config.json`（或 `--stdin`）创建/更新；更新提供 `id`，保留未修改字段并按 revision 检查冲突。还支持 `collector run/remove <id>`。
- `td todo sources` 显示来源名称、稳定 ID 及待领取数量；`list --collector <id>` 或 `list --source <标签>` 筛选。名称可能重复或被改名，优先使用稳定 `--collector`。
- `td todo claim --collector <id>` 原子领取一条可领取待办，自动使用与 `td automation --self` 相同的当前会话解析。可显式指定 `--session <id>`，也支持 `--source <标签>` / `--todo <id>`。没有明确范围会拒绝领取，提示先向用户确认。已交接、已完成、待自动交接及有效领取中的待办不能重复领取。
- 领取返回 claim ID、到期时间及结果 run ID；默认 30 分钟，`--lease` 可设 1–1440 分钟。`td todo renew <todo-id> --claim <claim-id> --lease 60` 续期；`release` 释放。到期后未提交结果的事项可重新领取，过期/已替换的 claim 不能续期或释放别人的领取。UI 卡片显示领取者，更多菜单可由用户释放领取。
- 领取只返回任务，不向领取 Agent 再写一遍提示词。Agent 应只处理实际领取的任务，将结果报告到返回的 run ID；未获用户授权时不要自行标记用户验收完成。
- 定时领取复用 `td automation create --self --every ... --prompt ...`，不增加另一套调度器。短提示词仍为 `【待办用法：`td todo --help`】`，帮助指引要求先确认未声明的来源、范围、频率与执行权限，再创建定时任务、领取或启用自动处理。

### 本次验证

- 20 个功能/目录/交接/白名单/配色/层级回归文件共 227 项通过；另有 5 个鉴权、安全入口文件共 30 项通过。完整类型检查与生产构建通过，终端尺寸单元/浏览器检查通过。
- 隔离真实 tmux 与测试 Agent 程序验证两轮收集复用、`/clear` 先于第二轮提示词、静默到期实际关闭终端、记录保留、回收后再新建；验证中发现显示 PTY 重绘会被误计为输出，现改为读取所有 tmux 窗口的真实输出活动时间，包含隐藏窗口。
- 同一隔离服务验证真实 CLI 配置 → Webhook（凭据校验、通知去重）→ 待办注入 → 自动新建/指定现有 Agent → 按来源领取/续期/释放；当前会话定位复用现有公共 resolver，验证旧 backend 提示失效时仍能通过存活 tmux pane 找回正确会话。未调用真实模型或外部通知提供商。
- 桌面 1440×960 与手机 390×844 浏览器验证保存配置、选择现有 Agent、缺少目标时禁用保存、Webhook 调用示例复制、底部动作可见且无横向溢出。未进行 macOS/iOS 原生实机验收。
- 已自动部署至正式 9834；health、supervisor、前端及 Todo chunk 字节一致，错误凭据 Webhook 返回 401。只读比较确认正式 Todo 条目与收集源配置未被测试修改。隔离服务、浏览器、组件服务及本次临时 tmux 会话均已清理。
