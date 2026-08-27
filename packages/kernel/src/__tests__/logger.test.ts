import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger, type Logger } from '../logger'

let workDir: string
let kernelLogPath: string
let errorLogPath: string
let logger: Logger

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-logger-'))
  kernelLogPath = join(workDir, 'kernel.log')
  errorLogPath = join(workDir, 'error.log')
  logger = createLogger({ runId: 'run_test', logLevel: 'debug', logFile: kernelLogPath, errorFile: errorLogPath })
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function parseNdjson(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
}

describe('createLogger', () => {
  it('writes one NDJSON line per call with timestamp, level, runId, msg', async () => {
    logger.info('hello world', { extra: 1 })
    await logger.flush()
    const lines = parseNdjson(kernelLogPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'info',
      runId: 'run_test',
      msg: 'hello world',
      meta: { extra: 1 },
    })
    expect(typeof lines[0]!.ts).toBe('string')
  })

  it('respects logLevel: filters out lower-priority entries', async () => {
    const filtered = createLogger({ runId: 'r', logLevel: 'warn', logFile: kernelLogPath })
    filtered.debug('d')
    filtered.info('i')
    filtered.warn('w')
    filtered.error('e')
    await filtered.flush()
    const lines = parseNdjson(kernelLogPath)
    expect(lines.map((l) => l.msg)).toEqual(['w', 'e'])
  })

  it('mirror to stderr at the right level', async () => {
    const captured: string[] = []
    const mirror = createLogger({ runId: 'r', logLevel: 'info', logFile: kernelLogPath, stderr: (s) => captured.push(s) })
    mirror.info('to-stderr')
    await mirror.flush()
    expect(captured.join('')).toContain('to-stderr')
  })

  it('always writes error level to errorFile even when logLevel=silent', async () => {
    const silent = createLogger({ runId: 'r', logLevel: 'silent', logFile: kernelLogPath, errorFile: errorLogPath })
    silent.error('critical', { code: 'X' })
    await silent.flush()
    // kernel.log: empty
    expect(() => readFileSync(kernelLogPath, 'utf8')).not.toThrow()
    expect(readFileSync(kernelLogPath, 'utf8').trim()).toBe('')
    // error.log: has the line
    const errLines = parseNdjson(errorLogPath)
    expect(errLines).toHaveLength(1)
    expect(errLines[0]).toMatchObject({ level: 'error', msg: 'critical', meta: { code: 'X' } })
  })

  it('logger.error attaches the cause stack as meta', async () => {
    const cause = new Error('underlying')
    logger.error('top-level', { cause })
    await logger.flush()
    const lines = parseNdjson(kernelLogPath)
    expect(lines[0]!.meta).toMatchObject({ cause: { message: 'underlying' } })
  })
})
