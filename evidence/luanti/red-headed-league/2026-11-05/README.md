# 《红发会》本机游玩与运行记录 — 2026-11-05

本页分别记录地图投影、真实模型运行、玩家连接和恢复边界。自动化与模型行为不替代真人故事验收。

## 最近游玩实例：v11（已停止，恢复待核对）

核对时间：2026-11-05 10:52:20 EST。开发目标已由用户暂停；进程清单中未发现 v11 启动器、Luanti 服务／客户端或模型 worker。日志最后更新时间为 10:45:54，最后一项有效模型动作时间为 10:45:33。存档仍有 `wispiva-session-recovery.json`；日志没有 `product-checkpoint`、`environment-checkpoint` 或 `done result=` 完成记录。退出原因和最后一致提交状态尚未确认，不能把进程退出当作正常保存或恢复通过。本次仅核对并更新文档，未重启服务、清除标记或调用模型。

- 起点：`validation/red_headed_league/moment.json`，四名角色、四个地点、解散告示和地窖工作面。
- 私有本机世界：`.data/red-headed-league-playable-20261105-v11/world`；世界 ID `a0ddce3d-2d00-4a07-8877-20d092fadb74`。
- Luanti 5.10.0 服务曾监听 `127.0.0.1:30083`；本机客户端曾以 `player` 连接，出生点在贝克街 221B。当前服务与客户端均已退出。
- 地图投影完成 1456 项操作；50/50 forceload 区块覆盖地表与地窖；四名角色均成功生成。地窖位于当铺下方，入口投影为可攀爬梯子。
- 当次真实 provider：SCNet `api.scnet.cn`，GLM-5.3-Flash，Anthropic `/messages` 协议；单 worker、每 60 秒决策一轮。用户已授权模型调用；目前模型 worker 已退出，本次文档核对未发起调用。
- 最后日志快照（10:45:54）：136 个模型请求 ID 均有尝试记录，共 357 次尝试；28 项有效动作由四名角色各完成 7 项。记录 1 项地窖工作面状态事件、3 条 NPC 消息和角色移动。108 个请求以失败结束：68 个 `provider_failed`（204 次尝试，最后一次在 10:15:33）、39 个 `transport_error`（117 次尝试）和 1 个 `invalid_response`；尝试总计还有 3 次 `invalid_action` 和 5 次 `invalid_response`。这些是当时版本的错误标签，其中协议错误曾被归并为 `provider_failed`／`transport_error`，不能将全部历史失败直接解释为模型拒答或网络故障。角色输入包含各自目标、私有起始记忆、当前观察和获准动作；v11 未开启输入／输出审计。当前仍没有可复核的玩家私信触发回复轨迹。
- 已定位并修正一项主要失败原因：当次配置使用 SCNet Anthropic `/messages` 端点，反思代码此前误发 Responses 格式的 `input`，收到 HTTP 400（脱敏错误信息表明缺少 `model`／`messages` 字段）。反思现在按 Anthropic 格式构造 `system`／`messages` 请求并使用 Anthropic 响应解析；HTTP 4xx、5xx 也会分类。修复后的合成决策探针成功（7.2 秒，952 输入／365 输出 token），反思探针成功（5.7 秒，168 输入／256 输出 token，引用 1 条来源）；两者不计作角色或玩家剧情轨迹。v11 日志最后一次 `provider_failed` 出现在 10:15:33，之后新增了有效模型动作。SCNet 官方协议与模型说明：[Token Plan 模型表](https://www1.scnet.cn/ac/openapi/doc/2.0/moduleapi/plans/token-plan.html)、[API 文档](https://www.scnet.cn/ac/openapi/doc/2.0/moduleapi/api/chat.html)。
- 定向 adapter、reflection、bridge 和 spool 回归共 64 项通过。spool 源码现对传输错误、服务错误和限流各最多重试一次，对动作／响应格式纠正最多重试两次；拒答及请求拒绝不重试。上次 worker 未重载新预算且目前已退出；新预算只有定向测试证据，真实运行生效情况仍须下次正常启动确认。
- 以上动作来自真实模型选择与确定性执行器的混合链路；投影和状态转换检查由规则执行。28 项动作和 1 次物件变化尚不能证明完整的故事进展、条件变化后的新决策、玩家互动或同一世界恢复。离线 fixture 的结果单独列在下文。

## v10：有效模型轨迹与恢复缺陷

- 世界 ID：`3caee073-28ad-48e7-9b74-0653050f1062`。四名角色各完成 3 项有效动作，共 12 项；记录 1 项地窖工作面状态事件、3 条 NPC 间消息和角色移动。它们是模型选择行动、确定性规则校验并执行的混合结果；没有玩家输入。
- 决策间隔曾设为 12 秒、worker 数为 1。累计记录 115 个模型请求、12 项有效动作及 100 个 `provider_failed` 响应。正常停止时四名角色存活，逻辑时间 878，资源对账通过；checkpoint v2 提交为 19 个事件、41 条记忆。
- 随后的同世界恢复在 `invalid decision offers` 处失败。只读检查发现 Luanti 将空 Lua table 编码为 JSON `null`，而叙事状态恢复器原先只接受 table。已在 `world/narrative_state.lua` 将空集合规范化，并通过 narrative state 26 项断言及 story runtime 检查。
- 恢复失败后 launcher 保留 recovery marker；其内置 recovery 检查因存有 `product_active_run` 而拒绝清除。v10 保留原样并冻结，不直接改写 checkpoint 或绕过 marker。修复后的代码用于新建 v11；v10 本身尚未证明可恢复。

## 先前运行

### v7：有界真实模型轨迹

- 世界 ID：`d1a621b5-3ff3-4858-9fc0-2cac60a4fb18`；四名角色各完成一次模型决策，共 4 项有效动作，正常 checkpoint v2（13 个事件、22 条记忆）。
- 记录一次故事物件状态事件。此轨迹没有玩家输入；该世界生成时梯子方向尚未修正，不作为当前垂直入口验收。
- 当次开启模型审计；私有请求与响应留在该世界 `private/model-audit/`，不复制到本文。

### v8：离线投影夹具

- 无 provider 的 `--visual-fixture` 运行完成，四名角色生成，1456 项投影和 50/50 forceload 成功，checkpoint 正常提交。
- 夹具执行了 4 个模拟检查／标记动作；不是模型行为，也不是玩家行为。该世界仅作投影烟测。

## 失败尝试

- v6 的真实模型有界运行在无效动作重试后失败，不能计入成功轨迹。
- v9 是空白新世界，却误以 `--resume` 启动；因没有既有 checkpoint，在角色生成前报 `restore-invalid`。未完成模型决策；该世界不恢复或复用。

## 尚待开发验证与真人验收

v11 曾有客户端连接与多轮模型动作，目前已经停止。恢复开发后须先通过受控恢复流程核对 checkpoint 和遗留 marker，再验证新重试预算、客户端调查／私聊、角色针对玩家的真实回应、持续后果及同世界恢复；不能直接删 marker 继续。尚无可核验的真人体验记录，无法确认玩家是否调查告示、查看调查簿、实走地下梯、发送私信或观察回应。技术闭环和真人体验均有待办，《红发会》可玩世界里程碑仍未完成。

## 恢复开发后的只读核对

用户已恢复开发并授权独立验证分支及 GitHub Actions。v11 的文件后端仅存 `product_state` 和非空 `product_active_run`；产品提交版本为 1，逻辑时间为 0，角色／事件／记忆／环境组件版本均为 0。没有 `agent_state` 或 `environment_state`。这不是仅遗留 launcher marker 的窄窗口，不能通过清除标记恢复 28 项动作。地图存在不构成角色记忆一致提交的证据。原存档保持冻结。

日志记录 SIGTERM 及 Server Shutting down，但没有产品 shutdown callback 的时间／prepare／commit 记录；退出原因仍未确定。启动器和恢复标记定向测试共 12 项通过。后续用干净起点验证正常停服和恢复，不把重建世界称为恢复 v11。

## 云端正常启停基线（恢复开发后）

独立验证分支 `validation/interior-recovery-20261105`，快照 `35057376b5279ab22c61a7270e83e0a72ba79093`。经用户授权推送并触发 [GitHub Actions 42067547430](https://github.com/kikoiio/Wispiva/actions/runs/42067547430)，只读查询确认 completed / success。119 项 Python 测试通过；Lua persistence、navigation、narrative_state（26 断言）、story_runtime、world_projection（32 项）及 interior blueprint 检查通过。真实 Luanti 客户端双视角捕获与同一干净世界正常停服恢复步骤通过，生成 allowlist artifact `wispiva-baker-interior-reference`（ID 13433223573）。模型采用 fixture，未发起新的真实 provider 调用。

此结果不表示 v11 已恢复，不包含玩家私聊／真实模型回应或真人路线验收。Artifact 下载链接已由 GitHub connector 返回，但本机下载遇到 TLS EOF，因此本地未取得截图或 capture-summary，未进行新增截图的人工视觉复核。工作流成功及各检查结果来自 GitHub API 和 job log。

## 真实玩家输入链路自动验收：第一轮失败

[Actions 42069210457](https://github.com/kikoiio/Wispiva/actions/runs/42069210457)，快照 `a3d4843f93c767774fb12c47565412bf0da5b14f`。采用 SCNet / GLM-5.3-Flash、单 worker、3 秒调度间隔、真实客户端与自动玩家驱动。驱动仅移动玩家并调用正常物件／角色交互表单回调，不生成 NPC 行动或回复。119 项 Python 与前置 Lua 检查通过。十分钟预算内调查与来源调查簿通过，17 次模型尝试产生 13 项动作和 1 次故事物件变化，但两轮私聊回应没有完成，因此端到端验收失败，不能记为通过。

后续快照 `a8357fc3b1b737f95bf12c9de446fb3a879946e8` 补充通用玩家问题优先级及私聊动作说明；不写固定台词或原作未来事件。验收脚本另加目标角色输入范围、公开事件不含私聊正文、重试上限和恢复后模型继续决策检查。[Actions 42071239099](https://github.com/kikoiio/Wispiva/actions/runs/42071239099) 正在验证，结果尚未确认。

## 真人入口修复及后续核对

真人在 v12 报告不能右键角色。原因是玩家加入后的 `set_body_solid(true)` 把角色设为 `pointable="blocking"`，射线被阻挡而角色不可选择。现改为 `true`，自动驱动也增加实际 ObjectRef 的可选择属性检查，避免仅直接调用回调漏掉入口。用户已在 v13 实际确认可打开私聊。v13 日志随后记录 Wilson 在 12:33:17 执行 `reply_player`；输入审计只核对角色范围和消息数量，没有在此导出玩家正文。回复显示与完整路线体验仍待真人反馈。

v12 曾正常停服并提交版本 2（28 个事件、41 条记忆），launcher 校验通过且清除 marker。然而完整重启因已被玩家挖掉的地毯 `(-1,0,0)` 与起源投影不一致而冻结，不能把正常提交等同于续玩通过。日志另记录玩家放置木块及挖掘地面。v12 保持冻结。新增起源场景保护仅覆盖投影管理的节点及通路，阻止意外挖掘／覆盖，保留右键故事交互；未管理区域仍沿用原有保护规则。v13 是新世界，不是 v12 的恢复。

空参与者事件在 Luanti JSON null 解码后丢失 `participants`，使恢复后序列化不一致且可能破坏同操作幂等重试。定向回归修复前报 `restored event lost its empty participants collection`，规范化事件参与者集合后，事件与 persistence 检查通过（本机 liblua5.3 轻量执行；Lua 5.1 兼容性由云端检查）。另修正隐藏资源节点场景的对账口径，虚拟环境余额不再被误报为缺失的地图资源。

第五轮 [Actions 42074060715](https://github.com/kikoiio/Wispiva/actions/runs/42074060715) 已走过真实私聊、后果、输入范围和正常恢复的消息／记忆／事件比较，但继续运行步骤没有解除存档保留的暂停状态而超时。验收现通过正常 control `resume` 显式解除暂停。最终快照 `02755b00638d26b1b51620492d937cf42b3047a3` 的 [Actions 42075339941](https://github.com/kikoiio/Wispiva/actions/runs/42075339941) 运行中，尚未记为通过。

## 完整真实模型与真实按键验收

[Actions 42075339941](https://github.com/kikoiio/Wispiva/actions/runs/42075339941) 已 completed / success。汇总见 [playable-42075339941.json](playable-42075339941.json)。两条自动玩家私信产生两次不同真实模型回应，角色改变地窖节点；正常停服恢复后的叙事、记忆和事件一致，解除暂停后继续产生真实模型动作。玩家输入范围、公开事件不含私聊正文及请求尝试上限检查通过。驱动会传送真实客户端玩家并调用生产表单回调，不是完整真人操作证据。

[Actions 42153990202](https://github.com/kikoiio/Wispiva/actions/runs/42153990202) 也 completed / success，汇总见 [playable-42153990202.json](playable-42153990202.json)。新增真实客户端 X11 按键验证，约一秒内 Shift 下爬 2.412 格、Space 上爬 2.805 格，区别于自由落体与普通跳跃。记录 12 项有效模型动作、16 次尝试，其中 4 次 invalid_action；私聊、节点后果、正常恢复及恢复后继续决策均通过。

## 人物、梯井与地形升级

用户实际确认可打开私聊、发送消息并看到 Wilson 的真实回复。随后反馈梯井过窄、人物眼高不一致、扩大后仍有自由下落通道。保留同一 v13 的身份和私信，依次升级地图修订 2、3：扩大为 2×2 入口；四格都有可见、连续且延伸到入口上沿的攀爬节点；修改人物模型根节点与碰撞盒的半格偏移，使 NPC 和玩家脚底、眼高采用同一地面基准。模型衍生素材与原许可证随代码保存。旧地图只在原投影通过校验后写入差量，写入并回读、刷盘后提交，不重建世界。

用户又反馈从场景周围跌入空白。原投影只在有限地表铺了一层地面，地下和外侧没有完整地形。地图修订 4 添加 x/z 各 -64..64、y -8..0 的连续草地与土层，地窖、梯井和房间继续保持原有净空。普通地形可以编辑；场景结构保持保护。升级保留已有非空地形／玩家放置内容。增加 `/return` 与 y<-24 的自动安全返回。编译失败曾触发 launcher marker，确认原 checkpoint 完整且未进入产品活动会话后，使用 `recover_committed_checkpoint` 正常核对并清理该窄窗口标记。

本机 v13 地形升级后正常提交并再次恢复，世界 ID 仍为 `814ee4ab-4dd0-4829-b740-428a6366f450`。只读比较确认私信／叙事、长期记忆、世界事件与地形升级前完全一致；新日志验证 150684 项投影、162/162 区块加载及四名角色恢复。私有升级前备份留在 `.data/red-headed-league-playable-20261105-v13/`，不上传。

包含室外站立、坠落安全返回和 `/return` 物理检查的新快照 `df9ecaf02b586b4fc5ca2a362be89314c6eea1a6` 的 [Actions 42155489862](https://github.com/kikoiio/Wispiva/actions/runs/42155489862) 正在运行；地面、攀爬、眼高的最终真人反馈仍待完成。

## 地形补齐后的最终自动验收

[Actions 42155489862](https://github.com/kikoiio/Wispiva/actions/runs/42155489862)，快照 `df9ecaf02b586b4fc5ca2a362be89314c6eea1a6`，completed / success。汇总见 [playable-42155489862.json](playable-42155489862.json)。真实客户端约一秒下爬 2.804 格、上爬 3.001 格；室外 `(48,48)` 地面站立、从 y=-40 的自动安全返回及 `/return` 均通过真实物理检查。两条私信／两次不同真实回复、节点变化、范围与公开事件隐私、正常恢复、恢复后模型决策全部通过。6 次尝试产生 5 项有效动作，其中 1 次 transport_error；该单次运行不代表全部故障类别覆盖。

本机 v13 地形升级正常提交后再次严格恢复，叙事、记忆、事件与升级前一致，世界身份保留。客户端重新连接并解除世界暂停；只剩最终真人体验反馈，自动驱动不被记为真人验收。

## 保存中断边界

[Actions 42157068589](https://github.com/kikoiio/Wispiva/actions/runs/42157068589)，快照 `60686db2f28607803ce2dfdf877dea81db9664b0`，completed / success。汇总见 [checkpoint-42157068589.json](checkpoint-42157068589.json)。仅用夹具模型，在叙事 checkpoint v2 的 after_map、after_environment、after_agents、before_commit、after_commit 五处中断，均观察到指定故障；恢复拒绝、不完整会话标记保留，测试创建的进程全部退出。它验证不拼接不完整状态的围栏，不意味着具有跨存储原子回滚或能恢复未提交的全部行动。真实模型、真人和夹具证据分别记账。

工程验证已完成；游戏服务和客户端保留用于最终真人复测。尚未收到最新地面、受控攀爬、人物眼高及完整调查体验的最终确认，因此不把完整真人里程碑写为完成。
