/**
 * CLI 入口 —— argv 解析与子命令路由
 *
 * 三个子命令：run（默认，完整 5 阶段生命周期）、init（脚手架）、doctor（环境检查）；
 * --help / --version 直接短路输出。顶层 catch 把 KernelError 按错误码映射为
 * 进程退出码（2/3/4/5，见 kernel 的 mapErrorCodeToExit）。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  KernelError,
  mapErrorCodeToExit,
  makeRunId,
  type LogLevel,
} from '@nx-mk/kernel'
import { runMain } from './commands/run.js'
import { runInit } from './commands/init.js'
import { runDoctor } from './commands/doctor.js'
import { runMigrate } from './commands/migrate.js'
import { startMain } from './commands/start.js'
import { loopMain } from './commands/loop.js'
import { reportMain } from './commands/report.js'
import { replayMain } from './commands/replay.js'

// 子命令联合类型（run 为缺省值）
type Subcommand = 'run' | 'init' | 'doctor' | 'migrate' | 'start' | 'loop' | 'report' | 'replay'

// argv 解析结果：子命令 + 各类全局选项（config/logLevel/outputDir/runId 可覆盖配置）
interface ParsedArgs {
  subcommand: Subcommand
  configPath?: string
  logLevel?: LogLevel
  outputDir?: string
  runId?: string
  help: boolean
  version: boolean
  /** 非旗标位置参数（report/replay 的目标：kind 与 id 等） */
  positionals: string[]
  report: {
    open: boolean
  }
  replay: {
    confirm: boolean
  }
  migrate: {
    manifestPath?: string
    dir?: string
    apiPrefix?: string
    importSpecifier?: string
    dryRun: boolean
    json: boolean
  }
  start: {
    port?: number
    noRun: boolean
  }
  loop: {
    maxIterations?: number
  }
}

const HELP = `nx-mk — OpenAPI-driven API/UI coverage analyzer

Usage:
  npx nx-mk [subcommand] [options]

Subcommands:
  run      (default) Run the full pipeline against the current project
  init     Scaffold nx-mk.config.yml and .nx-mk/ directory
  doctor   Verify the environment (Node, config, plugins)
  migrate  Migrate static fetch('/api/...') calls to api.ns.method() (SDK-CG3)
  start    Start the local Dashboard at 127.0.0.1:4317 (auto-runs analysis unless --no-run)
  loop     Run the Agent Loop: turn coverage gaps into suggested diffs (no workspace writes)
  report   Print coverage report summary and artifact paths (--open opens the report file)
  replay   Replay a request or a scenario: replay request <runId> <requestId> | replay scenario <id>

Options:
  --config <path>        Path to nx-mk.config.yml (overrides lookup)
  --log-level <level>    debug | info | warn | error | silent
  --output-dir <path>    Output directory for run artifacts (default ./.nx-mk/runs)
  --run-id <id>          Override the auto-generated run id
  --port <n>             Dashboard port (start only; overrides config dashboard.port)
  --no-run               (start) serve existing artifacts without running analysis
  --max-iterations <n>   (loop) override agent.loop.maxIterations
  --confirm              (replay request) confirm non-safe method replay
  --open                 (report) open coverage-report.json with the system viewer
  --manifest <path>      Path to .nx-mk/manifest.json (migrate only, default ./.nx-mk/manifest.json)
  --dir <path>           Source dir to scan (migrate only, default ./src)
  --api-prefix <prefix>  fetch URL prefix (migrate only, default /api)
  --import <specifier>   Import specifier for api (migrate only, default ./generated-sdk)
  --dry-run              Report without writing files (migrate only)
  --json                 Machine-readable JSON report (migrate only)
  --version, -v          Print version and exit
  --help, -h             Print this help and exit

Examples:
  npx nx-mk init
  npx nx-mk doctor
  npx nx-mk run --log-level debug
`

// 手写轻量解析器（无第三方依赖）：逐个 token 匹配旗标与子命令；
// 遇到未知 --flag 抛 KERNEL_INTERNAL，非 -- 开头的其他 token 静默忽略
function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    subcommand: 'run',
    help: false,
    version: false,
    positionals: [],
    report: { open: false },
    replay: { confirm: false },
    migrate: { dryRun: false, json: false },
    start: { noRun: false },
    loop: {},
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--help':
      case '-h':
        out.help = true
        break
      case '--version':
      case '-v':
        out.version = true
        break
      case '--config':
        out.configPath = argv[++i]
        break
      case '--log-level':
        out.logLevel = argv[++i] as LogLevel
        break
      case '--output-dir':
        out.outputDir = argv[++i]
        break
      case '--run-id':
        out.runId = argv[++i]
        break
      case '--port': {
        const raw = argv[++i]
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          throw new KernelError('KERNEL_INTERNAL', `Invalid --port: ${raw}`)
        }
        out.start.port = n
        break
      }
      case '--no-run':
        out.start.noRun = true
        break
      case '--manifest':
        out.migrate.manifestPath = argv[++i]
        break
      case '--dir':
        out.migrate.dir = argv[++i]
        break
      case '--api-prefix':
        out.migrate.apiPrefix = argv[++i]
        break
      case '--import':
        out.migrate.importSpecifier = argv[++i]
        break
      case '--dry-run':
        out.migrate.dryRun = true
        break
      case '--max-iterations': {
        const raw = argv[++i]
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 1) {
          throw new KernelError('KERNEL_INTERNAL', `Invalid --max-iterations: ${raw}`)
        }
        out.loop.maxIterations = n
        break
      }
      case '--json':
        out.migrate.json = true
        break
      case '--confirm':
        out.replay.confirm = true
        break
      case '--open':
        out.report.open = true
        break
      case 'run':
      case 'init':
      case 'doctor':
      case 'migrate':
      case 'start':
      case 'loop':
      case 'report':
      case 'replay':
        out.subcommand = a
        break
      default:
        if (a && a.startsWith('--')) {
          throw new KernelError('KERNEL_INTERNAL', `Unknown flag: ${a}`)
        }
        if (a) out.positionals.push(a)
    }
  }
  return out
}

// 解析配置文件路径：显式传入则校验存在性（不存在抛 CONFIG_NOT_FOUND），
// 否则委托 @nx-mk/config 的 findConfigFile 向上查找
async function resolveConfigPath(arg: string | undefined): Promise<string> {
  if (arg) {
    const abs = resolve(process.cwd(), arg)
    if (!existsSync(abs)) {
      throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${abs}`)
    }
    return abs
  }
  const { findConfigFile } = await import('@nx-mk/config')
  return findConfigFile(process.cwd())
}

// 主流程：解析 argv → 处理 --version/--help 短路 → 按子命令分发
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.version) {
    // 版本号硬编码与 package.json 保持一致
    console.log('0.1.0')
    return
  }
  if (args.help) {
    console.log(HELP)
    return
  }

  switch (args.subcommand) {
    case 'init':
      await runInit({
        configPath: args.configPath ? resolve(process.cwd(), args.configPath) : resolve(process.cwd(), 'nx-mk.config.yml'),
      })
      return
    case 'migrate':
      await runMigrate(args.migrate)
      return
    case 'doctor': {
      // doctor 允许配置缺失：找不到配置时降级为 undefined 继续体检（该项检查会标记失败）
      let configPath: string | undefined
      try {
        configPath = await resolveConfigPath(args.configPath)
      } catch (err) {
        if (err instanceof KernelError && err.code === 'CONFIG_NOT_FOUND') {
          configPath = undefined
        } else {
          throw err
        }
      }
      await runDoctor({ configPath, runId: args.runId ?? 'doctor', cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir } })
      return
    }
    case 'start': {
      // start 必须有配置文件（dashboard 段 + run 装配都从 config 读）
      const configPath = await resolveConfigPath(args.configPath)
      await startMain({
        configPath,
        runId: args.runId ?? generateRunId(),
        ...(args.start.port !== undefined ? { port: args.start.port } : {}),
        ...(args.start.noRun ? { noRun: true } : {}),
        cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir },
      })
      return
    }
    case 'loop': {
      // loop 必须有配置文件（agent 段可选 —— 全默认值可跑）
      const configPath = await resolveConfigPath(args.configPath)
      await loopMain({
        configPath,
        ...(args.loop.maxIterations !== undefined ? { maxIterations: args.loop.maxIterations } : {}),
        cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir },
      })
      return
    }
    case 'run': {
      // run 必须有配置文件；未显式指定 runId 时按时间戳自动生成
      const configPath = await resolveConfigPath(args.configPath)
      await runMain({
        configPath,
        runId: args.runId ?? generateRunId(),
        cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir },
      })
      return
    }
    case 'report': {
      // report 只读产物，不需要配置文件（产物缺失即 RUN_NOT_FOUND）
      await reportMain({
        ...(args.report.open ? { open: true } : {}),
      })
      return
    }
    case 'replay': {
      // replay 需要配置文件（replay: 规则与 scenarios: 段都从 config 读）
      const configPath = await resolveConfigPath(args.configPath)
      const [kind, ...rest] = args.positionals
      if (kind !== undefined && kind !== 'request' && kind !== 'scenario') {
        throw new KernelError('KERNEL_INTERNAL', `unknown replay target: ${kind} — use 'request' or 'scenario'`)
      }
      await replayMain({
        ...(kind !== undefined ? { kind } : {}),
        args: rest,
        configPath,
        ...(args.replay.confirm ? { confirm: true } : {}),
      })
      return
    }
  }
}

// 生成形如 run_YYYYMMDD_HHMMSS 的运行 ID（目录名安全、可按时间排序）
function generateRunId(): ReturnType<typeof makeRunId> {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const HH = String(now.getHours()).padStart(2, '0')
  const MM = String(now.getMinutes()).padStart(2, '0')
  const SS = String(now.getSeconds()).padStart(2, '0')
  return makeRunId(`run_${yyyy}${mm}${dd}_${HH}${MM}${SS}`)
}

// 顶层错误出口：KernelError 按错误码映射退出码（2/3/4/5）并打印错误与 cause；
// 其余未知错误退出码 1。设置 exitCode 而非 process.exit，保证 stdout 刷盘
main().catch((err: unknown) => {
  if (err instanceof KernelError) {
    process.exitCode = mapErrorCodeToExit(err.code)
    console.error(`✖ ${err.code}: ${err.message}`)
    if (err.cause instanceof Error) {
      console.error(`  cause: ${err.cause.message}`)
    }
  } else {
    process.exitCode = 1
    console.error('Unexpected error:', err)
  }
})
