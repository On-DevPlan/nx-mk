/**
 * coverage db —— better-sqlite3 wrapper（spec §3.3）：WAL、幂等建表、事务批量 flush。
 * 无 migrations 框架（YAGNI）：CREATE TABLE IF NOT EXISTS，schema 漂移留给 Phase 4。
 */
import Database from 'better-sqlite3'
import type { Statement as SqliteStatement } from 'better-sqlite3'
import { SCHEMA_SQL, ensureColumn } from './schema.js'
import type { FieldHitCore, RequestTraceCore, UiEvidenceCore } from '@nx-mk/client/collector'

export type DrainedHit = FieldHitCore & { count: number }

export interface FlushInput {
  runId: string
  hits: DrainedHit[]
  traces: RequestTraceCore[]
  evidence: UiEvidenceCore[]
}

export class CoverageDb {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    for (const stmt of SCHEMA_SQL) this.db.exec(stmt)
    // schema 演进（spec §3.1/§3.4）：§25 DDL 冻结，新列幂等 ALTER 落地
    ensureColumn(this.db, 'runs', 'terminated_by', 'TEXT')
    ensureColumn(this.db, 'ui_evidence', 'text_sample', 'TEXT')
  }

  get journalMode(): string {
    return this.db.pragma('journal_mode', { simple: true }) as string
  }

  pragma(sql: string, opts?: { simple?: boolean }): unknown {
    return this.db.pragma(sql, opts as never)
  }

  prepare(sql: string): SqliteStatement {
    return this.db.prepare(sql)
  }

  insertRun(runId: string, startedAt: string, status: string, manifestHash?: string): void {
    this.db.prepare('INSERT OR REPLACE INTO runs (id, started_at, status, manifest_hash) VALUES (?, ?, ?, ?)')
      .run(runId, startedAt, status, manifestHash ?? null)
  }

  endRun(runId: string, endedAt: string, status: string, terminatedBy?: string): void {
    this.db.prepare(
      `UPDATE runs SET ended_at = ?, status = ?, terminated_by = COALESCE(?, terminated_by) WHERE id = ?`,
    ).run(endedAt, status, terminatedBy ?? null, runId)
  }

  /** 事务批量 flush（spec §3.3）：hits 按 normalizedPath 幂等 upsert；traces/evidence 逐条插入 */
  flushDrained(d: FlushInput): void {
    const tx = this.db.transaction(() => {
      // field_hits：§25.6 列全部填充（request_id/endpoint_id/field_id 本版可空）
      const insHit = this.db.prepare(
        `INSERT OR REPLACE INTO field_hits
           (id, run_id, request_id, endpoint_id, field_id, field_path, normalized_path, count, first_hit_at, last_hit_at, route, source)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'proxy')`,
      )
      for (const h of d.hits) {
        const at = new Date(h.timestamp).toISOString()
        insHit.run(
          `fh_${d.runId}_${h.normalizedPath}`, d.runId, h.requestId, h.endpointId,
          h.fieldPath, h.normalizedPath, h.count, at, at,
        )
      }
      // request_traces：§25.4 列（scenario_id/dsl_step_id/replayable/replay_safety/replay_reason Phase 2 无数据 → NULL/默认）
      const insTrace = this.db.prepare(
        `INSERT OR REPLACE INTO request_traces
           (id, run_id, trace_id, scenario_id, dsl_step_id, endpoint_id, method, url, path, status, duration_ms, started_at, ended_at, replayable, replay_safety, replay_reason)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      for (const t of d.traces) {
        insTrace.run(
          `rt_${d.runId}_${t.requestId}`, d.runId, t.requestId, t.endpointId ?? null,
          t.method, t.url, t.path ?? null, t.status ?? null, t.durationMs ?? null,
          t.startedAt ?? null, t.endedAt ?? null,
        )
      }
      // ui_evidence：§25.7 列 + text_sample（§3.4 evidence 文本通道；evidence_type v0=text；screenshot_path 不采 → NULL）
      const insEv = this.db.prepare(
        `INSERT OR REPLACE INTO ui_evidence
           (id, run_id, request_id, field_id, field_path, evidence_type, selector, visible, in_viewport, route, screenshot_path, text_sample)
         VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?, ?, NULL, ?)`,
      )
      for (const e of d.evidence) {
        insEv.run(
          `ue_${d.runId}_${e.fieldPath}`, d.runId, e.requestId ?? null, e.fieldId ?? null,
          e.fieldPath, e.selector ?? null, e.visible ? 1 : 0, e.inViewport ? 1 : 0, e.route ?? null,
          e.textSample ?? null,
        )
      }
    })
    tx()
  }

  close(): void { this.db.close() }
}

export function openCoverageDb(dbPath: string): CoverageDb {
  return new CoverageDb(dbPath)
}
