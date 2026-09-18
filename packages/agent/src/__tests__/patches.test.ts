/**
 * diff 通道单测（spec §3.7 / R9 / G1）：提取、slug 消毒、落盘、git apply --check 四态。
 * gitApplyCheck 用注入替身 —— 真实 git 全链在 tests/integration（T9）。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { extractDiff, sanitizeFieldSlug, toPosixRel, writePatchFile, gitApplyCheck } from '../patches.js'

describe('extractDiff (R9)', () => {
  it('extracts a single fenced diff block', () => {
    const out = 'Here is my change:\n```diff\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n```\ndone'
    expect(extractDiff(out)).toBe('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b')
  })

  it('joins multiple fenced blocks in order', () => {
    const out = '```diff\n@@ -1 +1 @@\n```\ntext\n```diff\n@@ -9 +9 @@\n```'
    expect(extractDiff(out)).toBe('@@ -1 +1 @@\n@@ -9 +9 @@')
  })

  it('falls back to full text when it contains diff --git without fences', () => {
    const out = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts'
    expect(extractDiff(out)).toBe(out)
  })

  it('returns null when neither fence nor diff --git (E6)', () => {
    expect(extractDiff('I cannot help with that.')).toBeNull()
  })

  it('does not treat non-diff fences as diff blocks', () => {
    const out = '```ts\nconst a = 1\n```'
    expect(extractDiff(out)).toBeNull()
  })
})

describe('sanitizeFieldSlug (spec §3.7)', () => {
  it('replaces non-whitelist chars including brackets with underscore', () => {
    expect(sanitizeFieldSlug('GET /api/users.200.body[].name')).toBe('GET_/api/users.200.body__.name')
  })

  it('truncates to 40 chars', () => {
    expect(sanitizeFieldSlug('a'.repeat(60))).toHaveLength(40)
  })
})

describe('writePatchFile / toPosixRel', () => {
  it('writes the diff with trailing newline and returns a posix relative path', () => {
    const root = mkdtempSync(join(tmpdir(), 'nx-mk-patches-'))
    const dir = join(root, '.nx-mk', 'patches', 'agent_x')
    const abs = writePatchFile(dir, 'iter-1-field.patch', '+hello')
    expect(readFileSync(abs, 'utf8')).toBe('+hello\n')
    const rel = toPosixRel(abs, root)
    expect(rel).toBe('.nx-mk/patches/agent_x/iter-1-field.patch')
    expect(rel).not.toContain('\\')
  })
})

describe('gitApplyCheck (G1/R10)', () => {
  const okRun = async () => ({ code: 0, stderr: '' })
  const conflictRun = async () => ({ code: 1, stderr: 'error: patch does not apply' })
  const noGitRun = async () => ({ code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' })

  it('returns pass on exit 0', async () => {
    expect(await gitApplyCheck('p.patch', '/root', okRun)).toBe('pass')
  })
  it('returns reject on non-zero without not-a-git-repo stderr', async () => {
    expect(await gitApplyCheck('p.patch', '/root', conflictRun)).toBe('reject')
  })
  it('returns skipped when the dir is not a git repository (R10)', async () => {
    expect(await gitApplyCheck('p.patch', '/root', noGitRun)).toBe('skipped')
  })
})
