/**
 * mk migrate 子命令单测（spec §3.6）
 *
 * 临时 fixture 项目：manifest + src 带 fetch 调用。
 * 锁死：全流程替换写盘、dry-run 不写盘、manifest 缺失 exit 语义、--json 输出。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrate } from '../commands/migrate'

let workDir: string

const MANIFEST = {
  version: '1',
  source: { type: 'openapi', input: 'swagger.json', hash: 'x' },
  generatedAt: '2026-09-16T00:00:00Z',
  schemas: {},
  fields: [],
  endpoints: [
    {
      id: 'ep1', method: 'GET', path: '/users/{id}', operationId: 'getUser', tags: ['users'],
      responses: [{ status: '200', schema: { kind: 'named', name: 'User' }, fields: [] }],
    },
  ],
}

const PAGE = `export const load = () => fetch('/api/users/u_001')\n`

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-migrate-test-'))
  mkdirSync(join(workDir, '.nx-mk'))
  writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), JSON.stringify(MANIFEST))
  mkdirSync(join(workDir, 'src'))
  writeFileSync(join(workDir, 'src', 'page.ts'), PAGE)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('runMigrate', () => {
  it('替换并写盘，打印 replaced 摘要', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMigrate({ manifestPath: join(workDir, '.nx-mk', 'manifest.json'), dir: join(workDir, 'src') })
    const out = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(readFileSync(join(workDir, 'src', 'page.ts'), 'utf8')).toContain(
      'api.users.getUser({ id: "u_001" })',
    )
    expect(out).toContain('1 replaced')
    expect(readFileSync(join(workDir, 'src', 'page.ts'), 'utf8')).toContain(
      "import { api } from './generated-sdk'",
    )
  })

  it('dry-run：报告替换但不写盘', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMigrate({ manifestPath: join(workDir, '.nx-mk', 'manifest.json'), dir: join(workDir, 'src'), dryRun: true })
    expect(readFileSync(join(workDir, 'src', 'page.ts'), 'utf8')).toBe(PAGE)
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('dry-run')
  })

  it('manifest 缺失 → KernelError CONFIG_NOT_FOUND（提示先跑 nx-mk run）', async () => {
    rmSync(join(workDir, '.nx-mk', 'manifest.json'))
    await expect(
      runMigrate({ manifestPath: join(workDir, '.nx-mk', 'manifest.json'), dir: join(workDir, 'src') }),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
  })

  it('manifest JSON 非法 → CONFIG_INVALID', async () => {
    writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), '{broken')
    await expect(
      runMigrate({ manifestPath: join(workDir, '.nx-mk', 'manifest.json'), dir: join(workDir, 'src') }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('--json 输出机器可读 report', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMigrate({ manifestPath: join(workDir, '.nx-mk', 'manifest.json'), dir: join(workDir, 'src'), json: true })
    const parsed = JSON.parse(log.mock.calls.map((c) => String(c[0])).join('\n'))
    expect(parsed.report.replaced).toHaveLength(1)
    expect(parsed.report.replaced[0].to).toBe('api.users.getUser({ id: "u_001" })')
  })
})
