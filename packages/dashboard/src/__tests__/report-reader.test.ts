import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readCoverageReport, reportForRun } from '../server/store/report-reader.js'
import { makeNxMkDir, reportFixture, writeReportFile } from './fixtures.js'

let dir: string
beforeEach(() => { dir = makeNxMkDir([]) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readCoverageReport', () => {
  it('valid report → object', () => {
    writeReportFile(dir, reportFixture('run_a'))
    expect(readCoverageReport(dir)?.runId).toBe('run_a')
  })
  it('missing file → null', () => {
    expect(readCoverageReport(dir)).toBeNull()
  })
  it('broken JSON → null', () => {
    writeFileSync(join(dir, 'coverage-report.json'), '{oops')
    expect(readCoverageReport(dir)).toBeNull()
  })
  it('shape invalid (metrics missing) → null', () => {
    writeFileSync(join(dir, 'coverage-report.json'), JSON.stringify({ runId: 'run_a' }))
    expect(readCoverageReport(dir)).toBeNull()
  })
  it('shape invalid (metric not number) → null', () => {
    const r = reportFixture('run_a')
    ;(r.metrics as unknown as { requiredCoverage: string }).requiredCoverage = '100%'
    writeReportFile(dir, r)
    expect(readCoverageReport(dir)).toBeNull()
  })
  it('missing arrays default to []', () => {
    const r = reportFixture('run_a') as unknown as Record<string, unknown>
    delete r.requests
    delete r.suspiciousCoverage
    writeFileSync(join(dir, 'coverage-report.json'), JSON.stringify(r))
    const parsed = readCoverageReport(dir)
    expect(parsed?.requests).toEqual([])
    expect(parsed?.suspiciousCoverage).toEqual([])
  })
})

describe('reportForRun (runId 匹配门控)', () => {
  it('matching runId → report', () => {
    writeReportFile(dir, reportFixture('run_b'))
    expect(reportForRun(dir, 'run_b')?.runId).toBe('run_b')
  })
  it('older run (mismatch) → null（report 是最新 run 的覆盖写产物，spec D12）', () => {
    writeReportFile(dir, reportFixture('run_b'))
    expect(reportForRun(dir, 'run_a')).toBeNull()
  })
  it('no report → null', () => {
    expect(reportForRun(dir, 'run_b')).toBeNull()
  })
})
