import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server/index.js'

let dir: string
let uiDist: string
let nxMk: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-mk-dash-t1-'))
  uiDist = join(dir, 'ui')
  nxMk = join(dir, '.nx-mk')
  mkdirSync(join(uiDist, 'assets'), { recursive: true })
  mkdirSync(nxMk, { recursive: true })
  writeFileSync(join(uiDist, 'index.html'), '<html>nx-mk</html>')
  writeFileSync(join(uiDist, 'assets', 'app.js'), 'console.log(1)')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('static hosting', () => {
  it('GET / serves index.html as html', async () => {
    const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('<html>nx-mk</html>')
    expect(res.headers['content-type']).toContain('text/html')
    await app.close()
  })

  it('GET /assets/:name serves js with content-type', async () => {
    const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('console.log(1)')
    expect(res.headers['content-type']).toContain('text/javascript')
    await app.close()
  })

  it.each([
    '/assets/..%2Findex.html',   // 编码 ../ 逃逸（fastify/手写两层 decode 均可达）
    '/assets/%2e%2e%2fapp.js',   // 编码变体
    '/assets/missing.js',        // 不存在
  ])('traversal/missing → 404: %s', async (url) => {
    const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('UI not built → GET / gives actionable 404', async () => {
    const app = buildServer({ nxMkDir: nxMk, uiDistDir: join(dir, 'no-such-ui') })
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(404)
    expect(res.json().hint).toContain('pnpm --filter @nx-mk/dashboard build')
    await app.close()
  })

  it('unknown /api path → 404', async () => {
    const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
