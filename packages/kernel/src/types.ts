/**
 * @mk/kernel type definitions
 *
 * All public types of the microkernel. Keep this file declarative — no runtime code.
 */

// ──────────────────────────────────────────────────────────────────────────
// Runtime modes
// ──────────────────────────────────────────────────────────────────────────

/**
 * The mode in which mk (and the SDK Facade) operates.
 *
 * - production:   user-facing production build (SDK is thin shell)
 * - development:  local dev server (SDK is thin shell)
 * - analysis:     mk session (`npx mk`) — full tracking enabled
 * - test:         test runs — minimal instrumentation
 * - ci:           reserved for future CI mode (not in MVP)
 */
export type RuntimeMode = 'production' | 'development' | 'analysis' | 'test' | 'ci'

// ──────────────────────────────────────────────────────────────────────────
// Resolved config (forward decl; concrete schema lives in @mk/config)
// ──────────────────────────────────────────────────────────────────────────

/**
 * The fully resolved configuration after merging user config + plugin defaults + env vars.
 * Plugins must treat this as immutable.
 */
export interface ResolvedConfig {
  readonly version: number
  readonly project: Readonly<{
    name: string
    framework: 'react' | 'vue' | 'svelte'
    bundler: 'vite' | 'webpack' | 'next'
  }>
  readonly openapi: Readonly<{
    input: string
    watch: boolean
  }>
  readonly app: Readonly<{
    command: string
    url: string
    analysisEnv: Readonly<Record<string, string>>
  }>
  readonly runtime: Readonly<{
    mode: RuntimeMode
    instrumentation: Readonly<{
      proxy: boolean
      uiEvidence: boolean
      collectStack: 'off' | 'sampled' | 'full'
      stackSampleRate: number
    }>
  }>
  readonly coveragePolicy: Readonly<{
    required: readonly { pattern: string; reason?: string }[]
    optional: readonly { pattern: string; reason?: string }[]
    ignored: readonly { pattern: string; reason?: string }[]
  }>
  readonly privacy: Readonly<{
    responseValues: Readonly<{ mode: 'masked' | 'raw' | 'none' }>
    mask: readonly { pattern: string; strategy: 'email' | 'phone' | 'token' | 'full' | 'partial' }[]
  }>
  readonly scenarios: Readonly<{
    include: readonly string[]
    concurrency: number
  }>
  readonly dashboard: Readonly<{
    port: number
    open: boolean
    defaultView: 'latest' | 'history'
  }>
  readonly runtimeRetainRuns: number
}

// ──────────────────────────────────────────────────────────────────────────
// Logger / Storage (minimal interfaces)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Structured logger. Implementation may route to console, file, or remote sink.
 * Plugins should always go through `ctx.logger` — never `console.*` directly.
 */
export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  child(bindings: Record<string, unknown>): Logger
}

/**
 * Storage facade for run-scoped data. Backed by SQLite in MVP, but interface
 * allows alternative implementations (in-memory, remote).
 */
export interface StorageProvider {
  /** Insert a row into the given table. Schema-validated by the provider. */
  insert(table: string, data: Record<string, unknown>): Promise<void>
  /** Insert many rows in a single transaction. */
  insertMany(table: string, rows: readonly Record<string, unknown>[]): Promise<void>
  /** Query rows by an optional `where` clause (exact match). */
  query<T = Record<string, unknown>>(
    table: string,
    where?: Record<string, unknown>,
  ): Promise<readonly T[]>
  /** Flush any buffered writes. Returns when durable. */
  flush(): Promise<void>
  /** Close the storage. Subsequent calls throw. */
  close(): Promise<void>
}

// ──────────────────────────────────────────────────────────────────────────
// Hooks — typed lifecycle events plugins can subscribe to
// ──────────────────────────────────────────────────────────────────────────

/**
 * AsyncSeriesHook: plugins register handlers, kernel calls them sequentially.
 * Each handler runs after the previous completes (errors propagate).
 *
 * Mirrors the shape of webpack's `tapable` but is a minimal in-house implementation
 * to avoid the dependency.
 */
export interface AsyncSeriesHook<TArgs extends readonly unknown[]> {
  /** Register a handler. `name` is shown in logs and error messages. */
  tap(name: string, fn: (...args: TArgs) => Promise<void> | void): void
  /** Invoke all handlers sequentially. */
  call(...args: TArgs): Promise<void>
  /** Number of registered handlers. */
  readonly size: number
}

// ──────────────────────────────────────────────────────────────────────────
// Event Bus — fire-and-forget events for SSE consumers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Event emitted to subscribers (typically the dashboard SSE channel).
 */
export type DashboardEventType =
  | 'stage:start'
  | 'stage:progress'
  | 'stage:done'
  | 'stage:error'
  | 'request:captured'
  | 'field:hit'
  | 'coverage:metrics'
  | 'ui-evidence:captured'
  | 'run:done'
  | 'run:failed'

export interface DashboardEvent<TPayload = unknown> {
  readonly type: DashboardEventType
  readonly runId: string
  readonly timestamp: string
  readonly payload: TPayload
}

/** A subscriber receives every event whose type matches its filter. */
export type EventSubscriber = (event: DashboardEvent) => void | Promise<void>

/** Unsubscribe function returned by `EventBus.on()`. */
export type Unsubscribe = () => void

// ──────────────────────────────────────────────────────────────────────────
// API Manifest (forward decl; concrete types live in @mk/manifest)
// ──────────────────────────────────────────────────────────────────────────

export interface ApiField {
  readonly id: string
  readonly endpointId: string
  readonly direction: 'request' | 'response'
  readonly status?: string
  readonly path: string
  readonly normalizedPath: string
  readonly name: string
  readonly type: string
  readonly required?: boolean
  readonly nullable?: boolean
  readonly description?: string
  readonly example?: unknown
  readonly enum?: readonly string[]
  readonly schemaName?: string
  readonly source: { readonly openapiPointer: string }
}

export interface ApiEndpoint {
  readonly id: string
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  readonly path: string
  readonly operationId?: string
  readonly summary?: string
  readonly tags?: readonly string[]
}

export interface ApiSchema {
  readonly name: string
  readonly fields: readonly ApiField[]
}

export interface ApiManifest {
  readonly version: string
  readonly source: { readonly type: 'openapi'; readonly input: string; readonly hash: string }
  readonly generatedAt: string
  readonly endpoints: readonly ApiEndpoint[]
  readonly schemas: Readonly<Record<string, ApiSchema>>
  readonly fields: readonly ApiField[]
}

// ──────────────────────────────────────────────────────────────────────────
// Domain events (also serve as hook payloads)
// ──────────────────────────────────────────────────────────────────────────

export interface BootstrapContext {
  readonly cwd: string
  readonly detectedProjectType?: string
}

export interface GeneratedSdk {
  readonly outputDir: string
  readonly endpoints: number
}

export interface DashboardInfo {
  readonly url: string
  readonly port: number
}

export interface AppInfo {
  readonly url: string
  readonly pid?: number
}

export interface ScenarioContext {
  readonly scenarioId: string
  readonly name?: string
  readonly route?: string
}

export interface RequestTrace {
  readonly requestId: string
  readonly traceId: string
  readonly scenarioId?: string
  readonly dslStepId?: string
  readonly endpointId?: string
  readonly method: string
  readonly url: string
  readonly status: number
  readonly durationMs: number
  readonly startedAt: string
  readonly endedAt: string
}

export interface FieldHitEvent {
  readonly requestId: string
  readonly endpointId?: string
  readonly fieldPath: string
  readonly normalizedPath: string
  readonly timestamp: string
  readonly route?: string
}

export interface UiEvidence {
  readonly requestId?: string
  readonly fieldPath: string
  readonly evidenceType: 'text' | 'attribute' | 'image-src' | 'link-href' | 'aria-label' | 'form-value' | 'component-prop'
  readonly selector?: string
  readonly visible: boolean
  readonly inViewport: boolean
  readonly route?: string
}

export interface CoverageReport {
  readonly runId: string
  readonly generatedAt: string
  readonly metrics: Readonly<{
    requiredCoverage: number
    effectiveCoverage: number
    rawBackendCoverage: number
    endpointsTotal: number
    endpointsCalled: number
    fieldsTotal: number
    fieldsReturned: number
    requiredFields: number
    missingRequiredFields: number
    ignoredReturnedFields: number
    suspiciousFields: number
  }>
}

export interface RunResult {
  readonly runId: string
  readonly startedAt: string
  readonly endedAt: string
  readonly status: 'success' | 'failed'
  readonly coverageReport?: CoverageReport
}

export interface RunError {
  readonly runId: string
  readonly stage: string
  readonly message: string
  readonly cause?: unknown
}

// ──────────────────────────────────────────────────────────────────────────
// Hook registry — typed view of all hooks the kernel exposes
// ──────────────────────────────────────────────────────────────────────────

export interface KernelHooks {
  readonly onBootstrap: AsyncSeriesHook<[BootstrapContext]>
  readonly onConfigResolved: AsyncSeriesHook<[ResolvedConfig]>
  readonly onManifestGenerated: AsyncSeriesHook<[ApiManifest]>
  readonly onSdkGenerated: AsyncSeriesHook<[GeneratedSdk]>
  readonly onDashboardStarted: AsyncSeriesHook<[DashboardInfo]>
  readonly onAppStarted: AsyncSeriesHook<[AppInfo]>
  readonly onScenarioStarted: AsyncSeriesHook<[ScenarioContext]>
  readonly onRequestCaptured: AsyncSeriesHook<[RequestTrace]>
  readonly onFieldHit: AsyncSeriesHook<[FieldHitEvent]>
  readonly onUiEvidenceCaptured: AsyncSeriesHook<[UiEvidence]>
  readonly onCoverageAnalyzed: AsyncSeriesHook<[CoverageReport]>
  readonly onRunCompleted: AsyncSeriesHook<[RunResult]>
  readonly onRunFailed: AsyncSeriesHook<[RunError]>
}

// ──────────────────────────────────────────────────────────────────────────
// Plugin contract
// ──────────────────────────────────────────────────────────────────────────

/**
 * The plugin contract. Plugins are loaded, configured, and torn down by the kernel.
 *
 * Lifecycle:
 *   1. `registerPlugin(plugin)` — kernel validates plugin metadata
 *   2. `kernel.bootstrap()` — kernel calls `setup(ctx)` in registration order
 *   3. (run pipeline executes)
 *   4. `kernel.teardown()` — kernel calls `teardown()` in reverse order
 *
 * Plugins should:
 *   - Subscribe to hooks in `setup()`, unsubscribe in `teardown()`
 *   - Be idempotent (multiple calls to setup should be safe)
 *   - Never block on I/O in `setup()` unless absolutely necessary
 *   - Use `ctx.logger`, `ctx.storage`, `ctx.bus` — never raw `console` / direct I/O
 */
export interface KernelPlugin<TPluginConfig = unknown> {
  readonly name: string
  readonly version: string
  readonly description?: string

  /** Restrict plugin to specific modes; if omitted, runs in all modes. */
  readonly modes?: readonly RuntimeMode[]

  /**
   * Optional Zod schema for plugin config. Kept as `unknown` here to avoid
   * forcing zod as a kernel dependency — actual validation happens in @mk/config.
   */
  readonly configSchema?: unknown
  readonly defaultConfig?: TPluginConfig

  /** Called once when the kernel bootstraps. Plugins register handlers here. */
  setup(ctx: KernelContext<TPluginConfig>): Promise<void> | void

  /** Called once when the kernel tears down. Plugins should clean up here. */
  teardown?(): Promise<void> | void
}

/**
 * Per-plugin context. Plugins should treat this as immutable.
 */
export interface KernelContext<TPluginConfig = unknown> {
  readonly mode: RuntimeMode
  readonly config: ResolvedConfig
  readonly pluginConfig: TPluginConfig
  readonly runId: string
  readonly hooks: KernelHooks
  readonly bus: EventBus
  readonly storage: StorageProvider
  readonly logger: Logger
}

// ──────────────────────────────────────────────────────────────────────────
// Run State — observable pipeline progress (CLI + dashboard)
// ──────────────────────────────────────────────────────────────────────────

export type RunStageId =
  | 'bootstrap'
  | 'config'
  | 'plugins'
  | 'manifest'
  | 'sdk'
  | 'dashboard'
  | 'app'
  | 'browser'
  | 'scenario'
  | 'capture'
  | 'analyze'
  | 'report'
  | 'agent'
  | 'done'
  | 'failed'

export type RunStageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface RunStage {
  readonly id: RunStageId
  readonly name: string
  readonly status: RunStageStatus
  readonly progress?: { readonly current: number; readonly total: number }
  readonly summary?: string
  readonly error?: string
  readonly startedAt?: string
  readonly endedAt?: string
}

export interface RunState {
  readonly runId: string
  readonly startedAt: string
  readonly endedAt?: string
  readonly dashboardUrl?: string
  readonly stages: readonly RunStage[]
  readonly metrics: Readonly<Record<string, number | undefined>>
  readonly artifacts: Readonly<Record<string, string | undefined>>
  readonly status: RunStageStatus
}