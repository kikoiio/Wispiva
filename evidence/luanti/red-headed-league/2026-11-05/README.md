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
