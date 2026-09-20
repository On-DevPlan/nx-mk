/**
 * 写回引擎（spec W5/W6/W7 + E2/E3/E4/E5/E6/E7）：yaml round-trip / naive diff / 原子写 / 单代 .bak / sha 防护。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Text, previewConfigWrite, applyConfigWrite, naiveLineDiff, ConfigWriteError } from '../writeback'

const BASE_YAML = [
  '# 用户主配置',
  'logLevel: info',
  'plugins:',
  '  # 采集插件（注释行必须原样保留）',
  "  - '@nx-mk/plugin-playwright'",
  '  - name: \'@nx-mk/plugin-swagger\'',
  '    config:',
  '      maxTurns: 3',
  '',
].join('\n')

describe('naiveLineDiff', () => {
  it('输出 - / + 变更行（无上下文行，WP 裁定）', () => {
    expect(naiveLineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual('- b\n+ B')
  })
  it('相同输入 → 空串', () => {
    expect(naiveLineDiff('x\n', 'x\n')).toBe('')
  })
})

describe('previewConfigWrite', () => {
  let dir: string
  let configPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-wb-'))
    configPath = join(dir, 'nx-mk.config.yml')
    writeFileSync(configPath, BASE_YAML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('裸 string 条目被替换为对象条目；注释保留；原文件不动（不落盘）', () => {
    const p = previewConfigWrite(configPath, '@nx-mk/plugin-playwright', { url: 'http://new' })
    expect(p.valid).toBe(true)
    expect(p.errors).toEqual([])
    expect(p.newYaml).toContain("name: '@nx-mk/plugin-playwright'")
    expect(p.newYaml).toContain('url: http://new')
    expect(p.newYaml).toContain('# 采集插件（注释行必须原样保留）')
    expect(p.newYaml).toContain('maxTurns: 3')
    expect(p.diff).toContain("-   - '@nx-mk/plugin-playwright'")
    expect(p.diff).toContain('+   - name:')
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML) // preview 不落盘
    expect(existsSync(join(dir, 'nx-mk.config.yml.bak'))).toBe(false)
  })

  it('yamlSha = 写前文件内容的 sha256', () => {
    const p = previewConfigWrite(configPath, '@nx-mk/plugin-playwright', {})
    expect(p.yamlSha).toBe(sha256Text(BASE_YAML))
  })

  it('E4：插件不在 plugins 列表 → PLUGIN_NOT_IN_CONFIG', () => {
    expect(() => previewConfigWrite(configPath, 'not-listed-pkg', {})).toThrow(ConfigWriteError)
    try {
      previewConfigWrite(configPath, 'not-listed-pkg', {})
    } catch (err) {
      expect((err as ConfigWriteError).code).toBe('PLUGIN_NOT_IN_CONFIG')
    }
  })

  it('E2：config 文件缺失 → CONFIG_FILE_MISSING（不自动创建）', () => {
    expect(() => previewConfigWrite(join(dir, 'absent.yml'), 'p', {})).toThrowConfigErrorCode('CONFIG_FILE_MISSING')
  })

  it('E3：不可解析 YAML → CONFIG_UNPARSEABLE', () => {
    writeFileSync(configPath, 'plugins: [unclosed', 'utf8')
    expect(() => previewConfigWrite(configPath, 'p', {})).toThrowConfigErrorCode('CONFIG_UNPARSEABLE')
  })

  it('plugins 键不存在 → E4（无法定位条目）', () => {
    writeFileSync(configPath, 'logLevel: info\n', 'utf8')
    expect(() => previewConfigWrite(configPath, 'p', {})).toThrowConfigErrorCode('PLUGIN_NOT_IN_CONFIG')
  })
})

describe('applyConfigWrite', () => {
  let dir: string
  let configPath: string
  let bakPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-wb-'))
    configPath = join(dir, 'nx-mk.config.yml')
    bakPath = join(dir, 'nx-mk.config.yml.bak')
    writeFileSync(configPath, BASE_YAML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('原子写生效 + .bak 保留原文 + 返回新文件 sha + 无 tmp 残留', () => {
    const sha = sha256Text(BASE_YAML)
    const r = applyConfigWrite(configPath, '@nx-mk/plugin-playwright', { url: 'http://v1' }, sha)
    expect(r.applied).toBe(true)
    expect(r.bakPath).toBe(bakPath)
    expect(readFileSync(bakPath, 'utf8')).toBe(BASE_YAML)
    const updated = readFileSync(configPath, 'utf8')
    expect(updated).toContain('url: http://v1')
    expect(updated).toContain('maxTurns: 3')
    expect(r.yamlSha).toBe(sha256Text(updated))
    // 原子性：目录里除 .bak 外无 tmp 残留
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })

  it('E5：sha 与盘上不符 → SHA_MISMATCH，文件保持原样', () => {
    expect(() =>
      applyConfigWrite(configPath, '@nx-mk/plugin-playwright', {}, 'deadbeef'),
    ).toThrowConfigErrorCode('SHA_MISMATCH')
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML)
    expect(existsSync(bakPath)).toBe(false)
  })

  it('E5：preview 与 apply 之间文件被外部修改 → SHA_MISMATCH', () => {
    const sha = sha256Text(BASE_YAML)
    writeFileSync(configPath, BASE_YAML.replace('maxTurns: 3', 'maxTurns: 99'), 'utf8')
    expect(() => applyConfigWrite(configPath, '@nx-mk/plugin-playwright', {}, sha)).toThrowConfigErrorCode('SHA_MISMATCH')
  })
})

// toThrowConfigErrorCode 辅助断言（避免每个用例重复 try/catch）
declare module 'vitest' {
  interface Assertion<T> {
    toThrowConfigErrorCode: (code: ConfigWriteError['code']) => void
  }
}
expect.extend({
  toThrowConfigErrorCode(fn: () => unknown, code: ConfigWriteError['code']) {
    let caught: unknown = null
    try {
      fn()
    } catch (err) {
      caught = err
    }
    const pass =
      caught instanceof ConfigWriteError && (caught as ConfigWriteError).code === code
    return { pass, message: () => `expected ConfigWriteError(${code}), got ${String(caught)}` }
  },
})
