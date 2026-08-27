/**
 * @nx-mk/plugin-swagger —— 官方 Swagger 插件（Phase 0 占位实现）
 *
 * 以标准插件工厂（default 导出）形式编写，用于验证内核的插件加载链路；
 * Phase 1 将把 afterRun 钩子替换为真实的 OpenAPI 文档拉取与解析逻辑。
 */
import type { Plugin } from '@nx-mk/kernel'

// 标准插件工厂：default 导出函数，返回满足 Plugin 合约的对象
export default function createSwaggerPlugin(): Plugin {
  return {
    name: '@nx-mk/plugin-swagger',
    version: '0.1.0',
    hooks: {
      // 插件被内核成功调度时打一条自检日志，确认钩子链路连通
      async beforeResolvePlugins(ctx) {
        ctx.logger.info('plugin-swagger: registered (placeholder)')
      },
      // 主阶段占位：仅记录当前子命令，Phase 1 替换为真实解析逻辑
      async afterRun(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        ctx.logger.info('plugin-swagger: run noop', { subcommand: cmd })
      },
    },
  }
}
