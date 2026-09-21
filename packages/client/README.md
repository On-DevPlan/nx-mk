# `@nx-mk/client`

> SDK Facade —— 运行时字段代理 + 采集缓冲 + SDK Codegen + 静态迁移

## 概述

本包是 nx-mk 的**业务集成契约**（业务代码只认它），也是采集侧的浏览器端入口。按用途拆成 7 个子路径导出：

| 子路径 | 内容 | 谁用 |
|---|---|---|
| `@nx-mk/client` | `createFetchClient`、`detectMode`、`Field` | 业务代码（主入口） |
| `@nx-mk/client/runtime` | `createFetchClient`、`patchGlobalFetch` | 未走 codegen 的存量代码兜底 |
| `@nx-mk/client/codegen` | `generateSdk` 及 emit 内部函数 | CLI `run` / `demo:codegen` |
| `@nx-mk/client/react` | `Field`（`FieldProps`） | React 页面显式标记 |
| `@nx-mk/client/collector` | `createCollector` / `createNoopCollector` | 采集缓冲（IO 已剥离） |
| `@nx-mk/client/proxy` | `createTrackedProxy`、`normalizeProxyFieldPath` | 经 runtime 间接生效，业务不直接 import |
| `@nx-mk/client/migrate` | `migrateCodemod`（纯函数） | CLI `migrate`（文件 IO 留在 CLI） |

## 业务侧用法

```tsx
// 1) 走 codegen 产物（推荐）：api.users.getUser(id)
import { api } from './generated-sdk'
import { Field } from '@nx-mk/client/react'

const user = await api.users.getUser(1)

// 2) 显式标记字段将进入 UI —— @nx-mk/client/react 的 Field
;<Field name="user.name">{user.name}</Field>
```

不经过 codegen 的存量代码：

```ts
import { createFetchClient, patchGlobalFetch } from '@nx-mk/client'

const client = createFetchClient({ baseUrl: '/api' })
patchGlobalFetch()   // SDK-CG3 fallback：未迁移的 fetch 也纳入采集，覆盖率不断
```

## 运行模式

`detectMode()` 返回 `'production' | 'analysis'`：

- **编译期注入**：`__MK_ANALYSIS__` 由 vite define 在 dev server 启动时烘焙为 `true`
  （即 `MK_ANALYSIS=true` 要传给 **vite 进程**，重启才生效）
- **运行期 fallback**：mk runtime 启动时设置

production 模式不 import 字段级 Proxy，**零开销**；analysis 模式才挂上 tracker 与 collector。

## 采集缓冲

`createCollector()` 提供内存缓冲，三类数据：`FieldHitCore`（字段读取）、`RequestTraceCore`（请求 trace）、
`UiEvidenceCore`（UI 可见性证据）。`drain()` 交给 SQLite 写入方（`@nx-mk/coverage` 的 flush），
本包不做 IO。测试/生产可用 `createNoopCollector()` 顶替。

`RequestTraceCore` 含可选的 `scenarioId?` / `dslStepId?` 归因字段（Scenario DSL 用，缺省不写）。

## 依赖

- `dependencies`：`@nx-mk/manifest-schema`、`typescript`（codegen 需要）
- `peerDependencies`：`react`（仅 `/react` 子路径需要）

## 测试

```bash
pnpm test
```

## 设计参考

- 方案 §5.3（SDK Facade）、§19（字段级 Proxy）、§20（UI Evidence 显式标记）、§42.5（Phase 1.5 Codegen：SDK-CG1/CG2/CG3）
- spec：[`2026-09-16-nx-mk-phase15-close-loop-sdk-cg3-design.md`](../../docs/superpowers/specs/2026-09-16-nx-mk-phase15-close-loop-sdk-cg3-design.md)
