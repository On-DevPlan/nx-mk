/**
 * 用户配置写回引擎（spec v1 W5/W6/W7，WP1：本文件是 config.yml 的唯一写者）。
 *
 * 职责链：读原文 → sha 校验（apply）→ yaml Document round-trip 定位并替换目标插件条目
 * → dump 新文本 → 自伤防护（E6：新文本必须可再解析）→ naive diff →
 * apply 时 .bak 单代备份 + tmp+rename 原子落盘。
 * 全程不解析成普通对象再 stringify——那会砸掉用户注释与格式（W5）。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

export type ConfigWriteErrorCode =
  | 'CONFIG_FILE_MISSING'   // E2：409
  | 'CONFIG_UNPARSEABLE'    // E3：409
  | 'PLUGIN_NOT_IN_CONFIG'  // E4：404
  | 'SHA_MISMATCH'          // E5：409
  | 'YAML_SELF_HARM'        // E6：500（路由映射处维护 HTTP 码）

export class ConfigWriteError extends Error {
  constructor(
    readonly code: ConfigWriteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConfigWriteError'
  }
}

export interface ConfigWritePreview {
  valid: true
  errors: string[]
  newYaml: string
  yamlSha: string
  diff: string
}

export interface ConfigWriteApplyResult {
  applied: true
  diff: string
  bakPath: string
  yamlSha: string
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** naive 行级 diff（无 diff 依赖可用，D2）：只输出变更行（- 旧 / + 新），无上下文行 */
export function naiveLineDiff(before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: string[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) out.push(`- ${a[i]}`)
    if (b[i] !== undefined) out.push(`+ ${b[i]}`)
  }
  return out.join('\n')
}

/**
 * round-trip 核心（纯函数，不落盘）：在原文里定位 pluginName 条目并整体替换为
 * { name, config } 对象条目，dump 新文本并做自伤防护。
 * 裸 string 条目与对象条目都可作为定位目标（W3 向后兼容）。
 */
function renderConfigYaml(
  originalYaml: string,
  pluginName: string,
  config: Record<string, unknown>,
): { newYaml: string; diff: string } {
  const doc = parseDocument(originalYaml)
  if (doc.errors.length > 0) {
    throw new ConfigWriteError('CONFIG_UNPARSEABLE', `config file unparseable: ${doc.errors[0]?.message ?? 'unknown'}`)
  }
  // keepScalar=true：节点形式返回，isSeq/isScalar/isMap 正规收窄（yaml 官方类型守卫）
  const pluginsNode: unknown = doc.get('plugins', true)
  if (!isSeq(pluginsNode)) {
    throw new ConfigWriteError('PLUGIN_NOT_IN_CONFIG', `plugin not in config: ${pluginName} (no plugins list)`)
  }
  let targetIndex = -1
  for (let i = 0; i < pluginsNode.items.length; i++) {
    const item: unknown = doc.getIn(['plugins', i], true)
    if (isScalar(item)) {
      // 裸 string 标量条目（W3 向后兼容定位）
      if (item.value === pluginName) {
        targetIndex = i
        break
      }
    } else if (isMap(item)) {
      // 对象条目：读 name 键的标量值
      const nameNode: unknown = item.get('name', true)
      if (isScalar(nameNode) && nameNode.value === pluginName) {
        targetIndex = i
        break
      }
    }
  }
  if (targetIndex === -1) {
    throw new ConfigWriteError('PLUGIN_NOT_IN_CONFIG', `plugin not in config: ${pluginName}`)
  }
  // 探针已验证：plain JS 对象可直接 set，dump 为 name/config map；未触及条目与注释原样保留
  doc.setIn(['plugins', targetIndex], { name: pluginName, config })
  // singleQuote：新建节点需引号时按单引号风格（与既有配置文件一致）；已解析节点保留原 CST 引号风格
  const newYaml = doc.toString({ singleQuote: true })
  // E6 自伤防护：dump 结果必须可再解析，否则拒绝落盘
  const reParsed = parseDocument(newYaml)
  if (reParsed.errors.length > 0) {
    throw new ConfigWriteError('YAML_SELF_HARM', `refusing to write: rendered yaml no longer parses: ${reParsed.errors[0]?.message ?? 'unknown'}`)
  }
  return { newYaml, diff: naiveLineDiff(originalYaml, newYaml) }
}

/** E2 门 + 渲染 + sha（不落盘）。WP2：本函数不做 configSchema 深度校验（形状门在路由层）。 */
export function previewConfigWrite(
  configPath: string,
  pluginName: string,
  config: Record<string, unknown>,
): ConfigWritePreview {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  const { newYaml, diff } = renderConfigYaml(raw, pluginName, config)
  return { valid: true, errors: [], newYaml, yamlSha: sha256Text(raw), diff }
}

/**
 * 两段式 apply（W6/W7）：sha 复核 → .bak 单代备份（覆盖式）→ tmp+rename 原子写。
 * E7：任何写失败清理 tmp 后重抛；.bak 已落则手动可恢复。
 */
export function applyConfigWrite(
  configPath: string,
  pluginName: string,
  config: Record<string, unknown>,
  expectedSha: string,
): ConfigWriteApplyResult {
  if (!existsSync(configPath)) {
    throw new ConfigWriteError('CONFIG_FILE_MISSING', `config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  if (sha256Text(raw) !== expectedSha) {
    throw new ConfigWriteError('SHA_MISMATCH', 'config changed since preview — re-preview')
  }
  const { newYaml, diff } = renderConfigYaml(raw, pluginName, config)
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
