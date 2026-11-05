# Wispiva

分支职责：`main` 是主产品线；`prototype` 是原型线；`wispiva/luanti` 是以 Luanti 为底座的完整产品尝试。后两条线独立演进，不整体合入 `main`。

A wisp is a spark of an idea. Wispiva gives ideas a world where they can take shape, live, and evolve.

This branch develops Wispiva as an independent product. The product modules for world creation, world state, cognition, memory, and model access live directly at the repository root. Luanti supplies one Minecraft-like world implementation behind `engine/luanti/`; it is an adapter that can be replaced without moving the product modules. This branch will not be merged into `main`. See the [documentation index](docs/README.md) for the current state and plans.

The product flow is `genesis → world → cognition/model → engine/luanti`. Capacity tools live in `validation/luanti/`, and historical Luanti runs live in `evidence/luanti/`.

For a persistent product world, keep the server running with `engine/luanti/run_product.sh --world <world> --serve`, then connect a local Luanti client with `engine/luanti/view_product.sh --port <port>`. The client path is an observation and interaction entry point; product creation and confirmation remain explicit steps in `genesis/`.
