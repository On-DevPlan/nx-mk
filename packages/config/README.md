# `@nx-mk/config`

> 配置 schema + YAML loader + 写回引擎

## 概述

本包是 `nx-mk.config.yml` 的**唯一所有者**：zod schema 定义、YAML 加载与覆盖合并、
以及用户配置的写回（`writeback.ts` 是全仓唯一写 `nx-mk.config.yml` 的文件，见「写回引擎」）。

## 配置结构

`ConfigSchema` 显式声明以下键，其余经 `.passthrough()` 透传（示例 config 中的 `version` /
`project` / `runtime` 即属此类）：

| 键 | 类型 / 默认 | 说明 |
|---|---|---|
| `plugins` | `(string \| {name, config})[]`，默认 `[]`，上限 20 | 插件列表，见下方联合类型 |
| `logLevel` | `debug \| info \| warn \| error \| silent`，默认 `info` | 日志级别 |
| `outputDir` | 相对路径，默认 `.nx-mk/runs` | run 产物目录 |
| `openapi` | `string?` | OpenAPI 3.x 文档路径（`@nx-mk/plugin-swagger` 消费） |
| `goal` | `GoalConfigSchema` | Goal Loop：`targetRatio` / `maxTurns` / `idleTurnsLimit` / `absoluteTimeoutMs` |
| `collect` | `CollectConfigSchema?` | 采集：`url` / `waitForSelector` / `maxTurns` |
| `coverage` | `CoverageConfigSchema?` | 策略：`required` / `optional` / `ignored`（glob 数组） |
| `dashboard` | `DashboardConfigSchema?` | 本地台：`port` / `open` |
| `agent` | `AgentConfigSchema?` | Agent Loop：`provider`（`type: 'claude-code'` / `timeoutMs` / `maxTurns`）+ `loop`（`maxIterations` / `stopIfNoImprovementRounds` / `maxTasksPerIteration`） |

```yaml
version: 1
openapi: ./swagger/openapi.json

plugins:
  - '@nx-mk/plugin-swagger'
  # 或带 per-plugin config 的对象条目：
  - name: '@nx-mk/plugin-playwright'
    config: { url: http://localhost:5173 }

collect: { url: http://localhost:5173, maxTurns: 3 }
goal: { targetRatio: 1.0, maxTurns: 5, idleTurnsLimit: 2, absoluteTimeoutMs: 60000 }
coverage: { ignored: ['data.internalRiskScore'] }
dashboard: { port: 4317, open: true }
```

## plugins 联合类型

`PluginEntrySchema` 让 `plugins` 条目既可以是裸字符串，也可以是 `{ name, config }` 对象：

```ts
import { normalizePluginEntries } from '@nx-mk/config'

normalizePluginEntries(['p1', { name: 'p2', config: { a: 1 } }])
// → [{ name: 'p1', config: {} }, { name: 'p2', config: { a: 1 } }]
```

裸字符串归一化为 `config: {}`，**旧格式 `string[]` 配置完全兼容**。归一化后每条的 `config`
作为该插件独立的命名空间，由 `@nx-mk/kernel` 的 `validateConfigSchema` 做 per-entry 校验。

## 加载

```ts
import { findConfigFile, loadConfig } from '@nx-mk/config'

const configPath = findConfigFile(cwd)          // 未找到 → KernelError(CONFIG_NOT_FOUND)
const resolved = loadConfig({
  path: configPath,
  cwd,
  runId,
  subcommand: 'run',                            // 'run' | 'init' | 'doctor' | 'start' | 'loop'
  cliOverrides: { logLevel: 'debug' },          // CLI --flag 覆盖
  env: process.env,
})
```

流程：读文件 → schema 校验 → 合并 env / CLI 覆盖 → 复验 → 返回 `ResolvedConfig`。
任何一步失败都包装为 `KernelError(CONFIG_INVALID / CONFIG_NOT_FOUND)`（退出码 2）。

## 写回引擎

供 dashboard 的 `PATCH /api/plugins/:pluginName/config` 两段式调用：

```ts
import { previewConfigWrite, applyConfigWrite, ConfigWriteError } from '@nx-mk/config'

// ① 预览：不落盘，回传 newYaml / yamlSha / diff
const preview = previewConfigWrite(configPath, pluginName, nextConfig)
// preview: { valid: true, errors, newYaml, yamlSha, diff }

// ② 落盘：必须带上一步的 yamlSha
const applied = applyConfigWrite(configPath, pluginName, nextConfig, preview.yamlSha)
// applied: { applied: true, diff, bakPath, yamlSha }
```

关键语义：

- **保注释**：走 yaml `Document` API round-trip 定位并替换目标条目，**不**解析成普通对象再 `stringify`（那会砸掉用户注释与格式）
- **原子写**：先写临时文件再 `renameSync`；apply 前留**单代** `.bak`
- **sha 并发防护**：`yamlSha` 是文件内容摘要，失配说明期间被他人改过 → 拒绝写入
- **自伤防护**：dump 出的新文本必须能再解析，否则判定 `YAML_SELF_HARM`（defense-in-depth）
- **diff**：`naiveLineDiff` 只输出变更行（`-` 旧 / `+` 新），无上下文行 —— 不引入 diff 依赖（D2）

错误码（`ConfigWriteError.code`，HTTP 状态由 dashboard 路由映射）：

| 码 | 含义 | HTTP |
|---|---|---|
| `CONFIG_FILE_MISSING` | 配置文件不存在 | 409 |
| `CONFIG_UNPARSEABLE` | 配置文件无法解析 | 409 |
| `PLUGIN_NOT_IN_CONFIG` | 该插件不在 `plugins` 列表 | 404 |
| `SHA_MISMATCH` | apply 时 `yamlSha` 过期 | 409 |
| `YAML_SELF_HARM` | 新文本不可再解析 | 500 |

## 测试

```bash
pnpm test
```

## 设计参考

- spec：[`2026-09-20-nx-mk-v1-plugin-config-writeback-design.md`](../../docs/superpowers/specs/2026-09-20-nx-mk-v1-plugin-config-writeback-design.md)（W1-W8 裁定、E1-E7 错误表）
- 消费方：`@nx-mk/kernel`（校验/装配）、`@nx-mk/cli`、`@nx-mk/dashboard`（写回路由）
