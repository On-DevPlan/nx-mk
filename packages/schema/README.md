# `@nx-mk/schema`

> nx-mk standard-schema 适配层 —— 插件配置校验

## 概述

本包基于 [@standard-schema/spec](https://github.com/standard-schema/standard-schema) 规范，提供统一的配置校验工具。支持 zod / valibot / arktype 等所有符合规范的库。

## 用法

```ts
import { z } from 'zod'
import { validateConfig, ValidationError } from '@nx-mk/schema'

const schema = z.object({
  openapi: z.object({
    path: z.string().min(1),
  }),
})

try {
  const config = validateConfig(schema, rawConfig)
  // config 已被校验并类型化为 openapi.path: string
} catch (err) {
  if (err instanceof ValidationError) {
    // err.message: "invalid config:\n  - ... (at openapi.path)"
    // err.issues: ReadonlyArray<StandardSchemaV1.Issue>
  }
}
```

## API

### `validateConfig<T>(schema, rawConfig): T`

- **同步校验**（不支持 async schema）
- 校验失败抛 `ValidationError`
- 校验成功返回归一化后的强类型 `T`

### `ValidationError`

继承 `TypeError`，包含 `issues: ReadonlyArray<StandardSchemaV1.Issue>`。

错误消息格式（聚合所有 issue + 路径）：

```
invalid config:
  - openapi.path: must contain at least 1 character
  - openapi.servers[0].url: must be a valid URL
```

### `StandardSchemaV1`

重新导出 `@standard-schema/spec` 的类型。

## 与 kernel 集成

`@nx-mk/kernel` 在加载插件时会调用 `validateConfig`，校验失败抛 `KernelError(PLUGIN_CONFIG_INVALID)`（退出码 6）。

## 测试

```bash
pnpm test
```

## 设计参考

详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M2 章节。
