/**
 * 内置风格模板 tailwind-lite（spec 2026-10-02 §2.3）—— utility-first。
 * TS 字符串承载 markdown 契约（§2.1 实现修订：tsup 不拷贝 .md 资产）；内容对模板作者即范例。
 */
export const tailwindLiteTemplate = `---
id: tailwind-lite
classNameWhitelist: ["flex","grid","block","hidden","px-*","py-*","p-*","m-*","mx-*","my-*","mt-*","mb-*","ml-*","mr-*","gap-*","w-*","h-*","min-h-*","max-w-*","text-*","bg-*","border","border-*","rounded","rounded-*","font-*","items-*","justify-*","space-*","list-*","truncate","uppercase","italic","sr-only"]
---
Utility-first Tailwind styling. Compose layout and visual styling with Tailwind utility classes only.

## Hard rules
- Use Tailwind utility classes for all styling; never create or modify CSS files.
- Never use inline style attributes.
- Never import third-party UI component libraries.
`
