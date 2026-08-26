import { z } from 'zod'

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])

export const PluginNameSchema = z.string().regex(
  /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,
  'plugin name must be a valid npm package name',
)

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
