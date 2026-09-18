import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server/index.js'
import { readFile } from 'node:fs/promises'

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

  it('A5: ENOENT mid-read → 404 (no TOCTOU race)', async () => {
    // doMock + resetModules：重新加载的 static.js 拿到抛 ENOENT 的 readFile。
    // fastify 保持真实（不读 assets）。
    vi.resetModules()
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        readFile: vi.fn(async (p: unknown) => {
          throw Object.assign(new Error(`ENOENT: no such file: ${String(p)}`), { code: 'ENOENT' })
        }),
      }
    })
    try {
      const { registerStatic } = await import('../server/static.js')
      const fastify = (await import('fastify')).default
      const app = fastify()
      registerStatic(app, uiDist)
      const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(res.statusCode).toBe(404) // ENOENT → 404（实现前此处 500，TOCTOU 已消除）
      await app.close()
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })

  it.each([
    ['app.js', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'],
    ['data.json', 'application/json; charset=utf-8'],
    ['icon.svg', 'image/svg+xml'],
    ['img.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['favicon.ico', 'image/x-icon'],
    ['font.woff2', 'font/woff2'],
  ])('A6: /assets/%s served with correct MIME', async (file, mime) => {
    writeFileSync(join(uiDist, 'assets', file), 'x')
    const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
    const res = await app.inject({ method: 'GET', url: `/assets/${file}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain(mime.split(';')[0])
    await app.close()
  })
})
