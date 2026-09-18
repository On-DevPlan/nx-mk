/**
 * claude-code provider（spec §3.5 / R1 / E4-E6）—— spawn 本地 claude CLI。
 * 只读工具集（Read Grep Glob）：子进程内部也无写能力，D1 双保险。
 * RunClaudeFn 注入缝：真实子进程不进 CI。
 */
import { spawn } from 'node:child_process'
import { KernelError } from '@nx-mk/kernel'
import { extractDiff } from '../patches.js'
import type { AgentEditInput, AgentEditOutput, AgentProvider } from '../types.js'

// R1 逐字：只读三件套（单 arg、空格分隔）
export const READONLY_ALLOWED_TOOLS = 'Read Grep Glob'

export interface RunClaudeResult { code: number; stdout: string; stderr: string }
export type RunClaudeFn = (args: string[], cwd: string, timeoutMs: number) => Promise<RunClaudeResult>

// 默认实现：spawn claude，collect stdout/stderr；超时 kill（E5 → task failed）
export function defaultRunClaude(args: string[], cwd: string, timeoutMs: number): Promise<RunClaudeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`claude timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => { stdout += String(d) })
    child.stderr.on('data', (d: Buffer) => { stderr += String(d) })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

// spawn 失败分类（E4）：ENOENT → PROVIDER_UNAVAILABLE（进程级 —— CLI 没装 claude
// 时整条 loop 无意义）；其余错误原样返回（task 级）
export function classifyClaudeSpawnError(err: unknown): unknown {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    return new KernelError(
      'PROVIDER_UNAVAILABLE',
      "claude CLI not found — install it (npm i -g @anthropic-ai/claude-code) and run 'claude' once to log in",
      err,
    )
  }
  return err
}

export interface ClaudeCodeProviderOptions {
  projectRoot: string
  timeoutMs: number
  maxTurns: number
}

export function createClaudeCodeProvider(
  opts: ClaudeCodeProviderOptions,
  inject?: { runClaude?: RunClaudeFn },
): AgentProvider {
  const runClaude = inject?.runClaude ?? defaultRunClaude
  return {
    name: 'claude-code',
    async edit(input: AgentEditInput): Promise<AgentEditOutput> {
      const args = [
        '-p', renderPrompt(input),
        '--output-format', 'json',
        '--allowedTools', READONLY_ALLOWED_TOOLS,
        '--max-turns', String(opts.maxTurns),
      ]
      let r: RunClaudeResult
      try {
        r = await runClaude(args, opts.projectRoot, opts.timeoutMs)
      } catch (err) {
        throw classifyClaudeSpawnError(err)
      }
      if (r.code !== 0) {
        throw new Error(`claude exited with code ${r.code}${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ''}`)
      }
      let parsed: { result?: string; is_error?: boolean }
      try {
        parsed = JSON.parse(r.stdout) as { result?: string; is_error?: boolean }
      } catch {
        throw new Error('claude stdout is not valid JSON (--output-format json expected)')
      }
      if (parsed.is_error) {
        throw new Error(`claude returned is_error: ${(parsed.result ?? '').trim().slice(0, 200)}`)
      }
      const diff = extractDiff(parsed.result ?? '')
      if (!diff) throw new Error('no diff block found in claude output (E6)')
      return { diffText: diff }
    },
  }
}

// 组装最终 prompt：instructions + 可选结构化 context（逐行 key: value）
function renderPrompt(input: AgentEditInput): string {
  const parts = [input.instructions]
  if (input.context) {
    const lines = Object.entries(input.context).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    )
    parts.push(lines.join('\n'))
  }
  return parts.join('\n\n')
}
