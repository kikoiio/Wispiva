# 当前架构与分支边界

核对日期：2026-11-12。本页描述 `wispiva/openstory`，产品目标见 [intent.md](intent.md)，未来方案见 [目标架构](design/2026-10-27-target-architecture.md)。本分支独立演进，不整体合入 `main`；`prototype` 和 `wispiva/luanti` 是其他实验线，其历史证据不能替代本分支的验证。

## 当前数据与运行路径

| 入口 / 模块 | 实际职责 |
| --- | --- |
| `kernel/server.py` | 本机 HTTP API、静态文件和服务生命周期；入口 `python -m kernel.server`。 |
| `kernel/controller.py` | 串行化世界编辑与推进、服务端调度、失败等待与退出取消。浏览器关闭不影响自动推进，重启不补算离线时间。 |
| `kernel/runtime.py` | Ray 的 Pod 计算角色候选行动，System 投递并推进候选状态；两者不直接写 Redis。失败后不自动重做角色决策。 |
| `kernel/store.py` | Redis 权威状态；版本比较阻止旧写覆盖新写。完整事件追加保存，每次成功写入保存不可变 revision。控制状态与一拍结果在同一事务中提交。 |
| `kernel/sim.py` | 地点、路径、角色、同地通信与地点准入裁定；角色收件箱持久化，离开的人物归档，ID 不复用。 |
| `kernel/decide.py` | 角色观察视图与模型行动解析。模型输入不带完整 origin、远处实时位置、他人记忆或默认私有规则。只有显式 `public: true` 规则公开。 |
| `kernel/compile.py` / `kernel/model.py` | 明确区分模型创建与规则演示；模型请求失败或无效输出不以脚本冒充成功。配置入口见根 README。 |
| `view/` | 故事书从结构化事件与人物快照重建当时场景；前端通过服务端运行控制和状态同步观察世界。3D 为程序生成，保留故事与地图入口。 |

当前状态、全量事件和不可变 revision 分开存储；事件日志只追加一次，各 revision 引用当时事件数量，读取旧节点不调用模型。创建新世界产生独立 world_id，不删除之前世界的历史。旧版 hash 格式在启动时迁移，原键保留；已被旧版截掉的历史无法恢复。

服务器默认暂停新世界。`POST /api/world/run` 的 `running` 与 `interval` 控制后台调度，间隔为 0.2–3600 秒；该间隔是推进节拍，不是已经实现的 24× 世界时间模型。模型失败会设置 `waiting/error` 并停住，用户可显式重试。停止允许正在计算的一拍完成，退出取消尚未提交的计算。

## 检查与恢复入口

| API | 行为 |
| --- | --- |
| `GET /api/status` | 模型是否配置、Redis 是否可达；不返回密钥或 Redis URL。 |
| `GET /api/world` | 当前世界、revision、模式和运行 / 等待状态。 |
| `GET /api/worlds` | 已保存世界的 ID、名称、tick 和 revision。 |
| `POST /api/worlds` | 根据 text、use_model 创建新世界；失败保留旧世界。 |
| `POST /api/world/tick` | 手动计算并原子提交一拍；忙碌 / 版本竞争为 409，运行失败为可检查的 JSON。 |
| `POST /api/world/run` | 启动、停止或显式恢复后台模拟。 |
| `POST /api/world/agents`、`DELETE /api/world/agents/<id>` | 加入与离开人物；与推进共享提交保护。 |
| `GET /api/world/history?world_id=…&offset=0&limit=50` | 分页读取 revision 索引，limit 最大 100。 |
| `GET /api/world/history/<revision>?world_id=…` | 读取当时的状态与历史，不重新生成；可读取先前被替换世界的节点。 |

## 证据与边界

本机只做轻量检查：`scripts/test.sh` 运行 Python 回归与 Node 测试；Redis 测试使用私有 Unix socket、32 MiB 上限，并清理自己启动的进程。回归涵盖消息跨保存恢复、模型知情隔离、失败整拍回滚、完整事件、人物归档、不可变历史、版本竞争、跨控制器停止、关闭后禁止提交和 HTTP 契约。

云端 [单元检查](https://github.com/kikoiio/Wispiva/actions/runs/43215889392)、[真实 Ray/Redis 集成](https://github.com/kikoiio/Wispiva/actions/runs/43215889452) 和 [浏览器验收](https://github.com/kikoiio/Wispiva/actions/runs/43215889580) 在整合提交 `8e0a84f` 通过。集成脚本 `scripts/verify-runtime.py` 使用合成世界验证投递、恢复、actor 重启与崩溃后重试、失败不提交。本机最终轻量回归为 48 项 Python 与 14 项 Node 检查，包含同一 tick 内人物加入、离开的场景边界。

浏览器检查定义于 `.github/workflows/browser.yml` 与 `tests/browser-smoke.mjs`，覆盖生成失败后重试、等待状态恢复入口、3D 绘制与旋转、关闭全部页面后后台继续、重连、停止冻结与历史读取；截图和诊断作为合成数据 artifact 保存。本次合成世界在关闭全部页面后推进至 tick 2，停止后冻结，creation revision 1 保持原状，pageErrors 为空。已查看 3D 与故事页云端截图；这只能证明当前合成小场景的功能和基本呈现，不代表任意题材视觉质量或目标设备性能已经验收。

目前的模拟动作仍是移动、讲话和等待，准入与空间规则覆盖有限。角色输入隔离不能证明模型不会通过语义暗示推断秘密。长期相关性检索、主观记忆分层、通用物理、复杂小说因果、用户附身和世界分岔尚未完成。程序生成 3D 不等于任意题材高质量资产生成，也尚未证明大规模场景性能；完整历史和角色记忆随运行增长，尚无长期容量验收。

模型密钥、`.data/`、`.venv/`、`.tools/` 和 `.tmp/` 不进入提交或 CI。重型运行时与浏览器检查优先在用户授权的 GitHub Actions 上执行，真实模型密钥不进入 CI。
