/**
 * Schema 校验适配层 —— 基于 standard-schema 规范
 *
 * 插件可通过声明 `configSchema?: StandardSchemaV1<unknown, T>` 来校验配置。
 * 支持 zod / valibot / arktype 等所有符合 @standard-schema/spec 的库。
 *
 * 用法示例（与 zod）：
 * ```ts
 * import { z } from 'zod'
 * import { validateConfig } from '@nx-mk/schema'
 *
 * export const configSchema = z.object({
 *   openapi: z.object({ path: z.string() }),
 * })
 *
 * const config = validateConfig(configSchema, rawConfig)
 * ```
 *
 * 详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M2 章节。
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { ValidationError } from './errors.js'

/** 重新导出 standard-schema 类型，方便插件作者 import */
export type { StandardSchemaV1 } from '@standard-schema/spec'
export { ValidationError }

/**
 * 校验并归一化插件配置。
 *
 * @param schema - 符合 standard-schema 规范的 schema（zod / valibot / arktype 等）
 * @param rawConfig - 原始配置对象（来自 ResolvedConfig 或用户输入）
 * @returns 校验后的强类型配置
 * @throws {ValidationError} 校验失败时聚合所有 issue
 */
export function validateConfig<T>(
  schema: StandardSchemaV1<unknown, T>,
  rawConfig: unknown,
): T {
  const result = schema['~standard'].validate(rawConfig)
  // 异步校验暂不支持（spec 允许但需要 await）
  if ('then' in result) {
    throw new TypeError(
      'Async config validation is not supported by @nx-mk/schema (use sync schema only)',
    )
  }
  if (result.issues) {
    throw new ValidationError(result.issues)
  }
  return result.value
}
