# `@nx-mk/cli`

> `npx nx-mk` 入口 —— argv 解析 + 子命令路由 + 退出码映射

## 概述

本包是 nx-mk 的命令行入口，手写轻量解析器（无第三方依赖）。它本身只做装配：
把 argv 解析成子命令与选项，加载 config，按依赖顺序拉起 kernel / plugins / dashboard，
最后把 `KernelError` 按错误码映射为进程退出码。

## 子命令

| 子命令 | 说明 |
|---|---|
| `run`（缺省） | 对当前项目跑完整流水线：5 阶段生命周期 + 插件采集 + Goal Loop + 覆盖率分析 |
| `init` | 生成 `nx-mk.config.yml` 与 `.nx-mk/` 目录（脚手架，不解析 OpenAPI） |
| `doctor` | 环境自检（Node 版本、config、插件加载） |
| `migrate` | SDK-CG3：把静态 `fetch('/api/...')` 替换为 `api.ns.method()`（也支持只报告） |
| `start` | 起本地 Dashboard（默认 `127.0.0.1:4317`），除非 `--no-run` 否则先自动跑一次分析 |
| `loop` | Agent Loop：把覆盖率缺口转成建议 diff（**不写工作区文件**） |

## 选项

```
--config <path>        指定 nx-mk.config.yml（覆盖查找）
--log-level <level>    debug | info | warn | error | silent
--output-dir <path>    run 产物目录（默认 ./.nx-mk/runs）
--run-id <id>          覆盖自动生成的 run id
--port <n>             Dashboard 端口（仅 start，覆盖 config dashboard.port）
--no-run               （start）只服务已有产物，不跑分析
--max-iterations <n>   （loop）覆盖 agent.loop.maxIterations
--manifest <path>      manifest 路径（仅 migrate，默认 ./.nx-mk/manifest.json）
--dir <path>           扫描的源码目录（仅 migrate，默认 ./src）
--api-prefix <prefix>  fetch URL 前缀（仅 migrate，默认 /api）
--import <specifier>   api 的 import 路径（仅 migrate，默认 ./generated-sdk）
--dry-run              只报告不写文件（仅 migrate）
--json                 机器可读 JSON 报告（仅 migrate）
--version, -v          打印版本退出
--help, -h             打印帮助退出
```

## 退出码

由 `@nx-mk/kernel` 的 `mapErrorCodeToExit` 映射：

| 码 | 含义 | 对应错误码 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 未分类错误（兜底） | — |
| 2 | 配置 / 运行前置错误 | `CONFIG_NOT_FOUND`、`CONFIG_INVALID`、`RUN_NOT_FOUND`、`PROVIDER_UNAVAILABLE` |
| 3 | 插件加载错误 | `PLUGIN_LOAD_FAILED`、`PLUGIN_SHAPE_INVALID` |
| 4 | 插件钩子执行错误 | `PLUGIN_HOOK_FAILED` |
| 5 | 内核内部缺陷 | `KERNEL_INTERNAL` |
| 6 | 插件配置校验失败 | `PLUGIN_CONFIG_INVALID` |
| 7 | 插件依赖未满足 | `PLUGIN_DEPENDENCY_MISSING` |

未知 `--flag` 抛 `KERNEL_INTERNAL`（退出码 5）；不以 `--` 开头的多余 token 静默忽略。

## 用法

```bash
npx nx-mk init                 # 脚手架
npx nx-mk doctor               # 环境自检
npx nx-mk run                  # 分析（默认子命令）
npx nx-mk run --log-level debug
npx nx-mk start --port 4400    # 起 Dashboard
npx nx-mk loop                 # Agent Loop 产建议 diff
npx nx-mk migrate --dry-run --json
```

## 依赖

`@nx-mk/kernel`、`@nx-mk/config`、`@nx-mk/client`、`@nx-mk/coverage`、
`@nx-mk/plugin-playwright`、`@nx-mk/dashboard`、`@nx-mk/agent`。

## 测试

```bash
pnpm test
```

覆盖：argv 解析、各子命令主流程（含 start 的 server 保活与 run 失败路径）、migrate 报告形状。

## 设计参考

- 方案 §3（最终用户体验）、§40（CI 模式，后置）
