# 原型架构

核对日期：2026-11-05。本文描述当前实现；产品目标见[项目意图](intent.md)，安装与使用见[README](../README.md)。

## 模块与数据流

| 入口 / 模块 | 职责 |
| --- | --- |
| `server.mjs`、`ui/` | 本机 HTTP、API、SSE，以及创建、三维场景和世界动态界面 |
| `world-creation.mjs`、`creation-dialogue.mjs` | 创建对话、建造回路、取消与恢复 |
| `world-genesis.mjs`、`genesis-records.mjs` | 分阶段生成世界起点，校验候选结果，等待作者确认 |
| `voxel-*.mjs`、`creation-attempt.mjs` | 体素编辑、对象归属、撤销／重做与世界语义绑定 |
| `geometry/` | 场景契约、几何编译与有限空间检查 |
| `world-definition.mjs`、`core.mjs`、`actor.mjs` | 世界规则、时间、角色观察与行动裁定 |
| `activity.mjs` | 将已提交变化投影为世界动态 |
| `model/` | 模型配置、协议客户端、生成结果解析与素材检索 |

创建按“作者意图 → 模型候选 → 程序校验 → 保存 → 画面”推进。讨论不执行建造；自动建造读取每轮最新体素与诊断，先处理可确定的局部修复，再按需请求模型。命令数、轮次和请求时限集中在 `creation-limits.mjs`。失败或中断保留已提交结果，刷新或重启不会自动请求模型。

确认起点后，角色根据自身可见信息提出行动，由模拟器验证并提交后果。作者界面可查看全局状态，角色输入受信息边界限制。创建、预览与运行使用已保存的同一体素内容；人物只有在找到安全支撑面和净空时才显示实体，否则显示地点级状态。

## 配置与存档

`model/config.mjs` 从进程环境变量或 `.env` 读取配置，环境变量优先；`WISPIVA_ENV_FILE` 可指定配置文件。字段见 [`.env.example`](../.env.example)。客户端支持 Responses、Chat Completions 和 Anthropic Messages，兼容性需按实际端点验证。

`.data/prototype/` 保存创建过程、世界状态与归档。体素、对象归属、撤销／重做历史和对话结果一起写入 `creation.json` 的 `voxelSnapshot`，文件替换成功后才更新内存；旧独立体素文件仍可迁移。损坏或不支持的创建存档会阻止启动并保留原文件。运行状态与创建状态分文件保存，不具备跨文件事务。

页面关闭后，仍在运行的服务可以继续推进世界；服务退出时冻结，重启不补算离线时间。完整历史仍驻留内存并整体写入文件，长期容量和断电耐久性尚未验证。

## 验证入口与边界

| 入口 | 范围 |
| --- | --- |
| `npm run check` | 自动发现并串行运行 `tests/*.test.mjs`、`tests/observe-*.mjs`、`model/observe-*.mjs`，检查 UI JavaScript 语法；使用合成模型，不读取私有配置、不调用真实模型、不启动浏览器 |
| `npm run benchmark:voxel` | 756 与 5,000 方块样本的上下文大小、快照大小、重载数量及总耗时 |
| `npm run soak:simulation` | 1–14 个模拟日的合成世界与进程重启检查 |
| `.github/workflows/prototype-preview.yml` | 离线检查与合成模型浏览器流程 |
| `.github/workflows/live-model-loop.yml` | 使用仓库配置验证真实模型建造与修复回路 |
| `.github/workflows/prototype-soak.yml` | 云端运行合成世界 soak，只上传指标 |

当前模拟只覆盖有限地点、资源、条件过程和角色信息隔离。空间诊断只检查受支持的单层矩形建筑；隐私审计只能拦截部分泄漏。检查通过不能证明任意建筑可通行、自然语言推理安全或视觉体验合格。复杂物理、大型世界、连续寻路、长期主观记忆与自由分岔尚未完成或验证。
