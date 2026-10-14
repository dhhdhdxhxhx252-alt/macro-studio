export type Child = Node | string | number | null | undefined | false
export type Children = Child | Child[]

type Attrs = Record<string, unknown>

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Children = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  const form = node as HTMLInputElement
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'value') form.value = String(value)
    else if (key === 'checked') form.checked = value === true
    else if (key === 'disabled') form.disabled = value === true
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener)
    else node.setAttribute(key, String(value))
  }
  append(node, children)
  return node
}

export function append(node: Node, children: Children): void {
  if (Array.isArray(children)) {
    for (const child of children) append(node, child)
    return
  }
  if (children === null || children === undefined || children === false || children === '') return
  node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)))
}

export function clear(node: HTMLElement): void {
  node.replaceChildren()
}

export interface FocusSnapshot {
  id: string
  start: number | null
}

// Полная перерисовка удобна, но теряла бы фокус при наборе текста: снимает и возвращает его.
export function captureFocus(): FocusSnapshot | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.id) return null
  const input = active as HTMLInputElement
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : null
  return { id: active.id, start }
}

export function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (!snapshot) return
  const node = document.getElementById(snapshot.id)
  if (!node) return
  node.focus()
  if (snapshot.start !== null && node instanceof HTMLInputElement && node.type !== 'checkbox' && node.type !== 'radio') {
    const position = Math.min(snapshot.start, node.value.length)
    node.setSelectionRange(position, position)
  }
}
