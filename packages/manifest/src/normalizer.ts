// Plan §17: 数组下标 → []
// examples:
//   orders.0.items.2.skuName → orders[].items[].skuName
//   data.0.user.id            → data[].user.id
//   data.user.name            → data.user.name (unchanged)
//   data                      → data (unchanged)
//
// Rule: a numeric segment marks the PREVIOUS segment as an array. `[]` is
// appended as a postfix to that previous segment (spec §4.2: "[] 放在每个数字段后面").
// A leading numeric (top-level array) yields a standalone `[]` segment.

export function normalizePath(p: string): string {
  if (p === '') return ''
  const out: string[] = []
  for (const seg of p.split('.')) {
    if (/^\d+$/.test(seg)) {
      if (out.length > 0) {
        // Postfix: attach [] to the segment that precedes the numeric index.
        out[out.length - 1] += '[]'
      } else {
        // Top-level array: the numeric is the first segment, emit [].
        out.push('[]')
      }
    } else {
      out.push(seg)
    }
  }
  return out.join('.')
}
