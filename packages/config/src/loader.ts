import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ConfigSchema } from './schema'
import { KernelError, makeRunId, type Config, type LogLevel, type ResolvedConfig, type RunId } from '@nx-mk/kernel'

const CONFIG_FILENAMES = ['nx-mk.config.yml', 'nx-mk.config.yaml'] as const

export async function findConfigFile(cwd: string): Promise<string> {
  let dir = resolve(cwd)
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

export interface LoadConfigInput {
  path: string
  cwd: string
  runId: RunId
  subcommand: 'run' | 'init' | 'doctor'
  cliOverrides?: Partial<Config>
  env?: NodeJS.ProcessEnv
}

export async function loadConfig(input: LoadConfigInput): Promise<ResolvedConfig> {
  let raw: unknown
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
  const merged: Config = { ...fileCfg, ...envOverrides, ...cliOverrides }
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
void makeRunId
