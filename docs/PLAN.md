---
status: active
---

# Wispiva 产品分支实施计划

更新：2026-10-30（产品代码 `b8cf457` 的 Actions [41058024437](https://github.com/kikoiio/Wispiva/actions/runs/41058024437) 通过；真实模型验证 `281d00e` 的 Actions [41058674691](https://github.com/kikoiio/Wispiva/actions/runs/41058674691) 通过；20–10k 规则实体容量阶梯见下）。本分支就是 [Wispiva 产品目标](intent.md)的独立实现，使用 Minecraft-like 的 Luanti 基底，并独立发展，不合并到 `main`。此计划承接用户的方向调整；[目标设计](design/2026-10-27-target-architecture.md)描述拟采用的职责和未决设计。[当前架构](architecture.md)区分现有能力与缺口。历史验证计划和测量继续保留，不把它们改写成产品能力。

本轮续作已有多次云端端到端证据：[Actions 41075436293](https://github.com/kikoiio/Wispiva/actions/runs/41075436293) 和 [41076669398](https://github.com/kikoiio/Wispiva/actions/runs/41076669398) 都将三人中文河谷草稿写入 DraftStore、确认 revision、发布持久 Luanti 世界并由真实模型完成各 18 次决策与 checkpoint；两轮均为 3/3 角色带入自己的种子，逐请求跨角色泄漏为 0。第一轮 gather 9、build 4，没有 say/give；第二轮 gather 9、build 7、give 1、approach 1。两轮都没有 message，角色互动尚未显现为对话；其余动作支持资源采集、建造、移动和物品转交。模型重试和反思确实有调用，第二轮 19 次决策尝试含 1 次 `invalid_action` 后恢复，另有 6 次反思。Actions [41080849574](https://github.com/kikoiio/Wispiva/actions/runs/41080849574) 的中文草稿编译遇到 `out_of_bounds`，当轮未创建中文世界；生成器随后加入有界编译校验重试。[Actions 41090595388](https://github.com/kikoiio/Wispiva/actions/runs/41090595388) 已通过完整回归和三人中文持久世界真实模型运行，完成 18 次决策，3/3 角色带入各自种子且跨角色泄漏为 0；动作是 gather 7、inspect 7、build 2、mark 2。该轮 provider token 审计缺失。自动化确认仍不等价于用户查看并确认草稿，真人 3D 客户端验收和更长社会演化仍待完成，相关计划条目继续保持未完成。

最新回归 [Actions 41107576079](https://github.com/kikoiio/Wispiva/actions/runs/41107576079) 在提示改进提交上通过，8 组 Python/Lua 套件共运行 393 项（1 项跳过），其余通过。专用真实模型记忆复验 [Actions 41107598621](https://github.com/kikoiio/Wispiva/actions/runs/41107598621) 以 6 类任务 × 3 个 seeds × FIFO/retrieval 完成 36/36 次请求，无 provider error；retrieval 16/18（88.9%），FIFO 0/18，18/18 retrieval 请求都选中目标证据。新增的提示解释短线索与记忆记录的关系、证据逐字提取和不猜测要求；短中文线索观测为 1/3（前一版为 0/3），明确逐字提取仍为 3/3。由于每版只有 3 个 seeds 且 provider 输出不确定，单次复验不能证明提示改动造成提升。该合成实验仍不能证明世界内长期记忆质量。

Luanti 客户端画面 Actions [41110698741](https://github.com/kikoiio/Wispiva/actions/runs/41110698741) 在最新产品提交上通过 393 项回归（1 项跳过），并真实连接合成产品世界、交互和引导到达。该运行把 1280×720 的客户端截图 `view-acceptance.png` 放入 artifact [ID 13002868352](https://github.com/kikoiio/Wispiva/actions/runs/41110698741/artifacts/13002868352)，可下载查看实际 Luanti 画面。自动截图与客户端路径仍不等于真人进入游戏的视觉评价。

最新云端证据：Lua/Python 回归、真实产品世界客户端连接、三角色真实模型决策及恢复、四角色用户意图自由社会、24 次有界真实模型回放和五个隔离 checkpoint 故障注入点均曾通过。自由社会短场景确有资源分工与转移，但不能证明角色自发对话或稳定社会涌现。历史模型私有请求 artifact 与产品模型验证日志已在隐私复核中撤下；本计划及[证据页](../evidence/luanti/product-model-2026-10-30/README.md)保留聚合结果。产品验证 `wispiva-results-0` [ID 12968859202](https://github.com/kikoiio/Wispiva/actions/runs/41037867018#artifacts)仍可查看确定性客户端验收。仍需真人体验、实际意图确认与更大规模容量验证。

最新真实 provider 并发补测：[Actions 41058674691](https://github.com/kikoiio/Wispiva/actions/runs/41058674691) 的 1/2/4/8/16 并发阶梯各回放 24 次、共 120 次，110 次生成可执行动作，10 次因 `invalid_action` 被拒绝。吞吐从 0.252 次/秒（并发 1）升至 1.957 次/秒（并发 16）；并发 16 档为 24/24。按该批速率，1,000 个角色每分钟决策一次约需 16.7 次/秒（观测值的 8.5 倍），10,000 个约需 166.7 次/秒（85 倍）；这只是调度估算，不能当作持续 provider 容量。真实模型自由社会本轮完成四角色 24 次决策，出现 8 gather、3 build、0 say、0 give。它是四个角色上下文的受控回放和单个短场景，不构成千级 LLM 角色或稳定社会涌现证据。产品创建瞬时 provider 错误现有最多三次有界重试，见[真实模型产品证据](../evidence/luanti/product-model-2026-10-30/README.md)。

四次重复的自由社会短场景共完成 96 次真实决策、保存 248 条记忆记录；共出现 4 次 `say` 和 4 次 `give`，分别只在 1/4 与 2/4 轮出现，正式 meeting 事件为 0。该波动更支持“交互能力已进入动作空间”，还不足以说明互动稳定或形成社会结构；逐轮结果见[场景证据表](../evidence/luanti/product-model-2026-10-30/README.md#四次自由社会场景汇总)。

加长验证 [Actions 41088765681](https://github.com/kikoiio/Wispiva/actions/runs/41088765681) 曾运行四角色、每角色 24 次决策，共 96 次；当时 `say`、`give`、message、meeting 均为 0，后续负载为 23/24 可执行。最新 [Actions 41099553897](https://github.com/kikoiio/Wispiva/actions/runs/41099553897) 在提交 `83e34c5` 上完成另一轮 96 次真实决策：gather 36、build 28、say/message 15、give/资源转移 3、正式 meeting 0；私有记忆审计和世界 checkpoint 均通过。该轮动作尝试含 4 次 `invalid_action`、2 次 `invalid_response` 和 3 次 `provider_failed`，靠有界重试完成场景；独立并发 4 回放仍为 23/24 可执行，1 次 `invalid_action`，故 Actions 总体在严格负载门槛失败。一次场景出现交流和转移不证明互动稳定或长期演化；详细计数见[自由社会证据](../evidence/luanti/product-model-2026-10-30/README.md#当前公开世界上下文与重复自由社会actions-41099553897)。

容量证据见[角色容量阶梯](../evidence/luanti/agent/capacity-2026-10-30.md)：[Actions 41045304874](https://github.com/kikoiio/Wispiva/actions/runs/41045304874) 的 20–1,000 角色、8 种角色数／认知设置全部通过，所有实体存活并完成 4 次规则决策，引擎采样 RSS 为 80–111 MiB；[Actions 41046819509](https://github.com/kikoiio/Wispiva/actions/runs/41046819509) 的 5,000／10,000 角色、认知开关两种设置各重复 3 次，全员存活并完成 12 次决策，10k RSS 为 1,220–1,493 MiB。各阶梯都通过运行器 10 steps/s 硬门槛，但最低步频 10.85–11.07 仍略低于 11.1 实时参考线。10k／3 秒服务延迟的队列模拟中，即使 1,000 个 worker，60 秒仍有 9,000 个请求待处理；这是模拟，不是真实 provider 测量。全部实体容量结果均使用规则策略，不是 LLM 角色服务能力。

## 产品目标与当前交付面

Wispiva 是一个独立产品：用户用自然语言或素材描述想要的世界，系统把意图整理为可编辑、可确认、可恢复的世界起点，并在 Luanti 三维世界中让角色持续感知、行动、记忆、交互和改变环境。角色数量、题材、规则和记忆策略都是产品运行时的可配置维度；固定夹具只用于回归，不能替代真实意图和真实模型验收。

本阶段优先完成产品级通用创建的可运行闭环：统一创建与状态契约、通用起源编译、跨组件版本与恢复对账、私有记忆进入主循环、真实三维观察入口、可暂停和可恢复的持续世界。容量研究同时回答“是否能支持成千上万实体”和“哪些角色需要真实模型”，不把规则实体数写成 LLM 角色数。所有未完成能力必须保留可验证的限制说明。

完成标准是 [《红发会》](source-texts/sherlock-holmes/the-red-headed-league.txt)。先按故事里已经发生的事设定世界：贝克街、当铺、Jabez Wilson、Vincent Spaulding、已解散的红发会、地窖和相邻银行，以及各人当时知道和不知道的事。最终测试停在 Wilson 向 Holmes 讲完红发会解散、当晚行动尚未发生的时刻，然后让世界自动继续。通过条件是这次续跑产生真实的后续状态和后果，并保留是哪一种可能。原文结局可以出现，也可以不出现；不能靠注入动作或对白把故事演完。2026-11-03 已用这份设定发布世界 `7a3c007b-9bf3-4bd4-baf1-c7cdad00e133`，并在本机无界面跑完每人一次自主决定：4 次请求、4 次尝试、0 次失败，输入 8923、输出 2019。Holmes 向 Wilson 发出一条消息，Spaulding 采集 1 个通用资源，Watson 与 Wilson 各自把靠近 Holmes 设为目的地。检查点版本 2，逻辑时间 57，事件 12，记忆 23。这次留下了真实状态，完成测试尚未通过：运行在一次决定后停止，角色采的是通用资源。随后的可观看世界 `d61ebc81-1aed-40e1-8a4e-eda0a5d2a185` 给每个室内地点留了东侧门口，并把公开地点坐标交给角色；通用资源节点不再种在人身边。观看约三分钟：48 次请求、47 次完成、0 次失败，输入 158083、输出 49924。Spaulding 走到当铺地窖 (16, 1, 8)。Holmes 走到 (6, 1, 0)，Wilson 走到 (4, 1, 0)，两人都还在往地窖去的路上。Watson 跟到 (2, 1, 0)。检查点版本 2，事件 50，记忆 114。窗口关闭后世界停止。完成测试尚未通过。同日另发布可观看世界 `ff40a499-ce39-4d29-8e8c-4fb3b8a50c0b`：贝克街是书架和玻璃，当铺是砖，地窖是石头和圆石且没有窗，银行是石砖和玻璃，门口外有一圈圆石。观察者的脚在 y=1，与角色同高。远处只显示人名和地名，走近后最近的台词和地点说明出现在左侧。观看中 156 次请求、159 次尝试、155 次完成、4 次 transport_error，这 4 次随后都成功了。输入 564323、输出 247774。关闭窗口时还有 1 次请求没有返回。检查点版本 2，逻辑时间 505，事件 161，记忆 357。窗口关闭后世界停止。完成测试尚未通过。

## 按依赖推进

### 2026-10-30 最新 Actions 验证

产品提交 [`ffbfafc`](https://github.com/kikoiio/Wispiva/commit/ffbfafc224dcaa55585f4fc3337924e166d130fd) 的 [Actions 41123428488](https://github.com/kikoiio/Wispiva/actions/runs/41123428488) 全绿：单测、确认起源的 disposable 预览、Genesis 确认草稿到持久 Luanti 世界发布、确定性角色循环、正常重启后记忆恢复、live 暂停／改速／恢复和客户端验收通过；客户端截图保存在 artifact [ID 13010651422](https://github.com/kikoiio/Wispiva/actions/runs/41123428488/artifacts/13010651422)。这些结果验证自动化产品链路，不替代用户检查并确认自己的草稿或真人 3D 体验。

真实模型 Actions [41120418601](https://github.com/kikoiio/Wispiva/actions/runs/41120418601) 也全绿：三角色产品循环及反思恢复通过，四角色自由社会完成 96/96 决策、checkpoint 和关闭；动作计数为 advance 14、build 22、gather 27、inspect 8、wander 25。该轮 message、resource transfer、meeting 均为 0；模型尝试中出现 1 次 `invalid_action`、3 次 `invalid_response`、2 次 `provider_failed`，最终有界运行完成。受限并发回放与五类隔离 checkpoint 故障窗口均通过。它验证可完成这一轮工作，不证明自发互动、长期演化、跨存储事务或千级真实模型容量。

在新产品提交上复跑的真实模型 Actions [41124293328](https://github.com/kikoiio/Wispiva/actions/runs/41124293328) 同样全绿：三角色 24 次主循环请求、6 次反思写回；恢复后 36 次请求、9 次反思写回，三个角色都成功恢复。第二轮四角色长场景也完成 96/96 决策、checkpoint 和关闭；build 41、gather 42、inspect 10、advance 1、wander 2，message、资源转移、meeting 仍全部为 0。尝试中出现 3 次 `invalid_action`、4 次 `invalid_response`、1 次 `provider_failed`，有界重试后场景完成。连续两轮没有互动事件，是当前社会行为目标的明确缺口；下一步应增加公开标注的互动机会压力情境并与无引导基线分开报告，不把压力场景写成自发涌现。

为响应这一缺口，模型提示增加了“仅在有观察依据且能帮助共享任务时考虑协调；不编造需求或例行寒暄”的行为指引。真实模型 [Actions 41126749089](https://github.com/kikoiio/Wispiva/actions/runs/41126749089) 第一次尝试在第 84/96 决策后因 `model-response` 失败，没有 checkpoint；此前出现 4 次资源转移、0 次对白。相同提交的 attempt 2 完成 96/96、checkpoint 和关闭，但对白、资源转移、meeting 又全为 0。两次均无对白／会议，因此目前没有可重复的互动提升证据；这段提示属于待评估的产品假设。

审计随后发现前两轮 96 次模型请求中 `nearby_agents` 都为空。新增计数后，产品创建提示明确：用户描述共享社区时，居民默认从同一公共地点开始，除非用户要求分开；角色目标仍各自生成，不预设职业分工。新版真实模型 [Actions 41132741084](https://github.com/kikoiio/Wispiva/actions/runs/41132741084) attempt 1 的共起点使 12/12 个请求看见邻居（36 次邻居观察），但又在 12 次决策处遇到 `model-response` 失败。Attempt 2 的社会场景完成 96/96、checkpoint 和关闭；96/96 请求都看见邻居（288 次邻居观察），出现 1 次 give／资源转移，但 say 与 meeting 为 0。后续受限并发回放只有 22/24 次有效动作（2 次 `invalid_action`），吞吐约 1.19 请求／秒，严格负载门槛因此失败。此轮证明了起点可见性修复和一次转移行为，仍不证明稳定对白、会议、千级模型服务或全计划完成。

随后产品输入增加了最多 16 名邻居的公开姓名、位置和距离投影，私有角色目标与记忆继续排除在观察之外。产品回归 [Actions 41136799811](https://github.com/kikoiio/Wispiva/actions/runs/41136799811) 全绿。真实模型社会运行 [Actions 41136848017](https://github.com/kikoiio/Wispiva/actions/runs/41136848017) 的 attempt 1 在 68/96 决策后遇到连续无效响应，未写 checkpoint；不从该部分世界恢复。Attempt 2 完成 96/96 并提交 checkpoint：96/96 请求看到邻居（288 次邻居观察），发生 30 次 say／message、4 次 give／资源转移、0 次 meeting；动作包括 25 approach、10 gather、1 build。尝试中有 5 次 `invalid_action`、4 次 `invalid_response`、4 次 `provider_failed`，最终在有界重试下完成。后续并发 4 的真实模型回放 24/24 成功，吞吐 1.173 请求／秒；故障窗口检查和整条 Actions 均通过。与 41099553897 的 15 次对白和 3 次转移合看，互动已在两轮完成场景中观察到，但数量波动且没有会议；这不是稳定社会制度、长期涌现或千级 LLM 容量证据。

- [x] **产品目录迁移。** Wispiva 产品模块迁至仓库根目录，Luanti 运行时与 mod 收束到 `engine/luanti/`，验证工具和证据分别归档到 `validation/` 与 `evidence/`，更新工作流和文档路径；保留既有世界、运行时及原始测量证据。验证工作流和临时分支前缀已改为 `wispiva-validation.yml` 与 `validation/luanti-*`；[GitHub Actions 40823710390](https://github.com/kikoiio/Wispiva/actions/runs/40823710390) 在快照 `d909bf58f2ae5c2fa3d66ee9d1acbb558e280891` 上通过 Lua 5.1、引擎和恢复验证，[最新结构验证 40827303033](https://github.com/kikoiio/Wispiva/actions/runs/40827303033) 在快照 `5f6641191d65588b231cb5261a8649e76a8684ae` 上通过。历史日志中的旧绝对路径只作为原始证据保留。

  根目录迁移后的远端提交 `587bed2af9805025da3558dc6d79cf9e73a0e0c5` 已通过 [Actions 40890633717](https://github.com/kikoiio/Wispiva/actions/runs/40890633717) 的 Lua／Python 单测、引擎认知、复制恢复、资源动作、长期记忆重启和合成草稿预览；[原始产物及范围](../evidence/luanti/product-root-2026-10-29/README.md)已归档。真实模型、规模与产品体验不在本次验证范围。
- [ ] **统一创建与状态契约。** 盘点 `proto/world-genesis` 的创建草稿、规则、知情和模型调用接口，与本分支引擎及观察／动作模型比较；定义稳定世界、角色、空间、事件身份和输入投影，记录源码版本。确定世界／Luanti 的权威归属、提交与恢复协议，覆盖部分失败与冲突，不提前假设跨进程原子性。产品实现必须在启动时执行共同版本对账；无法证明状态对应同一提交时冻结世界并报告原因。

  [静态集成审查](design/2026-10-29-origin-integration-audit.md)记录了参考版本、创建起源与资源协调器不兼容、身份映射、知情、记忆和时钟缺口，以及假引擎到 Luanti 的验收顺序；该审查不等于契约或集成已经完成。

  [版本化起源契约提案](design/2026-10-29-world-origin-contract.md)限定单库与假引擎，定义身份、角色私有种子、资源事件、失败和恢复验收；实现、兼容迁移和真实引擎排他尚未完成。

  `world/origin.py` 提供起源事件和快照的纯函数原型，校验草稿摘要、世界 UUID、角色映射与私有种子；确认真实性、持久提交、授权视图和引擎对账尚未接入，不能当作已创建的持续世界。

  原型及现有运行时回归在 [Actions 40893574342](https://github.com/kikoiio/Wispiva/actions/runs/40893574342) 的提交 `831ba55c378715c2c8abba30557cef3ea2e1c623` 上通过；[产物与范围](../evidence/luanti/origin-2026-10-29/README.md)已归档，测试不覆盖起源与 Luanti 的集成。

  假引擎原型可在同库提交起源和资源事件、重放并对账，也可为单角色投影起始记忆。创建桥接从草稿库绑定修订、摘要、世界、操作和目标并冻结草稿，支持跨库重试；调用者仍负责获取真实用户确认、认证及授权。假引擎测试不证明 Luanti 持久性或安全授权。

  [Actions 40898042968](https://github.com/kikoiio/Wispiva/actions/runs/40898042968) 在提交 `ba4770a439e4f97cae8d310c253852db87884694` 上通过确认桥接、假引擎与既有 Luanti 回归；[产物及限制](../evidence/luanti/origin-integration-2026-10-29/README.md)已归档。

  当前实现已新增版本化 `wispiva-product-contract`：创建世界时把 `world_id`、`origin_event_id`、草稿 revision、draft hash、初始 commit version 和六类组件版本写入私有契约；`launch.py --require-product-contract` 在 Luanti 启动前校验身份文件、manifest、creation record 和契约的一致性，任何不一致直接拒绝启动。这个切片完成共同身份与启动对账，地图、库存、事件和记忆的跨存储原子提交仍未完成。

  新增 DraftStore 产品发布账本，持久绑定确认修订、world path、digest、origin event、operation ID 和 world ID；目录原子 rename 前为 `PUBLISHING`，精确完成后为 `PUBLISHED`，阶段残留或绑定冲突进入 `UNKNOWN/FROZEN`。版本 2 manifest／contract 和 creation record 共用 operation ID。Luanti 启动门禁从私有原始草稿重编译公开投影与角色映射，并只读核对起源 SQLite；版本 1 保持兼容路径。新增精确重试、未知阶段冻结和起源数据库篡改拒绝用例。产品分支 [Actions 41153022456](https://github.com/kikoiio/Wispiva/actions/runs/41153022456) 在提交 `857843c` 上失败：发布账本写入 manifest version 2，Luanti 运行时当时只接受 version 1，并在 `init.lua` 报 `invalid product genesis manifest`。运行时现在接受 version 1（不带 `operation_id`）和 version 2（32 位小写十六进制 `operation_id`）；空间投影仍只使用公开字段，忽略 `origin_draft` 等私有内容。本机用假模型加载了一个双地点世界：manifest version 2 通过启动，投影 386 个操作，完成 1 次决策和正常 checkpoint。提交 `4cce32b` 的 [Actions 41590168499](https://github.com/kikoiio/Wispiva/actions/runs/41590168499) 已通过：单测、确认起源预览、持久产品世界、暂停／改速／恢复和客户端验收均成功。该运行使用假模型，不替代真人三维验收或真实模型互动。该账本不提供跨存储原子事务，也没有 UNKNOWN 阶段的自动修复命令。

  当前分支还补有面向真实接入的受控边界：[launch.py](../engine/luanti/launch.py) 在启动 Luanti 前取得 [WorldSession](../engine/luanti/world_session.py)，将 [world_identity.py](../engine/luanti/world_identity.py) 与 [world_lock.py](../engine/luanti/world_lock.py) 组合成“先锁定、再核对身份、异常释放”的进程边界；确认起源的临时预览也经过同一启动器。身份文件独立于 SQLite，锁用 Unix `flock` 提供跨进程非阻塞独占。定向测试覆盖身份创建冲突、异常恢复、跨进程竞争、锁释放、进程异常退出、子进程生命周期和退出码传递。它仍只约束遵守协议的访问者，不能替代关闭玩家／mod／旁路写入，也不能证明地图、事件、库存和记忆的共同提交或断电持久性。

  `cognition/world_events.lua` 现已接入角色行动和接触：每次实际执行结果先提交为带稳定 `world-event:N` 身份的事件，按带运行命名空间的 `operation_id` 幂等；长期记忆的 L0/L1 记录引用该事件，角色快照、记忆和事件账本在正常停服 checkpoint 中一起保存，恢复时一起加载。Lua 定向测试覆盖事件序列、重试、参数冲突、复制和损坏拒绝；[Actions 40919986392](https://github.com/kikoiio/Wispiva/actions/runs/40919986392) 已在真实 Luanti 主循环中通过首轮运行、保留记忆恢复、清空心智恢复、资源动作、长期记忆和确认起源预览。当前只读审查发现资源节点和库存仍分开修改，地图和数据库仍缺少共同事务，以及引擎时间尚未接入逻辑时间。后续先在禁止其他写入者的隔离小区域验证单类资源：以带世界身份和版本的提交为权威、冻结区域、执行并回读投影、重启先对账再开放；对未知状态或不一致应停止。这个协议尚未实现或验证，不能套用于普通玩家可改写的整个世界。

  最新真实模型 Actions `41037865211` 通过五个隔离 checkpoint 故障注入点（地图投影后、环境后、角色后、commit 前、commit 后）：每个注入都保留 recovery marker，重试可运行，源世界未变化。它验证的是复制世界中的恢复路径；不等于地图、库存、事件、记忆多存储的原子事务或断电级耐久性。

  当前实现已补上第一条产品纵向切片：`genesis/world_create.py` 在确认修订和起源 SQLite 未推进时，原子发布带 `wispiva-world-id`、私有 `wispiva-origin.json`、起源副本、Luanti mod 和 `server.conf` 的新世界目录；`engine/luanti/run_product.sh` 通过同一 `WorldSession` 启动它。Luanti 启动时读取 manifest，使用 `world_projection.lua` 写入地点、室内外结构、语义连接和角色起点，再按角色向模型请求注入 role、goal 与 genesis seeds。首次运行把起源写入长期记忆 L0/L1，环境过程写入事件账本；正常停服后 `--resume` 已在 [Actions 40928557051](https://github.com/kikoiio/Wispiva/actions/runs/40928557051)、[Actions 40938747760](https://github.com/kikoiio/Wispiva/actions/runs/40938747760)、[Actions 40941108961](https://github.com/kikoiio/Wispiva/actions/runs/40941108961) 和最终 [Actions 40956198179](https://github.com/kikoiio/Wispiva/actions/runs/40956198179) 中恢复角色、长期记忆、环境快照和产品提交版本。最终运行还自动验收了持久产品世界的 Luanti 客户端连接、场景交互和引导到达，并验证重启不覆盖已投影地面，空气动态区可继续承载资源与标记。完整范围与限制见[持久产品世界证据](../evidence/luanti/product-world-2026-10-29/README.md)及[产品状态与模型输入证据](../evidence/luanti/product-state-model-input-2026-10-29/README.md)；地图／事件／库存／记忆仍不是跨存储原子提交。
- [ ] **用户意图到世界起点。** 从任意文本或用户指定素材形成可编辑草稿，包含地点、角色、关系、当前状态、可用规律、初始经历和三维布局；明确未知及假设。执行引用、空间可达、资源和知情检查，展示草稿并由用户确认；失败不覆盖现有世界。至少使用两个非固定题材，持久世界必须保留创建输入、草稿版本、确认记录和公开／私有边界。

  已在 [两份合成题材草稿](../evidence/luanti/genesis/2026-10-29-model/summary.md)中使用配置的真实模型生成结构有效的输出，并在 [一次性 Luanti 预览](../evidence/luanti/genesis/2026-10-29-preview/summary.md)中验证确认草稿能够进入引擎、生成角色并记录事件；这不代替用户自己的意图体验、语义隐私审查或可执行世界验收。

  持久创建入口和 CLI 已接上；`DraftStore.create_from_intent` 现在保存原始 intent，确认前可编辑，确认后的产品 manifest 和 `creation.json` 保留私有 intent 摘要。编译器现在允许最多 64 个角色，并按地点提供确定的 25 个起点槽位。新增[两个非固定题材产品案例](../evidence/luanti/genesis/2026-10-29-product-intents/summary.md)，分别覆盖草稿 v1→v2、确认 revision 2、私有角色目标／记忆和公开投影隔离；固定 `example.json` 仍只作为回归夹具。产品验收仍需真实用户确认和语义隐私审查。

  [Genesis CLI](../genesis/README.md) 现在提供 `read --draft-only` 导出和 revision-checked `edit`，用户可编辑 JSON 草稿、再次检查新 revision，再显式确认；stale edit 和确认后的修改会失败。它让草稿编辑／确认可直接操作，但仍不是图形化创建向导，也没有把公开／私有预览呈现在一个用户界面中。

  [真实模型 Actions 41037865211](https://github.com/kikoiio/Wispiva/actions/runs/41037865211) 新增“small frontier settlement”自由社会用户意图，模型生成草稿、通过引用与空间编译、确认并创建持久 Luanti 世界。生成器现在对无效 JSON／schema 最多进行三次有界尝试，重试只带字段路径和错误码；仍未通过就不创建草稿。此合成用户意图验证了可运行链路，不代替真实用户编辑和确认体验。
  [真实模型 Actions 41069246124](https://github.com/kikoiio/Wispiva/actions/runs/41069246124) 又将英文题材和中文河谷自由聚落意图送入同一生成器；三份草稿均通过 schema 和空间编译。该动作只生成草稿，不代表用户确认或持久创建；此首轮的模型 token usage 未被适配层暴露，现已补上审计回调，待新运行复核。
- [ ] **空间与三维体验。** 为已确认世界构造地面、建筑、连接、物件和实体，提供合适的进入点与镜头。角色具备可辨认外观和行动反馈，对话与变化在世界内可见；行动与场景对应同一事实。产品服务器已支持 `--serve`，`view_product.sh` 可用真实 Luanti 客户端从观察者出生点连接；[Actions 40956198179](https://github.com/kikoiio/Wispiva/actions/runs/40956198179) 已自动验证连接、场景交互和引导到达，[Actions 41037867018](https://github.com/kikoiio/Wispiva/actions/runs/41037867018) 在产品世界重新验证客户端连接与确定性交互，最新 [Actions 41110698741](https://github.com/kikoiio/Wispiva/actions/runs/41110698741) 通过客户端验收并上传了实际 Luanti 画面 artifact [13002868352](https://github.com/kikoiio/Wispiva/actions/runs/41110698741/artifacts/13002868352)。自动验收不再使用会误伤引导角色的随机输入。角色移动接入 `cognition/navigation.lua` 有界 BFS；地点连接投影也会确定性绕开第三方地点。仍需真人实际进入 Luanti 评价移动／观察／互动，并继续扩展楼梯、外观和题材生成器。
- [ ] **记忆从起点进入主循环（当前为部分完成）。** 建立 L0 已提交事件／原文、每个观察者独立的 L1 当时经历、可版本化 L2 反思；从一致前史建立私有记忆种子。事件完成后按实际感知与知情写入来源；按本人权限和情境检索，为角色组装上下文。模型输入必须显式区分事实、本人经历、私有种子、传闻、未知、当前观察和可执行动作反馈；保存恢复后消息 inbox、上次动作反馈、来源和版本稳定。检索现在对汉字词串增加相邻二元组匹配，但仍没有语义／同义词理解。六组社交压力测试 [Actions 41144262599](https://github.com/kikoiio/Wispiva/actions/runs/41144262599) 显示记忆开／关 say/message 82 对 84、build 5 对 10，逐组交流方向各半，尚不支持稳定互动提升。独立六任务记忆评估两个新批次共 8 seeds、96 次请求：[41149546110](https://github.com/kikoiio/Wispiva/actions/runs/41149546110) retrieval 22/24，[41150339826](https://github.com/kikoiio/Wispiva/actions/runs/41150339826) retrieval 20/24；合计 retrieval 42/48、FIFO 1/48、目标证据选择 48/48。第二批因 FIFO 臂一次 `invalid_action` 严格失败；两批中文短线索共 2/8，不能说明语义理解稳定。下一步应加入不同知情、来源传递与语义改写的独立事件序列，并评价长程反思事实性。

  [真实记忆 Actions 41063917433](https://github.com/kikoiio/Wispiva/actions/runs/41063917433) 使用配置模型完成 5 类任务 × 3 seeds × FIFO／retrieval，共 30 次调用（含汉字短线索回忆），并完成另一个 24 次调用的并发探针；两步均通过完整 token 审计且没有 provider／适配器错误。[artifact-only 评分 Actions 41082448598](https://github.com/kikoiio/Wispiva/actions/runs/41082448598) 未再次调用模型，汇总为 retrieval 13/15、FIFO 0/15，15 对中 retrieval 胜 13、平 2；中文短线索 retrieval 1/3，其余四类各 3/3。retrieval/FIFO 分别使用 10,746/10,665 个 provider tokens，错误数均为 0。最新扩展对照 [Actions 41105494227](https://github.com/kikoiio/Wispiva/actions/runs/41105494227) 加入同 query、同 seed 事件流和答案下的中文短线索／明确逐字提取对照，6 类 × 3 seeds × 2 策略共 36/36 次真实模型调用，无 provider errors：retrieval 15/18（83.3%），FIFO 0/18，全部 18/18 retrieval 请求选中了相关记忆。短线索任务 0/3，明确提取任务 3/3；另外四类 retrieval 任务均 3/3。汇总 artifact [ID 13001097625](https://github.com/kikoiio/Wispiva/actions/runs/41105494227/artifacts/13001097625) 不含原始答案；此小样本只检验固定合成题，不证明长期记忆质量或自然语言语义检索能力。

最新诊断 [Actions 41093281007](https://github.com/kikoiio/Wispiva/actions/runs/41093281007) 在另一批 30 次真实配置模型任务中直接计数所选上下文是否含有题目对应证据，整个评分工件仅保留布尔和计数。Retrieval 选择覆盖 15/15 但正确回答 12/15；FIFO 选择覆盖与正确回答均为 0/15。中文短线索 retrieval 证据选择 3/3、作答 0/3，定位为模型收到相关记忆后未给出精确答案，而非记忆筛选遗漏；其余四类 retrieval 任务各 3/3。Retrieval/FIFO token 分别为 10,735/10,552，provider errors 为 0，artifact [ID 12994903837](https://github.com/kikoiio/Wispiva/actions/runs/41093281007/artifacts/12994903837)。追加的同 query／同 seed 中文任务 [Actions 41105494227](https://github.com/kikoiio/Wispiva/actions/runs/41105494227) 完成后短线索精确作答为 0/3、明确逐字提取 3/3。提示加入“短 query 是线索、在直接证据下逐字提取、无证据不猜”之后，[Actions 41107598621](https://github.com/kikoiio/Wispiva/actions/runs/41107598621) 的短线索是 1/3，明确提取仍是 3/3，检索仍选中目标证据 18/18。由于只有 3 个 seeds，真实模型输出有不确定性；这个小幅观察差异不能归因于提示改动。下一步要扩展语义改写、独立 seeds 和长世界记忆评估。

  `model/origin_context.py` 提供离线输入原型，验证世界与持久角色映射，以白名单组合本人的起始记忆和调用方提供的观察；产品 Lua 主循环现已接入 `wispiva.model-input` v1，bridge 会在 provider 前校验来源和 audience。当前新增 `genesis.public` fact，将确认草稿的公开标题／描述投影到每位角色自己的 envelope；它沿用 v1，并为传感器 facts 留出槽位，绝不把原始 intent 或其他角色私有种子并入共享事实。`cognition/long_term_memory.lua` 提供受约束的 `store:reflect(owner, topic, experience_ids, text, time, source_id)`，自动生成连续 topic version，并拒绝跨角色、重复或空的 L1 来源；`model/reflection.py` 提供 source-grounded 的 L2 provider 输入和返回校验，`model/reflection_host.py` 与 `cognition/reflection_apply.lua` 提供跨 Python/Lua 的受控写回边界。Actions [41010708756](https://github.com/kikoiio/Wispiva/actions/runs/41010708756) 已在真实产品世界中验证 3 个角色的 18 次真实决策、私有起始种子、目标消息来源隔离、动作反馈、有限重试和一次真实 L2 反思；`reflection-result.json` 记录 4 个 Cora L1 来源和 841 个总 tokens。当前代码已接入按 `--reflection-every` 调度的真实反思：仅选本人持久 L1，响应按原请求来源子集校验后写入 L2；最新主题版本以独立 `reflections`／`belief` 槽位进入后续决策。每轮启动隔离 spool 和审计目录，避免旧响应重放。[Actions 41025066379](https://github.com/kikoiio/Wispiva/actions/runs/41025066379) 已验证三个角色 36 次决策、9 次真实 L2 写回、后续检索及重启保留。反思质量、崩溃窗口和大规模真实 LLM 容量仍未完成。
  最新 [Actions 41037865211](https://github.com/kikoiio/Wispiva/actions/runs/41037865211) 对三角色再完成 24 次真实模型决策（`say=9`、`gather=6`，另有 inspect／wander／advance），并完成反思写回、重启后的 12 次决策以及四角色世界的 24 次决策。成功 `give` 现在也向双方私有长期记忆记录转移事实；自由社会这一轮实际触发 1 次 give，写入 61 条记忆记录并成功 checkpoint。该回合 `say=0`，因此不能据此声称社会交流自发涌现。跨存储事务、长期运行质量和更大规模 LLM 仍未完成。
- [x] **真实角色与环境闭环。** 模型在局部观察和授权记忆下提出意图；执行器检查当下条件并反馈实际结果。实现可组合的移动／通行、观察、对白、物品转移及少量可交互对象；建立至少一个环境自身持续过程和有后果的资源关系。行动失败、过期请求、冲突和模型不可用不伪装成成功。

  `cognition/environment.lua` 已提供可恢复的逻辑时间资源再生／耗减过程；产品 Luanti 主循环将过程结果提交到世界事件账本，并把资源节点投影到边界区域。模块测试已覆盖条件变化、恢复和重复推进。真实模型产品切片在同一世界中完成了 18 个决策、4 次对白、6 次 gather、inspect、approach、wander，并记录资源成功与 `resource_mismatch` 失败、动作反馈、token、延迟和重试；范围仍限于 3 个合成角色和单个受控世界，不能外推到长期运行或大规模角色。
- [ ] **持续时间与恢复。** 实现暂停／恢复、进程退出冻结、无观看运行和重连；按照共同目标测可调速和默认 24× 的可行性，模型或验证等待不补算。世界、过程、历史和角色记忆以可验证的协议一致保存，测试崩溃窗口、重试幂等及不重复结算。

  产品接口已有 `control.py` 和 `/wispiva pause|resume|speed|status`，逻辑时钟会在暂停或模型等待时停止累计。[Actions 41079793257](https://github.com/kikoiio/Wispiva/actions/runs/41079793257) 已在 live 服务验证暂停后逻辑时间保持、暂停时改速、恢复后继续前进。无客户端长期运行、暂停期间断线／重连、离线时间和跨存储崩溃一致性仍未覆盖。

  当前实现已有逻辑时间控制文件接口和 `/wispiva pause|resume|speed|status`，产品主循环会把模型等待、暂停和离线时间分开计量；启动器会在异常后保留 recovery marker，并在 checkpoint、事件、记忆和环境时钟一致后才清理。[Actions 41037865211](https://github.com/kikoiio/Wispiva/actions/runs/41037865211) 已通过五个 checkpoint 故障窗口，全部验证 marker 保留、恢复重试和源世界不变；另以并发 4 完成 24 次已审计请求的负载回放。这是有限调用批次和隔离复制世界结果，不代表供应商容量、千名 LLM 角色服务或长期稳定性。暂停／无观看／重连真人验收及默认 24× 目标仍未完成。

  新增 `engine/luanti/launch.py --world <世界目录> --recover-committed-checkpoint`，用于恢复“checkpoint 已完整提交、但 launcher 尚未来得及清除 marker”的窄崩溃窗口。命令先拒绝仍在运行的 Luanti server，再在独占世界会话和产品契约校验下核对 `READY`、无 pending commit、无活动 run、记忆／事件计数和逻辑时钟；只有全部一致才清除 marker。面对未完成的自由社会长场景，该命令应拒绝，不能把部分状态变成可运行状态。云端 Actions [41116220558](https://github.com/kikoiio/Wispiva/actions/runs/41116220558) 已通过新恢复用例、产品回归、持久世界恢复和客户端验收；跨多存储事务、回滚长运行中未提交地图变化和真人恢复体验仍未解决。
- [ ] **端到端体验与证据（当前为部分完成）。** 对真实用户意图运行完整链路，记录版本、初始状态、每次真实模型调用和角色可见输入、行动、世界变化、私有记忆来源及失败。做真人体验和实际三维交互验收；报告模型、token、延迟、等待、运行时间与覆盖范围，不能将夹具或规则策略标成真实模型。

  Actions [41037865211](https://github.com/kikoiio/Wispiva/actions/runs/41037865211) 曾验证对应提交 `6d160dd` 的三角色真实动作、反思和恢复、用户意图自由社会、24 次并发受控请求回放及五类 checkpoint 故障；其含私有记忆的原始 artifact 和公开日志已撤下，聚合结果保留在[证据页](../evidence/luanti/product-model-2026-10-30/README.md)。[Actions 41037867018](https://github.com/kikoiio/Wispiva/actions/runs/41037867018) 验证产品世界 Lua/Python 回归、持久世界恢复和自动 Luanti 客户端交互。仍缺真实用户意图确认、真人三维评价、真实世界长期运行和全局多存储事务证据。

上述项目可在契约确定后并行推进空间呈现、创建流程、记忆和角色闭环，但共享世界事实、事件与提交协议必须先确定。重型构建、集成、浏览器自动化和较大模型实验优先使用用户已授权的 GitHub Actions 免费资源；运行前告知用途、所需仓库／Actions 权限及数据范围，密钥不进代码或产物。仅在确需本机交互时本地运行，控制内存、临时目录和显存。实际模型供应商免费额度与适用范围须核实，不能把授权理解为允许产生费用或上传私有数据。

## 必须覆盖的纵向场景

1. **不同知情与记忆**：一人私下告知另一人，第三人不在场；之后出现相关情境，核对各人观察、记忆来源和行为。允许误解或转述，但不让第三人无来源地知道。
2. **行动与真实后果**：角色尝试获得、交付或使用有限物件；成功和失败都要反映在库存、世界、事件与经历中，不能只生成叙述。
3. **环境持续与条件变化**：用户设定的一个可追踪过程自行推进；中途条件变化后重新判断未发生的结果，不将旧预测当作事实。
4. **重启与离开**：客户端断开时引擎继续；引擎退出后冻结，恢复不补算离线时间、不重复动作或结算。比较恢复前后的状态、历史和各人记忆。
5. **真实三维观看**：用户进入场景，看见并理解至少一次互动及其后果，能回查事件和相关经历；外观与可理解性由用户评价。

所有场景均使用受控的已知起点及独立检查；真实模型输出、失败与重试完整计数。固定种子不证明模型行为可重放，已保存事实读取也不得靠重新调用模型重造。

不同知情的当前验收是 `validation/knowledge_boundary.py`。Alice 与 Bob 从院子出发，Cora 在无路径相连的远处山脊；两人即使各走 6 次、每次 2 格，切比雪夫距离仍大于默认感知半径。Alice 的私有种子里有一个不会被猜中的标记，目标要求她只对 Bob 说出。审计核对每人模型输入里的种子、目标、标记出现位置和来源，以及日志中的送达哈希。标记只能留在 Alice 自己的种子或她说出之后 Bob 的 `agent_message` 记录里。Cora 的输入不能出现该标记，也不能把 Alice 或 Bob 当作邻居。公开摘要只保留计数和失败码，不复制对话原文。结果以分支 `validation/luanti-product-model-knowledge-20261103` 的 Actions 为准。

提交 `59a3e4d` 的 [Actions 41594198130](https://github.com/kikoiio/Wispiva/actions/runs/41594198130) 通过这次验收。当时仓库变量 `LLM_MODEL` 为 `GLM-5.3-Flash`，`LLM_BASE_URL` 指向 SCNet 的 Anthropic Messages 端点。Alice、Bob、Cora 各 6 次决策，共 18 次请求和 18 次响应。19 次尝试里有 1 次 `transport_error`，世界随后完成。含标记的发言送达 Bob 2 次，Bob 之后的请求里有来源为 `agent_message` 的传闻。Cora 的 6 次请求都没有该标记，邻居列表里也没有 Alice 或 Bob。输入 token 37747，输出 token 14482。checkpoint 已提交，公开摘要的失败码为空。更早的 [Actions 41592566511](https://github.com/kikoiio/Wispiva/actions/runs/41592566511) 在发出 provider 请求前以 `invalid_config` 结束，原因是 workflow 仍引用已经清空的旧配置名；那次没有模型动作。本轮关闭了反思，只覆盖这一条受控短场景。行动后果、环境条件变化、重启对照、真人三维观看、稳定社会和千级模型容量仍未由此证明。

第 2 到第 4 条的当前验收是 `validation/longitudinal.py`，结果以分支 `validation/luanti-product-model-longitudinal-20261103` 的 Actions 为准。三条都从已确认的已知草稿启动，反思关闭，公开摘要只保留计数和失败码。

行动与真实后果：Alice 从院子 `(-2, 1, -2)` 出发，东侧一格 `(-1, 1, -2)` 有一个 `society:resource`。目标要求第一次采集该点，第二次再采集同一点并失败。审计要求事件账本里这一格有一次成功采集，原因是 `world-verified`，以及一次失败采集，原因是 `resource mismatch`；Alice 的经历记下这两次结果；成功采集数减去成功放置数等于库存里的 `society:resource`；最后一条资源守恒核对为真。

环境持续与条件变化：过程从存量 4、速率 2、容量 16 开始。逻辑时间越过 2 时，先按旧速率结算到该时刻，再把速率改为 0，结算后存量为 8。种子里的 `stock-prediction-4` 只留在未知中，不能进入当前事实。至少一次模型请求的观察时间不早于这个边界。日志要有 `ev=environment-condition at=2 rate=0 amount=8`。

重启与离开：单独一个世界先完成一轮无客户端的模型决策并提交 checkpoint，等待数秒墙钟后再 `--resume`。恢复日志记下离线秒数，逻辑时间停在 checkpoint，不把离线秒数乘速率加进时钟。第一轮的事件 `operation_id` 和记忆 id 都还在，决策计数继续增加。日志里没有玩家加入。这检查引擎在没有客户端时能跑完，并在退出后从冻结点恢复。用户断开正在观看的客户端，仍由第 5 条真人观看评价。

第 5 条由用户执行 `engine/luanti/run_product.sh --serve` 后，用 `engine/luanti/view_product.sh` 进入场景评价。误解或转述不在这三条例的范围内。

提交 `b5cb073` 的 [Actions 41606793098](https://github.com/kikoiio/Wispiva/actions/runs/41606793098) 通过第 2 到第 4 条。当时 `LLM_MODEL` 为 `GLM-5.3-Flash`。三个世界各完成 checkpoint，公开摘要的失败码都为空，12 次请求和 12 次尝试都没有错误。

行动后果：4 次请求，输入 token 7426，输出 token 1718。同一格先出现 `world-verified` 的成功采集，再出现 `resource mismatch` 的失败采集，库存为 1。环境条件：4 次请求，输入 token 6500，输出 token 751。结算后存量 8、速率 0、逻辑时间 109，`stock-prediction-4` 仍只在未知中，并有观察时间不早于边界的请求。重启：两次运行合计 4 次请求，输入 token 6471，输出 token 321。离线 6 秒，恢复时逻辑时间停在 9，决策从 2 增到 4，没有玩家加入。

更早的 [Actions 41605610701](https://github.com/kikoiio/Wispiva/actions/runs/41605610701) 在同一类场景里把 Luanti 写出的整数 `8.0`、`2.0` 判成类型错误。那次公开摘要里的世界计数已经符合上面的条件，随后的验收修正才进入这次通过的运行。同一提交的产品回归 [Actions 41606801741](https://github.com/kikoiio/Wispiva/actions/runs/41606801741) 已通过。这三条例不证明误解或转述、稳定社会、真人三维观看或千级模型容量。

## 里程碑之后

- 完善情境反思、长期矛盾信念和检索质量；比较同预算记忆策略，记录真实输出与独立评分。
- 支持对话、任意角色附身、固定基准干预与多世界线；继承分岔点历史和各人记忆，后续独立。
- 依次验证几十、几百及更大规模真实模型角色，区分具身实体容量、决策频率、队列等待、供应商限流、费用和互动质量；不把万级规则实体当万级 LLM。
- 根据使用证据决定更复杂世界规则、建筑风格和客户端形态；视觉质量、通行、性能与模拟正确性分别验证。

## 已有证据与限制

实验中 Luanti 服务端实体、局部范围观察、受限动作、少量真实模型闭环、停服快照和检索实验已运行，见[实验说明](../validation/luanti/README.md)及[历史实验计划](../validation/luanti/PLAN.md)。10,000 角色预算调优为完整规则负载：65 ms 设置五次通过当时的步频门槛、决策间隔中位约 4.97 秒，并未满足 2 秒目标；不是万级模型容量。[受控记忆任务](../evidence/luanti/model/2026-10-28-retrieval/summary.md)中检索 12/12、FIFO 0/12，任务范围有限，不能外推长期世界。目标创建链路、持续环境、完整主观记忆、通用真人参与和产品级视觉均尚未验收。

## 最新自由社会长场景与 marker 恢复

四角色每人 24 次真实决策预算的长场景完成 91/96 次决策，出现 32 条对白事件和 2 次资源转移，没有 meeting。最后一个响应在三次重试后仍失败，因此世界没有 checkpoint，启动器保留 recovery marker；这不是完成世界的证据。产品证据见 [Actions 41113101332](https://github.com/kikoiio/Wispiva/actions/runs/41113101332)。恢复命令只清理完整 checkpoint 已提交后的遗留 marker，不会修复这个未完成世界。恢复测试夹具首次失败于身份初始化顺序（Actions 41115517669），修正后的 [Actions 41116220558](https://github.com/kikoiio/Wispiva/actions/runs/41116220558) 已通过。
