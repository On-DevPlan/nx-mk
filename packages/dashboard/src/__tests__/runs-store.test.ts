import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listRuns } from '../server/store/runs-store.js'
import { makeNxMkDir } from './fixtures.js'

let dir: string
beforeEach(() => { dir = '' })
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('listRuns', () => {
  it('lists run dirs sorted asc with events flag; ignores files', () => {
    dir = makeNxMkDir([
      { runId: 'run_20260917_100000', withEvents: true },
      { runId: 'run_20260917_100005' },
    ])
    writeFileSync(join(dir, 'runs', 'a-file.txt'), 'x') // 非目录项忽略
    expect(listRuns(dir)).toEqual([
      { runId: 'run_20260917_100000', hasEvents: true },
      { runId: 'run_20260917_100005', hasEvents: false },
    ])
  })

  it('empty .nx-mk → []', () => {
    dir = makeNxMkDir([])
    expect(listRuns(dir)).toEqual([])
  })

  it('missing .nx-mk → [] (spec §4 降级)', () => {
    expect(listRuns(join(dir, 'nope') || 'definitely-missing-path')).toEqual([])
  })
})
