import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomePage } from './HomePage.js'
import { PatientDetail } from './PatientDetail.js'
import { VisitHistory } from './VisitHistory.js'
import { NewPatientForm } from './NewPatientForm.js'

/**
 * S2：场景 DSL 无 click/fill，页面必须自驱动 —— 单页聚合渲染全部视图，
 * 进入即自动请求并渲染所有数据。S4：整页导航重置 collector 缓冲，故场景只能 goto 一次，
 * 不能靠多路由分别 goto —— 全部数据必须在同一页内呈现。
 * Task 2 补 PatientDetail/VisitHistory，Task 3 补 NewPatientForm。
 */
function App() {
  return (
    <div data-page="medical-records">
      <HomePage />
      <PatientDetail />
      <VisitHistory />
      <NewPatientForm />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)