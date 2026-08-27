/**
 * 配置 Schema —— nx-mk.config.yml 的 Zod 校验规则
 *
 * 定义 plugins / logLevel / outputDir 三个字段及各自默认值；
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

// 顶层配置 schema：插件列表上限 20，输出目录必须是相对路径
export const ConfigSchema = z
  .object({
    plugins: z.array(PluginNameSchema).max(20, 'max 20 plugins').default([]),
    logLevel: LogLevelSchema.default('info'),
    outputDir: z
      .string()
      .regex(/^\.{1,2}(\/|\w)/, 'must be a relative path')
      .default('.nx-mk/runs'),
  })
  .passthrough()
