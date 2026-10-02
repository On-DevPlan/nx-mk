/**
 * 内置风格模板 semantic-css（spec 2026-10-02 §2.3）—— 复用宿主语义 class；白名单缺省 → G5 宿主扫描。
 */
export const semanticCssTemplate = `---
id: semantic-css
---
The host project uses hand-written semantic CSS classes defined in its own stylesheets. Reuse the existing class vocabulary; the review guard rejects classNames that do not exist in the host project.

## Hard rules
- Reuse classes that already exist in the host stylesheets; never invent new class names.
- Never add utility-framework classes (e.g. Tailwind) unless they are already used in the host project.
- Never use inline style attributes.
`
