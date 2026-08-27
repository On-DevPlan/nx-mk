/**
 * 配置加载器 —— YAML 读取、Zod 校验与优先级合并（file → env → CLI）
 *
 * findConfigFile 从给定目录逐级向上查找 nx-mk.config.{yml,yaml}；
 * loadConfig 读取并校验配置文件，叠加环境变量（nx_mk_*）与 CLI 覆盖，
 * 合并后再次校验并返回运行期 ResolvedConfig。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ConfigSchema } from './schema'
import { KernelError, makeRunId, type Config, type LogLevel, type ResolvedConfig, type RunId } from '@nx-mk/kernel'

// 支持的配置文件名（yml 优先于 yaml 检查）
const CONFIG_FILENAMES = ['nx-mk.config.yml', 'nx-mk.config.yaml'] as const

// 从 cwd 逐级向上查找配置文件，直到文件系统根（Windows 为盘符根）
export async function findConfigFile(cwd: string): Promise<string> {
  let dir = resolve(cwd)
  // 计算向上查找的终点：Windows 取盘符根（如 D:\），POSIX 取 '/'
  const root = isAbsolute(dir) ? process.platform === 'win32' ? dir.split(/[\\/]/)[0] : '/' : '/'
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new KernelError(
    'CONFIG_NOT_FOUND',
    `No nx-mk.config.{yml,yaml} found in ${cwd} or any parent directory`,
  )
}

// 读取环境变量覆盖：nx_mk_LOG_LEVEL 与 nx_mk_OUTPUT_DIR（env 可注入便于测试）
function readEnvOverrides(env: NodeJS.ProcessEnv = process.env): Partial<Config> {
  const out: Partial<Config> = {}
  if (typeof env.nx_mk_LOG_LEVEL === 'string') {
    out.logLevel = env.nx_mk_LOG_LEVEL as LogLevel
  }
  if (typeof env.nx_mk_OUTPUT_DIR === 'string') {
    out.outputDir = env.nx_mk_OUTPUT_DIR
  }
  return out
}

// loadConfig 的入参：文件路径 + 运行期上下文；cliOverrides/env 可选注入
export interface LoadConfigInput {
  path: string
  cwd: string
  runId: RunId
  subcommand: 'run' | 'init' | 'doctor'
  cliOverrides?: Partial<Config>
  env?: NodeJS.ProcessEnv
}

// 加载配置文件 → 校验 → 合并 env/CLI 覆盖 → 复验 → 返回最终 ResolvedConfig。
// 任何一步失败都包装为 KernelError(CONFIG_INVALID / CONFIG_NOT_FOUND)，供退出码映射。
export async function loadConfig(input: LoadConfigInput): Promise<ResolvedConfig> {
  let raw: unknown
  // 读取并解析 YAML；失败（文件不可读或 YAML 语法错）→ CONFIG_INVALID
  try {
    const text = readFileSync(input.path, 'utf8')
    raw = parseYaml(text)
  } catch (err) {
    throw new KernelError(
      'CONFIG_INVALID',
      `Failed to read or parse ${input.path}: ${(err as Error).message}`,
      err,
    )
  }

  // 文件级校验：不通过则抛出带逐字段错误清单的 CONFIG_INVALID
  const fileParse = ConfigSchema.safeParse(raw)
  if (!fileParse.success) {
    throw new KernelError(
      'CONFIG_INVALID',
      `Invalid config: ${input.path}\n${fileParse.error.issues
        .map((i) => `  × ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    )
  }
  const fileCfg: Config = fileParse.data

  const envOverrides = readEnvOverrides(input.env)
  const cliOverrides = input.cliOverrides ?? {}

  // Precedence: file → env → CLI
  // 中文：合并优先级——文件 < 环境变量 < CLI 参数（后者覆盖前者）
  const merged: Config = { ...fileCfg, ...envOverrides, ...cliOverrides }
  // 合并后再次校验，防止覆盖值本身非法（如 CLI 传入无效 logLevel）
  const mergedParse = ConfigSchema.safeParse(merged)
  if (!mergedParse.success) {
    throw new KernelError(
      'CONFIG_INVALID',
      `Invalid merged config: ${mergedParse.error.issues
        .map((i) => `  × ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    )
  }

  return {
    ...mergedParse.data,
    configPath: resolve(input.path),
    runId: input.runId ?? makeRunId('run_unknown'),
    envOverrides,
    cliOverrides,
    subcommand: input.subcommand,
  }
}

// makeRunId is re-imported here only to keep the unused-import warning away.
// 中文：makeRunId 仅被 import 供 runId 缺省值使用，此行避免未使用告警
void makeRunId
