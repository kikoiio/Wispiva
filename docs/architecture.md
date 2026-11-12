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
| `view/paper-turn.mjs` | 翻页时固定当前正面与目标背面的临时内容副本，以 24 条连续纸面绕固定书脊弯曲，阴影随角度变化。动画结束撤销副本，恢复原始可交互 DOM；不生成新的世界画面。 |
| `view/` | 故事书从结构化事件与人物快照重建当时场景；前端通过服务端运行控制和状态同步观察世界。界面保留插画故事书和地图；一个展开对应一个 tick，左右页裁切同一幅跨页场景。 |

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

云端 [单元检查](https://github.com/kikoiio/Wispiva/actions/runs/43224081780)、[真实 Ray/Redis 集成](https://github.com/kikoiio/Wispiva/actions/runs/43224081762) 与 [纸面翻页浏览器检查](https://github.com/kikoiio/Wispiva/actions/runs/43224081580) 在提交 `0bbc8b9` 通过。集成脚本 `scripts/verify-runtime.py` 使用合成世界验证投递、恢复、actor 重启与崩溃后重试、失败不提交。轻量回归包括 48 项 Python 与 17 项 Node 检查，涵盖 tick 边界、同拍多地点、静止拍保留、人物加入与离开、固定书脊、纸条连续性与背面贴图顺序。

浏览器检查定义于 `.github/workflows/browser.yml` 与 `tests/browser-smoke.mjs`，用于验证生成失败后重试、等待状态恢复入口、连续跨页绘制、前后各翻一拍、历史阅读不推进及末页才推进、关闭全部页面后后台继续、重连、停止冻结与历史读取。截图和诊断作为合成数据 artifact 保存。故事视图先按事件顺序恢复人物，再按 tick 组织展开；每个展开保留本拍各地点的场景，通过地点按钮切换，静止与重复 tick 也各占一个展开。左右页使用相同的场景数据和完整绘图宽度，分别裁切左右两半；自动播放也通过整页翻动切换拍数。纸面动画使用本地 DOM 副本，所以人物与文字和背景一起弯曲；副本无重复 ID、不可聚焦，并对辅助技术隐藏。翻页期间不接受新的翻页或编辑，轮询不覆盖页内容；切换视图、缩放窗口与页面隐藏会取消当前动画。减少动态效果设置会直接切页。

正常动态效果的云端检查还覆盖前后双向翻页、连续点击不跳拍、每帧纸面曲率变化、翻完恢复人物点击、缩放与切换地图中断后的清理；双向中间帧和短录屏保存在浏览器 artifact。动画只用于翻页，不提供世界场景的 3D 入口。

目前的模拟动作仍是移动、讲话和等待，准入与空间规则覆盖有限。角色输入隔离不能证明模型不会通过语义暗示推断秘密。长期相关性检索、主观记忆分层、通用物理、复杂小说因果、用户附身和世界分岔尚未完成。插画目前依赖已有素材，通用题材的美术生成与大规模场景性能尚未验收；完整历史和角色记忆随运行增长，尚无长期容量验收。

模型密钥、`.data/`、`.venv/`、`.tools/` 和 `.tmp/` 不进入提交或 CI。重型运行时与浏览器检查优先在用户授权的 GitHub Actions 上执行，真实模型密钥不进入 CI。
