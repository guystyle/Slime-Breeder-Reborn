type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper. Text is always inserted as text nodes, never HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export const span = (cls: string, text: string) => h('span', { class: cls }, text);
