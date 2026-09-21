/**
 * App —— hash 路由分发 + 顶部导航（spec §3.4）。
 * 页面组件只做「usePolling 拉数 → 渲染」，逻辑全部在已测的 router/poller/api。
 * 页面统一挂 key={JSON.stringify(params)}：usePolling 换 path 不清旧数据，
 * 换 run/request 导航时靠 remount 重置轮询状态（Task 7 审查备注）。
 */
import { useHashRoute } from './router'
import { OverviewPage } from './pages/Overview'
import { RunsListPage } from './pages/RunsList'
import { RunOverviewPage } from './pages/RunOverview'
import { RequestsListPage } from './pages/RequestsList'
import { RequestDetailPage } from './pages/RequestDetail'
import { FieldsListPage } from './pages/FieldsList'
import { IgnoredListPage } from './pages/IgnoredList'
import { ManifestBrowserPage } from './pages/ManifestBrowser'
import { PluginSettingsPage } from './pages/PluginSettings'
import { ScenariosPage } from './pages/Scenarios'

export function App() {
  const { page, params } = useHashRoute()
  return (
    <>
      <nav>
        <a href="#/">Overview</a>
        <a href="#/runs">Runs</a>
        <a href="#/scenarios">Scenarios</a>
        <a href="#/settings/plugins">Plugins</a>
      </nav>
      <main>
        {page === 'overview' && <OverviewPage key={JSON.stringify(params)} />}
        {page === 'runs' && <RunsListPage key={JSON.stringify(params)} />}
        {page === 'run' && <RunOverviewPage runId={params.runId ?? ''} key={JSON.stringify(params)} />}
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
        {page === 'not-found' && <p className="empty">Not found — pick a page above.</p>}
      </main>
    </>
  )
}
