/**
 * 内置风格模板 mui-style（spec 2026-10-02 §2.3）—— MUI 组件优先；白名单不适用 → 缺省（宿主扫描）。
 */
export const muiStyleTemplate = `---
id: mui-style
---
The host project is styled with Material UI (MUI) components. Prefer MUI components and the sx prop over raw HTML plus class strings.

## Hard rules
- Use MUI components (from @mui/material) for structure; do not introduce other UI libraries.
- Prefer the sx prop for one-off tweaks; never create CSS files.
- Never use className strings that are not already defined by the host project.
`
