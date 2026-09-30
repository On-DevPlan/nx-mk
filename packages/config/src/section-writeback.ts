/**
 * 顶层配置段写回（C12，§30.2 PATCH /api/settings/:section）。
 *
 * 与插件条目写回（renderConfigYaml → plugins[i] 替换）共用同一套纪律：
 * round-trip 保注释/格式（W5）→ 自伤防护（E6）→ naive diff → apply 时
 * .bak 单代备份 + tmp+rename 原子落盘（W6/W7）。区别只在落点：
 * 顶层 section（coverage/agent/replay）整体替换为 { section, value } map；
 * value 为 null/default 时**删除**该顶层键（回到「段不存在=安全默认」语义）。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isMap, parseDocument, type YAMLMap } from 'yaml'
import { ConfigWriteError, naiveLineDiff, sha256Text, type ConfigWritePreview, type ConfigWriteApplyResult } from './writeback.js'

/** C12 可写顶层段白名单（settings PATCH 面；其余段不开写口） */
export const TOP_LEVEL_SECTIONS = ['coverage', 'agent', 'replay'] as const
export type TopLevelSection = (typeof TOP_LEVEL_SECTIONS)[number]

/** round-trip 核心：定位/替换（isKey!==false）或删除（value=DELETE）顶层段 */
function renderSectionYaml(
  originalYaml: string,
  section: TopLevelSection,
  value: Record<string, unknown> | null, // null = 删除段
): { newYaml: string; diff: string } {
  const doc = parseDocument(originalYaml)
  if (doc.errors.length > 0) {
    throw new ConfigWriteError('CONFIG_UNPARSEABLE', `config file unparseable: ${doc.errors[0]?.message ?? 'unknown'}`)
  }
  if (value === null) {
    doc.deleteIn([section])
  } else {
    doc.setIn([section], value)
  }
  const newYaml = doc.toString({ singleQuote: true })
  const reParsed = parseDocument(newYaml)
  if (reParsed.errors.length > 0) {
    throw new ConfigWriteError('YAML_SELF_HARM', `refusing to write: rendered yaml no longer parses: ${reParsed.errors[0]?.message ?? 'unknown'}`)
  }
  return { newYaml, diff: naiveLineDiff(originalYaml, newYaml) }
}

export interface SettingsReadResult {
  sections: { coverage: Record<string, unknown> | null; agent: Record<string, unknown> | null; replay: Record<string, unknown> | null }
  yamlSha: string
}

/** 读取三段现值（段不存在 → null）+ 现文 sha（PATCH apply 复核用）。不解析即无段。 */
export function readSettings(configPath: string): SettingsReadResult {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  const doc = parseDocument(raw)
  if (doc.errors.length > 0) {
    throw new ConfigWriteError('CONFIG_UNPARSEABLE', `config file unparseable: ${doc.errors[0]?.message ?? 'unknown'}`)
  }
  const read = (key: TopLevelSection): Record<string, unknown> | null => {
    const node: unknown = doc.get(key, true)
    // 仅 plain map 可编辑往返；非 map（标量/数组）按 null 诚实显示（写回时整体覆盖）
    if (isMap(node as YAMLMap | undefined)) return (node as YAMLMap).toJSON() as Record<string, unknown>
    return null
  }
  return { sections: { coverage: read('coverage'), agent: read('agent'), replay: read('replay') }, yamlSha: sha256Text(raw) }
}

/** E2 门 + 渲染 + sha（不落盘）。**深度 schema 校验由调用方（路由层）先行**，与 WP2 同约定。 */
export function previewSectionWrite(
  configPath: string,
  section: TopLevelSection,
  value: Record<string, unknown> | null,
): ConfigWritePreview {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  const { newYaml, diff } = renderSectionYaml(raw, section, value)
  return { valid: true, errors: [], newYaml, yamlSha: sha256Text(raw), diff }
}

/** 两段式 apply：sha 复核 → .bak 单代备份 → tmp+rename 原子写（同 writeback W6/W7） */
export function applySectionWrite(
  configPath: string,
  section: TopLevelSection,
  value: Record<string, unknown> | null,
  expectedSha: string,
): ConfigWriteApplyResult {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  if (sha256Text(raw) !== expectedSha) {
    throw new ConfigWriteError('SHA_MISMATCH', 'config changed since preview — re-preview')
  }
  const { newYaml, diff } = renderSectionYaml(raw, section, value)
  const bakPath = `${configPath}.bak`
  writeFileSync(bakPath, raw, 'utf8')
  const tmpPath = join(dirname(configPath), `.${(configPath.split(/[\\/]/).pop() ?? 'config')}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  try {
    writeFileSync(tmpPath, newYaml, 'utf8')
    renameSync(tmpPath, configPath)
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // tmp 清理失败不影响错误上抛（E7）
    }
    throw err
  }
  return { applied: true, diff, bakPath, yamlSha: sha256Text(newYaml) }
}
