import type { Plugin } from '@nx-mk/kernel'

export default function createSwaggerPlugin(): Plugin {
  return {
    name: '@nx-mk/plugin-swagger',
    version: '0.1.0',
    hooks: {
      async beforeResolvePlugins(ctx) {
        ctx.logger.info('plugin-swagger: registered (placeholder)')
      },
      async run(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        ctx.logger.info('plugin-swagger: run noop', { subcommand: cmd })
      },
    },
  }
}
