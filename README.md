# Wispiva

Wispiva 把一句设想展开为地点、人物和路径，让角色在同一个持续保存的世界里行动。当前是独立的 `wispiva/openstory` 实验线，不整体合入 `main`。浏览器提供故事书、地图与按世界数据程序生成的可交互 3D 视图。

支持两种明确的运行方式：勾选模型时，由模型创建世界并决定角色行动，模型失败会暂停，修好配置后可重试；未勾选时为离线规则演示。角色只能接收自己的观察、记忆及明确公开的信息。移动、地点关闭和同地对话由引擎裁定。

需要 Python 3.12、Node.js 24，以及系统 `redis-server`（也可使用已有 `.tools/redis/bin/redis-server`）。准备本机运行环境后启动：

```bash
./scripts/bootstrap.sh
./scripts/run.sh
```

打开 <http://127.0.0.1:4173/>。`bootstrap.sh` 安装锁定版本的 Python 依赖；`run.sh` 复用可用的 Redis，缺少服务时只启动并管理本任务的 Redis。临时文件位于仓库 `.tmp/`，存档位于 `.data/redis/`。新启动的 Redis 使用 AOF、每秒同步；Redis 或整机崩溃仍可能丢失约最后一秒的写入。使用外部 Redis 时，其持久化由该服务的配置决定。

点击“自动播放”后由服务器持续推进，关闭浏览器不会停止。停止时允许已经开始的一拍完成；退出服务器则世界冻结，重启不会补算离线时间。每一拍完成全部行动与投递后一次提交，历史事件追加保存，成功提交保留不可变的状态节点。重新创建世界也会保留先前世界的存档与历史入口。

模型配置可复制 `.env.example` 为根目录 `.env`，填写 `WISPIVA_LLM_BASE_URL`、`WISPIVA_LLM_MODEL`、`WISPIVA_LLM_API_KEY`；仅支持 Anthropic Messages 兼容接口。环境变量优先，`WISPIVA_ENV_FILE` 可指定其他文件；均未设置时兼容读取 `~/.config/wispiva/providers.json`（或 `XDG_CONFIG_HOME` 下的同一路径）。密钥不写入世界或通过状态接口返回。

`PORT`、`REDIS_URL` 可调整监听端口与 Redis。Ray 首次推进时启动，使用一颗 CPU 和 128 MiB 对象存储；默认临时目录 `/var/tmp/wispiva-ray-<uid>` 避开 `/tmp` 配额。可用 `RAY_TMPDIR` 指向较短的根文件系统路径，`WISPIVA_TICK_TIMEOUT` 设置单拍运行时限（秒，默认 600）。

3D 场景由当前地点、道路、人物与状态生成，支持旋转、缩放和点选。它不是任意题材的高质量 AI 资产生成器；故事书中的已有插画是静态素材。通用物理、长期语义记忆、完整小说因果与多世界分岔仍属于后续目标。实现与验证边界见 [当前架构](docs/architecture.md)。
