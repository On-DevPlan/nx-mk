import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startMain, resolveDashboardConfigPath } from '../commands/start.js'

// open 参数：test 1 需 open:true（验证开浏览器）；其余用例默认 open:false（验证跳过）
function writeConfig(dir: string, open = false): string {
  const path = join(dir, 'nx-mk.config.yml')
  writeFileSync(path, `plugins: []\ndashboard:\n  port: 5000\n  open: ${open}\n`)
  return path
}

describe('startMain', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-start-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('listens on config port, opens browser, runs analysis', async () => {
    const calls: { port?: number; host?: string; opened?: string; ran?: boolean } = {}
    await startMain({
      configPath: writeConfig(dir, true), runId: 'run_t1', cwd: dir,
      deps: {
        startServer: async (port, host) => { calls.port = port; calls.host = host },
        runOnce: async () => { calls.ran = true },
        openBrowser: (url) => { calls.opened = url },
      },
    })
    expect(calls.port).toBe(5000)
    expect(calls.host).toBe('127.0.0.1')
    expect(calls.opened).toBe('http://127.0.0.1:5000')
    expect(calls.ran).toBe(true)
  })

  it('--no-run skips analysis', async () => {
    let ran = false
    await startMain({
      configPath: writeConfig(dir), runId: 'run_t2', cwd: dir, noRun: true,
      deps: { startServer: async () => {}, runOnce: async () => { ran = true }, openBrowser: () => {} },
    })
    expect(ran).toBe(false)
  })

  it('CLI --port overrides config; config open:false skips browser', async () => {
    const calls: Record<string, unknown> = {}
    await startMain({
      configPath: writeConfig(dir), runId: 'run_t3', cwd: dir, port: 6000,
      deps: {
        startServer: async (port) => { calls.port = port },
        runOnce: async () => {},
        openBrowser: (url) => { calls.opened = url },
      },
    })
    expect(calls.port).toBe(6000)
    expect(calls.opened).toBeUndefined()
  })

  it('run failure → startMain 仍正常返回（server 保活，spec §4）', async () => {
    await expect(startMain({
      configPath: writeConfig(dir), runId: 'run_t4', cwd: dir,
      deps: {
        startServer: async () => {},
        runOnce: async () => { throw new Error('boom') },
        openBrowser: () => {},
      },
    })).resolves.toBeUndefined()
  })

  it('EADDRINUSE → KernelError（顶层映射非零退出码）', async () => {
    const err = Object.assign(new Error('listen EADDRINUSE 127.0.0.1:5000'), { code: 'EADDRINUSE' })
    await expect(startMain({
      configPath: writeConfig(dir), runId: 'run_t5', cwd: dir,
      deps: { startServer: async () => { throw err }, runOnce: async () => {}, openBrowser: () => {} },
    })).rejects.toMatchObject({ code: 'KERNEL_INTERNAL' })
  })

  it('无 config → CONFIG_NOT_FOUND', async () => {
    await expect(startMain({
      configPath: join(dir, 'missing.yml'), runId: 'run_t6', cwd: dir,
      deps: { startServer: async () => {}, runOnce: async () => {}, openBrowser: () => {} },
    })).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
  })
})

// Finding 1：resolveConfigPath 的产物已是绝对路径 —— join 只拼接（D:\proj\D:\proj\…），
// resolve 对绝对段重置。期望值用同输入的 resolve() 计算，保持平台无关。
describe('resolveDashboardConfigPath', () => {
  it('absolute arg passes through unchanged (not joined onto cwd)', () => {
    const cwd = 'D:\\proj'
    const arg = 'D:\\proj\\nx-mk.config.yml'
    expect(resolveDashboardConfigPath(cwd, arg, 'D:\\other')).toBe(resolve(cwd, arg))
  })

  it('relative arg resolves against cwd', () => {
    expect(resolveDashboardConfigPath('D:\\proj', 'conf/nx-mk.config.yml', 'D:\\other'))
      .toBe(resolve('D:\\proj', 'conf/nx-mk.config.yml'))
  })

  it('undefined arg falls back to the discovered path', () => {
    expect(resolveDashboardConfigPath('D:\\proj', undefined, 'D:\\discovered\\nx-mk.config.yml'))
      .toBe('D:\\discovered\\nx-mk.config.yml')
  })
})
