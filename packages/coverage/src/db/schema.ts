/**
 * §25 SQLite schema —— 9 张表 DDL 逐字（Plan §25.1-25.9）
 * 原文：docx/plan/nx-mk-plan.md 1695-1859 行；幂等建表（IF NOT EXISTS）。
 * 注：endpoints / manifest_fields 列集按 Task 3 pre-flight ruling 最小化定义
 *     （plan 原文与 ruling 冲突时，ruling 优先）。
 */

export const TABLE_NAMES = [
  'runs', 'endpoints', 'manifest_fields', 'request_traces', 'request_fields',
  'field_hits', 'ui_evidence', 'coverage_fields', 'agent_iterations',
] as const

export const SCHEMA_SQL: string[] = [
  // §25.1 runs（plan 逐字）
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    project_name TEXT,
    dashboard_url TEXT,
    manifest_hash TEXT,
    config_path TEXT,
    resolved_config_path TEXT
  )`,
  // endpoints（plan 无 ruling 认可原文；按 ruling 最小列集）
  `CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    operation_id TEXT,
    tags TEXT
  )`,
  // manifest_fields（plan 无 ruling 认可原文；按 ruling 最小列集）
  `CREATE TABLE IF NOT EXISTS manifest_fields (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    endpoint_id TEXT,
    field_path TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    type TEXT,
    required INTEGER,
    nullable INTEGER
  )`,
  // §25.4 request_traces（plan 逐字）
  `CREATE TABLE IF NOT EXISTS request_traces (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    scenario_id TEXT,
    dsl_step_id TEXT,
    endpoint_id TEXT,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    path TEXT,
    status INTEGER,
    duration_ms INTEGER,
    started_at TEXT,
    ended_at TEXT,
    replayable INTEGER,
    replay_safety TEXT,
    replay_reason TEXT
  )`,
  // §25.5 request_fields（plan 逐字）
  `CREATE TABLE IF NOT EXISTS request_fields (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    field_id TEXT,
    field_path TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    value_state TEXT NOT NULL,
    value_type TEXT,
    value_preview TEXT,
    value_hash TEXT,
    policy_status TEXT,
    matched_rule_pattern TEXT,
    matched_rule_reason TEXT
  )`,
  // §25.6 field_hits（plan 逐字）
  `CREATE TABLE IF NOT EXISTS field_hits (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    request_id TEXT,
    endpoint_id TEXT,
    field_id TEXT,
    field_path TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    count INTEGER NOT NULL,
    first_hit_at TEXT,
    last_hit_at TEXT,
    route TEXT,
    source TEXT
  )`,
  // §25.7 ui_evidence（plan 逐字）
  `CREATE TABLE IF NOT EXISTS ui_evidence (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    request_id TEXT,
    field_id TEXT,
    field_path TEXT NOT NULL,
    evidence_type TEXT,
    selector TEXT,
    visible INTEGER,
    in_viewport INTEGER,
    route TEXT,
    screenshot_path TEXT
  )`,
  // §25.8 coverage_fields（plan 逐字）
  `CREATE TABLE IF NOT EXISTS coverage_fields (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    endpoint_id TEXT,
    field_path TEXT NOT NULL,
    policy_status TEXT NOT NULL,
    coverage_state TEXT NOT NULL,
    access_hit INTEGER,
    ui_hit INTEGER,
    assertion_hit INTEGER,
    suspicious INTEGER,
    counted_required INTEGER,
    counted_effective INTEGER
  )`,
  // §25.9 agent_iterations（plan 逐字）
  `CREATE TABLE IF NOT EXISTS agent_iterations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    before_coverage REAL,
    after_coverage REAL,
    diff_path TEXT,
    started_at TEXT,
    ended_at TEXT
  )`,
]
