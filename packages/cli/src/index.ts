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

type Subcommand = 'run' | 'init' | 'doctor'

interface ParsedArgs {
  subcommand: Subcommand
  configPath?: string
  logLevel?: LogLevel
  outputDir?: string
  runId?: string
  help: boolean
  version: boolean
}

const HELP = `nx-mk — OpenAPI-driven API/UI coverage analyzer

Usage:
  npx nx-mk [subcommand] [options]

Subcommands:
  run      (default) Run the full pipeline against the current project
  init     Scaffold nx-mk.config.yml and .nx-mk/ directory
  doctor   Verify the environment (Node, config, plugins)

Options:
  --config <path>        Path to nx-mk.config.yml (overrides lookup)
  --log-level <level>    debug | info | warn | error | silent
  --output-dir <path>    Output directory for run artifacts (default ./.nx-mk/runs)
  --run-id <id>          Override the auto-generated run id
  --version, -v          Print version and exit
  --help, -h             Print this help and exit

Examples:
  npx nx-mk init
  npx nx-mk doctor
  npx nx-mk run --log-level debug
`

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    subcommand: 'run',
    help: false,
    version: false,
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
      case 'run':
      case 'init':
      case 'doctor':
        out.subcommand = a
        break
      default:
        if (a && a.startsWith('--')) {
          throw new KernelError('KERNEL_INTERNAL', `Unknown flag: ${a}`)
        }
    }
  }
  return out
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.version) {
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
    case 'doctor': {
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
    case 'run': {
      const configPath = await resolveConfigPath(args.configPath)
      await runMain({
        configPath,
        runId: args.runId ?? generateRunId(),
        cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir },
      })
      return
    }
  }
}

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
