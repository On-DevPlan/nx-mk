/**
 * /plugins（插件 tab 首页，3-tab 重构）—— 插件中心：
 * ① 生命周期五组（kernel Phase 全集 × before/after 钩点位）说明 + 已装插件归属标注
 * ② 已装插件卡片（复用 plugins-manifest 数据：name/version/enabled/config/configSchema）
 * ③ 安装区占位：npm 安装指令 / zip 上传 —— 本轮 disabled 展示（真实安装 = backlog C17）。
 * 数据全部复用既有路由 GET /api/plugins 与 /api/runs/:runId/pipeline（插件事件 I/O）；
 * 提示词模板 = 给插件作者的合约/钩子/D1 要求说明（纯文本生成，无新依赖）。
 */
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { PluginsResponse, PipelineReportResponse, RunsListResponse } from '../../shared/api-types'

/** kernel 生命周期五相（与 kernel/src/types.ts Phase 全集一致；运行时不新增） */
const LIFECYCLE_PHASES = ['loadConfig', 'resolvePlugins', 'initPlugins', 'run', 'shutdown'] as const

/** 每相的钩点位（§ kernel plugin.ts：before{Phase}/after{Phase}；phase 自身不暴露） */
function hookNames(phase: string): string[] {
  const cap = phase.charAt(0).toUpperCase() + phase.slice(1)
  return [`before${cap}`, `after${cap}`]
}

/** 插件作者提示词模板（安装区旁展示：合约、钩点、D1 ironlaw） */
export function pluginAuthorPrompt(version: string): string {
  return [
    `You are writing an nx-mk plugin (kernel v${version}).`,
    'Contract:', 'export default function createPlugin(ctx) { return { name, version, hooks } }',
    'Hooks (all optional): before{Phase}/after{Phase} where Phase ∈ loadConfig|resolvePlugins|initPlugins|run|shutdown.',
    'Handler signature: (ctx: PluginContext) => Promise<void> | void.',
    'Optional: configSchema (standard-schema with jsonSchema); inject/provide for DI.',
    'Ironlaw: plugins never write the workspace directly — emit reports/signals via ctx; diffs land in .nx-mk/patches/.',
    'Lifecycle states observed by the kernel: active / done (emitSignal done) / failed.',
  ].join('\n')
}

export function PluginCenterPage() {
  const T = useT()
  const { data, error } = usePolling<PluginsResponse>('/api/plugins')
  const runs = usePolling<RunsListResponse>('/api/runs')
  const latest = runs.data?.runs.find((r) => r.hasReport) ?? null
  const pipeline = usePolling<PipelineReportResponse>(latest ? `/api/runs/${encodeURIComponent(latest.runId)}/pipeline` : null)

  if (error !== null) {
    return <section><h1>{T('Plugins')}</h1><p className="error">{T('Plugins endpoint not found.')}</p></section>
  }
  if (!data) return <section><h1>{T('Plugins')}</h1><p className="loading">{T('loading…')}</p></section>
  if (data.stale) {
    return <section><h1>{T('Plugins')}</h1><p className="empty">{T('kernel has not produced plugins-manifest.json yet — run once first.')}</p></section>
  }

  const pluginInPipeline = new Map((pipeline.data?.plugins ?? []).map((p) => [p.name, p]))
  const version = data.plugins[0]?.version ?? '0'

  return (
    <section>
      <h1>{T('Plugins')}</h1>

      <div className="section">
        <h2>{T('Install')}</h2>
        <p className="muted">{T('Install center is read-only in this release — zip upload and npm install land with a dedicated security ruling (C17).')}</p>
        <pre className="muted">{pluginAuthorPrompt(version)}</pre>
        <p>
          <button disabled>{T('upload zip')}</button>{' '}
          <button disabled>{T('install via npm')}</button>
        </p>
      </div>

      <div className="section">
        <h2>{T('Lifecycle')}</h2>
        <table>
          <thead><tr><th>{T('phase')}</th><th>{T('hooks')}</th><th>{T('installed')}</th></tr></thead>
          <tbody>
            {LIFECYCLE_PHASES.map((phase) => (
              <tr key={phase}>
                <td>{phase}</td>
                <td>{hookNames(phase).join(' · ')}</td>
                <td>{data.plugins.length > 0 ? data.plugins.map((p) => p.name).join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section">
        <h2>{T('Installed')}</h2>
        <table>
          <thead><tr><th>{T('Plugins')}</th><th>{T('value state')}</th></tr></thead>
          <tbody>
            {data.plugins.map((p) => (
              <tr key={p.name}>
                <td>{p.name} <span className="badge">v{p.version}</span>{p.enabled ? <span className="badge">enabled</span> : null}</td>
                <td>{pluginInPipeline.get(p.name)?.state ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><a href="#/settings/plugins">{T('Edit config')} →</a></p>
      </div>
    </section>
  )
}
