# `@nx-mk/manifest-schema`

> nx-mk Manifest Definition —— 共享类型 + schema 工具（M4 拆分）

## 概述

本包是 Capability Seam 的 **Definition** 角色：

- **类型**：所有 Manifest 数据模型（`ApiManifest` / `ApiField` / `ApiEndpoint` / ...）
- **工具函数**：
  - `stableFieldId()` —— 12 位 hex 稳定 ID（跨运行不变）
  - `normalizePath()` —— 路径归一化（数组下标 → `[]`）
  - `walkSchema()` —— 递归展开 OpenAPI Schema

**不依赖任何具体 Provider**。任何具体的 Manifest 生成器（OpenAPI / Postman / GraphQL）都依赖本包。

## 配套 Provider

| Provider | 包 | 来源 |
|----------|-----|------|
| OpenAPI 3.x | `@nx-mk/manifest` | Phase 1 实现 |
| Postman (计划) | `@nx-mk/manifest-postman` | Phase 2+ |
| GraphQL (计划) | `@nx-mk/manifest-graphql` | Phase 2+ |

## 用法

```ts
import type { ApiManifest, ApiField } from '@nx-mk/manifest-schema'
import { stableFieldId, normalizePath, walkSchema } from '@nx-mk/manifest-schema'

// 类型
const manifest: ApiManifest = { ... }

// 工具
const id = stableFieldId({
  method: 'GET',
  path: '/users/{id}',
  direction: 'response',
  status: '200',
  normalizedFieldPath: 'data.id',
})
// → 12 位 hex（如 'a3b9c2f8e4d1'）

const normalized = normalizePath('orders.0.items.2.skuName')
// → 'orders[].items[].skuName'
```

## 测试

```bash
pnpm test
```

覆盖：32 测试（field-id: 8 + normalizer: 10 + schema-walker: 14）

## 设计参考

详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M4 章节。
