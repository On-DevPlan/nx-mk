/**
 * App —— hash 路由分发 + 顶部导航（spec §3.4）。
 * 页面组件只做「usePolling 拉数 → 渲染」，逻辑全部在已测的 router/poller/api。
 * 页面统一挂 key={JSON.stringify(params)}：usePolling 换 path 不清旧数据，
 * 换 run/request 导航时靠 remount 重置轮询状态（Task 7 审查备注）。
 * i18n：导航与各页面文案经 useT()（zh/en，右上角开关持久化 localStorage）。
 */
import { useHashRoute } from './router'
import { useT, useLang } from './i18n'
import { OverviewPage } from './pages/Overview'
import { RunsListPage } from './pages/RunsList'
import { RunOverviewPage } from './pages/RunOverview'
import { PipelinePage } from './pages/Pipeline'
import { RequestsListPage } from './pages/RequestsList'
import { RequestDetailPage } from './pages/RequestDetail'
import { FieldsListPage } from './pages/FieldsList'
import { IgnoredListPage } from './pages/IgnoredList'
import { ManifestBrowserPage } from './pages/ManifestBrowser'
import { PluginSettingsPage } from './pages/PluginSettings'
import { ScenariosPage } from './pages/Scenarios'

/** 语言开关（右上角）：显示目标语言，点击切换并持久化 */
function LangToggle() {
  const [lang, setLangState] = useLang()
  return (
    <button
      className="lang-toggle"
      title={lang === 'en' ? 'Switch to Chinese' : '切换到英文'}
      onClick={() => setLangState(lang === 'en' ? 'zh' : 'en')}
    >
      {lang === 'en' ? '中文' : 'English'}
    </button>
  )
}

/**
 * 路由 → 导航项映射：run/requests/fields 等详情页都归属 Runs 组高亮。
 * 只注入 aria-current 与 class，不改任何文案（页面测试按文本锚定）。
 */
const NAV_GROUP: Record<string, string> = {
  overview: 'overview',
  runs: 'runs',
  run: 'runs',
  pipeline: 'runs',
  requests: 'runs',
  request: 'runs',
  fields: 'runs',
  ignored: 'runs',
  manifest: 'runs',
  scenarios: 'scenarios',
  settings: 'settings',
}

export function App() {
  const { page, params } = useHashRoute()
  const T = useT()
  const group = NAV_GROUP[page] ?? ''
  /** 当前页高亮：命中路由组时注入 aria-current（CSS 用 [aria-current=page] 着色） */
  const nav = (id: string) => (group === id ? { 'aria-current': 'page' as const } : {})
  return (
    <>
      <nav>
        <a className="brand" href="#/">nx-mk</a>
        <a href="#/" {...nav('overview')}>{T('Overview')}</a>
        <a href="#/runs" {...nav('runs')}>{T('Runs')}</a>
        <a href="#/scenarios" {...nav('scenarios')}>{T('Scenarios')}</a>
        <a href="#/settings/plugins" {...nav('settings')}>{T('Plugins')}</a>
        <LangToggle />
      </nav>
      <main>
        {page === 'overview' && <OverviewPage key={JSON.stringify(params)} />}
        {page === 'runs' && <RunsListPage key={JSON.stringify(params)} />}
        {page === 'run' && <RunOverviewPage runId={params.runId ?? ''} key={JSON.stringify(params)} />}
        {page === 'pipeline' && <PipelinePage runId={params.runId ?? ''} key={JSON.stringify(params)} />}
        {page === 'requests' && (
          <RequestsListPage runId={params.runId ?? ''} key={JSON.stringify(params)} />
        )}
        {page === 'request' && (
          <RequestDetailPage
            runId={params.runId ?? ''}
            requestId={params.requestId ?? ''}
            key={JSON.stringify(params)}
          />
        )}
        {page === 'fields' && <FieldsListPage runId={params.runId ?? ''} key={JSON.stringify(params)} />}
        {page === 'ignored' && (
          <IgnoredListPage runId={params.runId ?? ''} key={JSON.stringify(params)} />
        )}
        {page === 'manifest' && (
          <ManifestBrowserPage runId={params.runId ?? ''} key={JSON.stringify(params)} />
        )}
        {page === 'settings' && <PluginSettingsPage key="settings" />}
        {page === 'scenarios' && <ScenariosPage key="scenarios" />}
        {page === 'not-found' && <p className="empty">{T('Not found — pick a page above.')}</p>}
      </main>
    </>
  )
}
