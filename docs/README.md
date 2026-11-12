# 文档索引

合入保护：禁止 `prototype`、`proto/*`、`prototype/*`、`experiment/*` 和所有 `wispiva/*` 分支直接合入 `main`。

分支职责：`main` 是主产品线；`prototype` 是原型线；`wispiva/luanti` 是以 Luanti 为底座的产品尝试。当前 `wispiva/openstory` 由 Redis 保存权威状态，Ray 计算候选行动与投递，服务端调度并原子提交；网页提供故事、地图和程序生成 3D。运行方式见[根目录 README](../README.md)，当前实现与限制见[架构](architecture.md)。这些分支各自演进，不整体合入 `main`。

| 类型 | 状态 | 更新 / 核对 | 文档 |
| --- | --- | --- | --- |
| 项目意图与需求 | 产品目标；术语使用“创建世界” | 2026-10-28 | [项目意图](intent.md) |
| 当前架构 | OpenStory 模块与 API；单元、Ray/Redis、浏览器云端检查通过及限制 | 2026-11-12 | [当前架构](architecture.md) |
| 安装与运行 | Python 3.12、Redis、模型配置、服务端运行与限制 | 2026-11-12 | [项目入口](../README.md) |
| 目标架构 | 草案；不等同于已实现 | 2026-10-28 | [目标设计](design/2026-10-27-target-architecture.md) |
| 计划与证据 | 当前状态、素材入口进展、下一步和必要证据 | 2026-10-28 | [工作计划](PLAN.md) |
| 研究 | 综合材料；文件名前缀为研究日期 | 2026-10-28 | [世界模型](research/2026-10-28-world-models.md)、[记忆](research/2026-10-28-memory.md)、[3D 生成](research/2026-10-28-3d-generation.md)、[Minecraft 社会](research/2026-10-28-minecraft-agent-societies.md)、[Mineflayer / Voyager](research/2026-10-28-mineflayer-voyager.md) |
| 原始素材 | 故事原文，导入模拟尚未实现 | 见计划 | [《红发会》](source-texts/sherlock-holmes/the-red-headed-league.txt) |
| 原型 | 分支快照；不整体合并主线 | 2026-10-28 | `prototype`，`README.md` |
| 独立实验 | 现行实验线在 `wispiva/luanti`；Minecraft 社会实验分支已删除，M0 记录仍可查 | 2026-11-03 | `wispiva/luanti` 的 `evidence/luanti/agent/m0-2026-10-27.md`；原始实验说明在提交 `7e33189` 的 `experiments/minecraft-societies/README.md` |
