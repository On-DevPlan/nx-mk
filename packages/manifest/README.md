# `@nx-mk/manifest`

> nx-mk OpenAPI Manifest Provider（M4 拆分后角色：Provider）

## 概述

本包是 Capability Seam 的 **OpenAPI Provider**：

- 解析 OpenAPI 3.x 文档 → `ApiManifest`
- 写入项目根 `.nx-mk/manifest.json`

**依赖** `@nx-mk/manifest-schema` 获取类型与 schema 工具。

## Capability Seam 架构

```
manifest-schema (Definition)
    ↑
manifest (OpenAPI Provider)      ← 本包
manifest-postman (Phase 2+)      ← 未来扩展
manifest-graphql (Phase 2+)      ← 未来扩展
```

## 用法

```ts
import { parseOpenApi } from '@nx-mk/manifest'
import type { ApiManifest } from '@nx-mk/manifest-schema'

const manifest: ApiManifest = await parseOpenApi('./openapi.json')
// manifest.endpoints.length, manifest.fields.length, ...
```

## 向后兼容

本包仍从 `@nx-mk/manifest-schema` 重新导出所有类型与工具函数。旧代码：

```ts
// 旧代码（仍可工作）
import { ApiManifest, stableFieldId, parseOpenApi } from '@nx-mk/manifest'

// 新代码（推荐）
import { parseOpenApi } from '@nx-mk/manifest'
import { stableFieldId, type ApiManifest } from '@nx-mk/manifest-schema'
```

## 测试

```bash
pnpm test
```

覆盖：10 测试（parser: 10）

## 设计参考

详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M4 章节。
