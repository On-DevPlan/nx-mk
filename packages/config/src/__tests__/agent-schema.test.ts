/**
 * agent 配置段单测（spec §3.8 / E3）：全 optional、type 字面量收口、loader 接受 loop 子命令。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../schema.js'
import { loadConfig } from '../loader.js'
import { makeRunId } from '@nx-mk/kernel'

describe('AgentConfigSchema (spec §3.8)', () => {
  it('parses a full agent section', () => {
    const r = ConfigSchema.safeParse({
      agent: {
        provider: { type: 'claude-code', timeoutMs: 1000, maxTurns: 4 },
        loop: { maxIterations: 2, stopIfNoImprovementRounds: 1, maxTasksPerIteration: 3 },
      },
    })
    expect(r.success).toBe(true)
  })

  it('is optional — absent agent section parses fine', () => {
    expect(ConfigSchema.safeParse({}).success).toBe(true)
  })

  it('rejects provider.type other than claude-code (E3 → CONFIG_INVALID)', () => {
    const r = ConfigSchema.safeParse({ agent: { provider: { type: 'openai' } } })
    expect(r.success).toBe(false)
  })

  it('rejects non-positive numbers', () => {
    expect(ConfigSchema.safeParse({ agent: { loop: { maxIterations: 0 } } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { provider: { type: 'claude-code', timeoutMs: -1 } } }).success).toBe(false)
  })
})

describe('loadConfig with subcommand loop', () => {
  it('accepts the loop subcommand and echoes it', async () => {
    const path = joinFixture()
    const cfg = await loadConfig({ path, cwd: process.cwd(), runId: makeRunId('loop'), subcommand: 'loop' })
    expect(cfg.subcommand).toBe('loop')
  })
})

// 最小合法配置文件（YAML 注释解析为 null，ConfigSchema 会拒 —— 必须有真实字段）
function joinFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nx-mk-agent-cfg-'))
  const path = join(dir, 'nx-mk.config.yml')
  writeFileSync(path, 'openapi: ./swagger.json\n', 'utf8')
  return path
}

describe('agent.style', () => {
  it('accepts id / path / overrides forms', () => {
    expect(ConfigSchema.safeParse({ agent: { style: { id: 'tailwind-lite' } } }).success).toBe(true)
    expect(ConfigSchema.safeParse({ agent: { style: { path: './styles/my.md' } } }).success).toBe(true)
    expect(ConfigSchema.safeParse({ agent: { style: { id: 'x', overrides: { color: '蓝' } } } }).success).toBe(true)
    expect(ConfigSchema.safeParse({ agent: { style: {} } }).success).toBe(true) // 空 = auto-detect
  })

  it('rejects unknown keys (strict) and wrong types', () => {
    expect(ConfigSchema.safeParse({ agent: { style: { template: 'x' } } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { style: { id: '' } } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { style: { overrides: { a: 1 } } } }).success).toBe(false)
  })

  it('overrides without id or path is rejected (final-review Important #1)', () => {
    // 仅 overrides 没有模板引用 → 静默吞掉是配置脚枪，schema 层早 fail-fast
    const r = ConfigSchema.safeParse({ agent: { style: { overrides: { color: '蓝' } } } })
    expect(r.success).toBe(false)
  })
})
