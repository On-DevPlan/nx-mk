/**
 * init 子命令 —— 脚手架：生成 nx-mk.config.yml 与 .nx-mk/ 目录结构
 *
 * 幂等设计：配置文件已存在则跳过不覆盖，目录重复创建不报错；
 * 随后跑一次 init 生命周期的内核，顺带验证插件加载链路并产出
 * .nx-mk/runs/init/ 下的日志与事件文件。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createKernel, makeRunId, type LogLevel } from '@nx-mk/kernel'

// init 子命令入参：目标配置路径 + CLI 级配置覆盖
export interface RunInitOptions {
  configPath: string
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

// 默认配置模板：预置官方 swagger 插件，用户可按需增删
const DEFAULT_CONFIG = `# nx-mk configuration
# See: docs/superpowers/specs/2026-08-26-nx-mk-phase0-foundation-design.md

plugins:
  - '@nx-mk/plugin-swagger'

logLevel: info
outputDir: ./.nx-mk/runs
`

// 脚手架主流程：先确保配置目录存在 → 幂等写配置 → 建运行目录 → 跑一次 init 生命周期
export async function runInit(opts: RunInitOptions): Promise<void> {
  mkdirSync(dirname(opts.configPath), { recursive: true })

  // 配置已存在则不覆盖（保护用户已有配置）
  if (existsSync(opts.configPath)) {
    console.log(`✔ nx-mk.config.yml already exists at ${opts.configPath}`)
  } else {
    writeFileSync(opts.configPath, DEFAULT_CONFIG, 'utf8')
    console.log(`✔ Created ${opts.configPath}`)
  }

  mkdirSync(join(dirname(opts.configPath), '.nx-mk', 'runs'), { recursive: true })
  console.log('✔ Created .nx-mk/runs/')

  // 以配置文件所在目录为 cwd 跑一次内核（runId 固定为 init）
  const kernel = createKernel({
    configPath: opts.configPath,
    runId: makeRunId('init'),
    subcommand: 'init',
    cwd: dirname(opts.configPath),
  })
  await kernel.run()
  console.log('✔ Kernel lifecycle exercised; see .nx-mk/runs/init/')
}
