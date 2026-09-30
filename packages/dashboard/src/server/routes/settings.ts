/**
 * C12（§30.2）settings 路由：GET /api/settings + PATCH /api/settings/:section
 * （section ∈ coverage|agent|replay 白名单）。
 *
 * 写回纪律沿 plugins PATCH 同款：EI 形状门在路由层（zod 深度校验 config 包三 schema），
 * preview/apply/sha 复核/.bak 原子写在 @nx-mk/config section-writeback；载体用
 * preview-first + yamlSha（与插件配置同一前端交互模式）。
 * configPath 未接线 → 409 诚实降级（同 plugins）。
 */
import type { FastifyInstance } from 'fastify'
import {
  AgentConfigSchema,
  CoverageConfigSchema,
  ReplayConfigSchema,
  readSettings,
  previewSectionWrite,
  applySectionWrite,
  ConfigWriteError,
  type TopLevelSection,
} from '@nx-mk/config'
import type { RouteContext } from '../types.js'
import type { SettingsResponse, ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../../shared/api-types.js'

const SECTION_SCHEMAS = {
  coverage: CoverageConfigSchema,
  agent: AgentConfigSchema,
  replay: ReplayConfigSchema,
} as const

// ConfigWriteErrorCode → HTTP（与 plugins 路由同映射）
function statusForWriteError(code: ConfigWriteError['code']): number {
  if (code === 'PLUGIN_NOT_IN_CONFIG') return 404
  if (code === 'YAML_SELF_HARM') return 500
  return 409
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/settings', async (_req, reply) => {
    if (!ctx.configPath) {
      return reply.code(409).send({ error: 'config file not found' })
    }
    try {
      return readSettings(ctx.configPath) satisfies SettingsResponse
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        return reply.code(statusForWriteError(err.code)).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  app.patch('/api/settings/:section', async (req, reply) => {
    if (!ctx.configPath) {
      return reply.code(409).send({ error: 'config file not found' })
    }
    const { section } = req.params as { section: string }
    if (!(section in SECTION_SCHEMAS)) {
      return reply.code(404).send({ error: `unknown settings section: ${section} (writable: coverage|agent|replay)` })
    }
    const body = (req.body ?? {}) as { value?: unknown; mode?: string; yamlSha?: unknown }
    // value: object = 段替换；null = 段删除（回到「段不存在=安全默认」）；其余 400
    if (body.value !== null && (typeof body.value !== 'object' || Array.isArray(body.value))) {
      return reply.code(400).send({ error: 'value must be a JSON object or null' })
    }
    // 深度 schema 校验（EI；null 跳过 —— 删除无需形状）
    if (body.value !== null) {
      const parsed = SECTION_SCHEMAS[section as TopLevelSection].safeParse(body.value)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'value failed schema validation',
          errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        })
      }
    }
    const dryRun = body.mode !== 'apply'
    if (!dryRun && typeof body.yamlSha !== 'string') {
      return reply.code(400).send({ error: 'yamlSha required for apply (preview first)' })
    }
    try {
      if (dryRun) {
        const preview = previewSectionWrite(ctx.configPath, section as TopLevelSection, body.value as Record<string, unknown> | null)
        return preview satisfies ConfigWritePreviewResponse
      }
      const result = applySectionWrite(
        ctx.configPath,
        section as TopLevelSection,
        body.value as Record<string, unknown> | null,
        body.yamlSha as string,
      )
      return result satisfies ConfigWriteApplyResponse
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        return reply.code(statusForWriteError(err.code)).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
