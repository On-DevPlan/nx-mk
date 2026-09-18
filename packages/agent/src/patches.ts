/**
 * diff 通道（spec §3.7 / R9 / G1）—— 提取、落盘、git apply --check 封装。
 * R9：不解析 diff —— git 是唯一 truth，可应用性全部交给 git apply --check。
 */
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

// 从模型输出提取 diff 文本（R9）：优先全部 fenced ```diff / ```patch 块（按出现顺序拼接）；
// 兜底：输出整体含 'diff --git' 时取全文；否则 null（E6 → task failed）
export function extractDiff(output: string): string | null {
  const blocks: string[] = []
  for (const m of output.matchAll(/```(?:diff|patch)[^\n]*\n([\s\S]*?)```/g)) {
    const body = m[1]
    if (body && body.trim()) blocks.push(body.trimEnd())
  }
  if (blocks.length > 0) return blocks.join('\n')
  if (output.includes('diff --git')) return output.trim()
  return null
}

// fieldId → 文件名安全 slug（spec §3.7 逐字）：白名单外字符替换 '_'，截断 40。
// 白名单含 '/'（spec 逐字）—— 嵌套 slug 由 writePatchFile 的 mkdirSync(recursive) 兜底（PLN-8）
export function sanitizeFieldSlug(fieldId: string): string {
  return fieldId.replace(/[^a-zA-Z0-9._/-]/g, '_').slice(0, 40)
}

// 落盘一个 patch 文件（目录不存在则递归创建），返回绝对路径
export function writePatchFile(patchDir: string, filename: string, diffText: string): string {
  const abs = join(patchDir, filename)
  // PLN-8：嵌套 slug（白名单含 '/'）→ 实际文件路径的父目录整体递归创建
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, diffText.endsWith('\n') ? diffText : diffText + '\n', 'utf8')
  return abs
}

// 绝对路径 → 相对 projectRoot 的 posix 风格路径（diff_path 落库 / stdout 摘要统一用）
export function toPosixRel(absPath: string, projectRoot: string): string {
  return relative(projectRoot, absPath).replaceAll('\\', '/')
}

// git apply --check 的可注入执行缝（单测不依赖真实 git）
export interface GitRunResult { code: number; stderr: string }
export type GitApplyFn = (args: string[], cwd: string) => Promise<GitRunResult>

function defaultGitApply(args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) resolve({ code: typeof err.code === 'number' ? err.code : 1, stderr: String(stderr) })
      else resolve({ code: 0, stderr: '' })
    })
  })
}

// G1：`git apply --check`（E7 非 → 'reject'）；非 git 仓库 → 'skipped'（R10，verdict 由 G2-G4 决定）
export async function gitApplyCheck(
  patchAbsPath: string,
  cwd: string,
  run: GitApplyFn = defaultGitApply,
): Promise<'pass' | 'reject' | 'skipped'> {
  const r = await run(['apply', '--check', patchAbsPath], cwd)
  if (r.code === 0) return 'pass'
  if (/not a git repository/i.test(r.stderr)) return 'skipped'
  return 'reject'
}
