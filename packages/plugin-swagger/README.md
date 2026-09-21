# `@nx-mk/plugin-swagger`

> OpenAPI → Manifest 插件 —— 解析 `config.openapi` 并原子写入 `.nx-mk/manifest.json`

## 概述

本包是 nx-mk 的内置插件之一：把配置里指向的 OpenAPI 3.x 文档解析为 Manifest
（实现见 `@nx-mk/manifest`），写到项目根 `.nx-mk/manifest.json`，作为后续采集与分析阶段的
endpoint / field 事实来源。

Hook 选在 **`beforeRun`** 而非 run 阶段：M14 Goal Loop 在 `beforeRun` 之后、`afterRun` 之前启动，
manifest 必须在此之前就落盘 —— kernel 的 `readInitialCoverageFromManifest` 据此构造真实初始
覆盖率（分母来自 manifest 字段集，而非空集）。

## 行为

| 项 | 说明 |
|---|---|
| 触发子命令 | 仅 `run` / `doctor`；`init` 阶段跳过（避免脚手架产生副作用） |
| 相对路径基准 | config 文件所在目录（`dirname(configPath)`），**不是** `process.cwd()` —— 支持从任意目录调用 |
| 写入方式 | 先写 `.nx-mk/manifest.json.tmp`，再 `renameSync` 原子替换，避免并发读到半成品 |
| 未配置 `openapi` | 打一条 info 日志后直接 return（不视为错误） |
| 自检日志 | `beforeResolvePlugins` 阶段打 `plugin-swagger: registered`，确认插件已加载且事件总线可达 |

## 配置

```yaml
plugins:
  - '@nx-mk/plugin-swagger'

openapi: ./swagger/openapi.json   # 相对 nx-mk.config.yml 所在目录
```

也可以写成带 config 的对象条目（per-plugin 命名空间，见 `@nx-mk/config`）：

```yaml
plugins:
  - name: '@nx-mk/plugin-swagger'
    config: {}
```

## 错误

解析失败（`ENOENT` / OpenAPI 校验错误 / `$ref` 解析失败等）统一包装为
`KernelError(PLUGIN_HOOK_FAILED)`，**退出码 4**，message 中带上实际解析的绝对路径便于定位。

## 测试

```bash
pnpm test
```

## 设计参考

- 配套包：`@nx-mk/manifest`（OpenAPI 解析）、`@nx-mk/manifest-schema`（Manifest 类型定义）
- 方案 §8 包结构；M14 收尾（hook 时机由 run 阶段前移至 `beforeRun`）
