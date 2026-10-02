/**
 * style 子模块公开出口（spec 2026-10-02 §2）—— index.ts 只从这里 re-export，避免深层路径扩散。
 */
export { parseStyleMarkdown, StyleTemplateError } from './loader.js'
export type { StyleTemplate, StyleConfigInput } from './types.js'
