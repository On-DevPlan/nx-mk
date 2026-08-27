/**
 * @nx-mk/plugin-swagger —— OpenAPI → Manifest 生成插件（Phase 1）
 *
 * 在 afterRun hook 期间读取 config.openapi 指向的 OpenAPI 3.x 文档，
 * 通过 @nx-mk/manifest 解析并写入项目根 .nx-mk/manifest.json。可被 Phase 2 的
 * 字段代理作为 endpoint / field 来源使用。
 *
 * 钩子时机：Phase 0 内核只有 before<Phase> / after<Phase> 两类钩子，
 * run 阶段的主工作挂在 afterRun 上（内核不识别裸 `run` 钩子键）。
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { KernelError, type Plugin } from '@nx-mk/kernel'
import { parseOpenApi } from '@nx-mk/manifest'

export default function createSwaggerPlugin(): Plugin {
  return {
    name: '@nx-mk/plugin-swagger',
    version: '0.1.0',
    hooks: {
      // pre-resolve 自检日志：确认插件已加载、内核事件总线可达
      async beforeResolvePlugins(ctx) {
        ctx.logger.info('plugin-swagger: registered')
      },
      // 主阶段：解析 config.openapi 并写入项目根 .nx-mk/manifest.json
      async afterRun(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        // 仅 run / doctor 触发；init 不应解析 OpenAPI（避免副作用）
        if (cmd !== 'run' && cmd !== 'doctor') return

        const openapi = ctx.config.openapi
        if (!openapi) {
          ctx.logger.info('plugin-swagger: openapi not configured, skipping', { cmd })
          return
        }

        // 解析相对路径：相对当前 config 所在目录（不是 cwd，因为用户可能从别的目录跑）
        const baseDir = ctx.config.configPath ? dirname(ctx.config.configPath) : ctx.cwd
        const resolvedPath = isAbsolute(openapi) ? openapi : join(baseDir, openapi)

        let manifest
        try {
          manifest = await parseOpenApi(resolvedPath)
        } catch (err) {
          // 把底层错误（ENOENT / ValidationError / $ref 失败等）包装为 PLUGIN_HOOK_FAILED
          throw new KernelError(
            'PLUGIN_HOOK_FAILED',
            `plugin-swagger: failed to parse OpenAPI at ${resolvedPath}: ${(err as Error).message}`,
            err,
          )
        }

        // 原子写入：先写 .tmp 再 rename，避免半成品文件被并发读取
        const manifestPath = join(ctx.cwd, '.nx-mk', 'manifest.json')
        mkdirSync(dirname(manifestPath), { recursive: true })
        const tmpPath = `${manifestPath}.tmp`
        writeFileSync(tmpPath, JSON.stringify(manifest, null, 2))
        renameSync(tmpPath, manifestPath)

        ctx.logger.info('plugin-swagger: manifest generated', {
          cmd,
          specPath: resolvedPath,
          manifestPath,
          endpoints: manifest.endpoints.length,
          fields: manifest.fields.length,
        })
      },
    },
  }
}
