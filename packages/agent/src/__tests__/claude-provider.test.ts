/**
 * claude-code provider 单测（spec §3.5 / E4-E6）：spawn 参数快照 + stdout 各态。
 * RunClaudeFn 注入替身 —— 真实子进程不进 CI。
 */
import { describe, it, expect } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import {
  READONLY_ALLOWED_TOOLS,
  classifyClaudeSpawnError,
  createClaudeCodeProvider,
  type RunClaudeFn,
  type RunClaudeResult,
} from '../provider/claude-code.js'

const OK: RunClaudeResult = {
  code: 0,
  stdout: JSON.stringify({ result: '```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```', is_error: false }),
  stderr: '',
}

function makeProvider(run: RunClaudeFn, timeoutMs = 1000, maxTurns = 7) {
  return createClaudeCodeProvider({ projectRoot: '/proj', timeoutMs, maxTurns }, { runClaude: run })
}

describe('createClaudeCodeProvider', () => {
  it('spawns claude with read-only tools, json output and max-turns (R1)', async () => {
    const seen: { args: string[]; cwd: string; timeoutMs: number }[] = []
    const provider = makeProvider(async (args, cwd, timeoutMs) => {
      seen.push({ args, cwd, timeoutMs })
      return OK
    })
    await provider.edit({ instructions: 'do it' })
    expect(seen).toHaveLength(1)
    const call = seen[0]!
    expect(call.cwd).toBe('/proj')
    expect(call.timeoutMs).toBe(1000)
    const at = call.args.indexOf('--allowedTools')
    expect(at).toBeGreaterThan(-1)
    expect(call.args[at + 1]).toBe(READONLY_ALLOWED_TOOLS)
    expect(READONLY_ALLOWED_TOOLS).toBe('Read Grep Glob')
    expect(call.args).toContain('--output-format')
    expect(call.args[call.args.indexOf('--output-format') + 1]).toBe('json')
    expect(call.args[call.args.indexOf('--max-turns') + 1]).toBe('7')
    expect(call.args[0]).toBe('-p')
    expect(call.args[1]).toContain('do it')
  })

  it('returns the extracted diff text (R9)', async () => {
    const provider = makeProvider(async () => OK)
    const out = await provider.edit({ instructions: 'x' })
    expect(out.diffText).toBe('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')
  })

  it('throws a task-level error on is_error (E5)', async () => {
    const provider = makeProvider(async () => ({
      code: 0,
      stdout: JSON.stringify({ result: 'boom', is_error: true }),
      stderr: '',
    }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/is_error/)
  })

  it('throws on non-zero exit (E5)', async () => {
    const provider = makeProvider(async () => ({ code: 1, stdout: '', stderr: 'bad args' }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/exited with code 1/)
  })

  it('throws on non-JSON stdout (E5)', async () => {
    const provider = makeProvider(async () => ({ code: 0, stdout: 'not json', stderr: '' }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/not valid JSON/)
  })

  it('throws when no diff can be extracted (E6)', async () => {
    const provider = makeProvider(async () => ({
      code: 0,
      stdout: JSON.stringify({ result: 'no diff here', is_error: false }),
      stderr: '',
    }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/no diff/)
  })

  it('passes through timeout errors as task-level failures (E5)', async () => {
    const provider = makeProvider(async () => {
      throw new Error('claude timed out after 1000ms')
    })
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/timed out/)
  })

  it('maps ENOENT to KernelError PROVIDER_UNAVAILABLE (E4, process-level)', async () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    const provider = makeProvider(async () => {
      throw enoent
    })
    await expect(provider.edit({ instructions: 'x' })).rejects.toBeInstanceOf(KernelError)
    await expect(provider.edit({ instructions: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('classifyClaudeSpawnError passes unknown errors through unchanged', () => {
    const err = new Error('weird')
    expect(classifyClaudeSpawnError(err)).toBe(err)
  })
})
