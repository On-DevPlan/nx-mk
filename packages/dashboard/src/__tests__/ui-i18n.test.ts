/**
 * i18n 单测（zh/en 零依赖词典 + 模块级语言状态）：
 * translate 纯函数（回退/插值）+ useT 订阅渲染（renderToString）。
 * 注意：语言状态是模块级单例 —— 改语言的用例必须在 finally 复位 'en'，
 * 避免文件内后续用例吃到脏状态。
 */
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { translate, setLang, getLang, useT } from '../ui/i18n'

function renderPage(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('translate 纯函数', () => {
  it('en：词典缺省回退键本身（键 = 英文原文）', () => {
    expect(translate('en', 'Overview')).toBe('Overview')
    expect(translate('en', 'some unknown key')).toBe('some unknown key')
  })

  it('zh：命中词典返回中文；缺项回退英文键', () => {
    expect(translate('zh', 'Overview')).toBe('总览')
    expect(translate('zh', 'Response body')).toBe('响应值')
    expect(translate('zh', 'some unknown key')).toBe('some unknown key')
  })

  it('插值：{name} 占位替换；缺失占位保留原样', () => {
    expect(translate('zh', 'missing required: {n}', { n: 3 })).toBe('缺失必需: 3')
    expect(translate('en', 'Run not found: {id}', { id: 'run_a' })).toBe('Run not found: run_a')
    expect(translate('en', 'hello {who}')).toBe('hello {who}')
  })
})

describe('语言状态 + useT', () => {
  it('缺省 en（node 渲染环境无 localStorage）', () => {
    expect(getLang()).toBe('en')
  })

  it('setLang 切换后 useT 渲染中文；复位后回英文', () => {
    // .ts 测试文件无 JSX → createElement（repo 先例：scenarios-page.test.ts）
    function Nav() {
      const T = useT()
      return createElement('span', null, `${T('Runs')}-${T('loading…')}`)
    }
    try {
      setLang('zh')
      expect(renderPage(createElement(Nav))).toContain('运行-加载中…')
      setLang('en')
      expect(renderPage(createElement(Nav))).toContain('Runs-loading…')
    } finally {
      setLang('en')
    }
  })
})
