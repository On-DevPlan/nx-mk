/**
 * Phase 1.5 闭环集成测试（hermetic，spec §1.2-6 / §42.5 验收）
 *
 * 固化的 demo swagger fixture 走完整链路：
 *   parseOpenApi（named refs）→ generateSdk（typed SDK 文本）→ migrateCodemod（fetch 替换）
 * 不启动 server、不占端口；dist 需先构建（corepack pnpm --filter '@nx-mk/*' build）。
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import ts from 'typescript'
import { parseOpenApi } from '@nx-mk/manifest'
import { generateSdk } from '@nx-mk/client/codegen'
import { migrateCodemod } from '@nx-mk/client/migrate'

const FIXTURE = join(__dirname, '..', 'fixtures', 'demo-openapi.json')

describe('Phase 1.5 close loop', () => {
  it('parseOpenApi 保留 named refs（真 demo swagger）', async () => {
    const manifest = await parseOpenApi(FIXTURE)

    const getUser = manifest.endpoints.find((e) => e.path === '/users/{id}')!
    expect(getUser.responses.find((r) => r.status === '200')!.schema).toEqual({
      kind: 'named',
      name: 'User',
    })

    const listUsers = manifest.endpoints.find((e) => e.path === '/users')!
    expect(listUsers.responses.find((r) => r.status === '200')!.schema).toEqual({
      kind: 'array',
      items: { kind: 'named', name: 'User' },
    })

    const createOrder = manifest.endpoints.find((e) => e.path === '/orders')!
    expect(createOrder.request?.body).toEqual({ kind: 'named', name: 'NewOrder' })
  })

  it('generateSdk 产出 typed 签名且可被 TS 编译', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const code = generateSdk(manifest, { baseUrl: '/api' })

    expect(code).toContain('getUser: (params: { id: string }): Promise<User> => {')
    expect(code).toContain('Promise<User[]>')
    expect(code).toContain('body: NewOrder')

    // 生成文本必须是语法合法的 TS
    const diag = ts.transpileModule(code, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).diagnostics ?? []
    expect(diag).toHaveLength(0)
  })

  it('migrateCodemod 在 demo 同形代码上完成 fetch 替换', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const { files, report } = migrateCodemod({
      manifest,
      files: [{ path: 'src/legacy.ts', content: `const u = fetch('/api/users/u_001')\n` }],
    })
    expect(report.replaced).toHaveLength(1)
    expect(files[0]!.content).toContain(`api.users.getUser({ id: "u_001" })`)
  })
})
