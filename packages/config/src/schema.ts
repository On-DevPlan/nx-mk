/**
 * 配置 Schema —— nx-mk.config.yml 的 Zod 校验规则
 *
 * 定义 plugins / logLevel / outputDir / openapi / goal 五个字段及各自默认值；
 * passthrough 允许保留未声明的字段，为后续 Phase 扩展留余地。
 */
import { z } from 'zod'

// 日志级别的合法取值（与内核 LogLevel 一致）
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])

// 插件名必须是合法 npm 包名（可含 @scope/ 前缀）
export const PluginNameSchema = z.string().regex(
  /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,
  'plugin name must be a valid npm package name',
)

// M14：Goal Loop 配置 schema（与内核 GoalConfig 字段一一对应）
export const GoalConfigSchema = z.object({
  targetRatio: z.number().min(0).max(1).default(1.0),
  maxTurns: z.number().int().positive().default(100),
  idleTurnsLimit: z.number().int().positive().default(3),
  absoluteTimeoutMs: z.number().int().positive().default(600_000),
}).optional()

// 顶层配置 schema：插件列表上限 20，输出目录必须是相对路径
export const ConfigSchema = z
  .object({
    plugins: z.array(PluginNameSchema).max(20, 'max 20 plugins').default([]),
    logLevel: LogLevelSchema.default('info'),
    outputDir: z
      .string()
      .regex(/^\.{1,2}(\/|\w)/, 'must be a relative path')
      .default('.nx-mk/runs'),
    // openapi: 指向 OpenAPI 3.x 文档的相对/绝对路径（Phase 1，可空）
    openapi: z.string().optional(),
    // M14：可选 Goal Loop 配置（不设置则使用 push-based beforeRun/afterRun）
    goal: GoalConfigSchema,
  })
  .passthrough()
