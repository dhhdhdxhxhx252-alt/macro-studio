import catalogJson from '../../catalogs/nte-automation.json'
import { validateCatalog } from '../core/catalog.js'
import { validateConfig } from '../core/config.js'
import type { Catalog, Issue, WorkspaceConfig } from '../core/types.js'
import { captureFocus, clear, el, restoreFocus } from './dom.js'
import { clearDraft, readDraft, saveDraft, starterConfig, withConfig } from './state.js'
import type { State } from './state.js'
import { editor, estimatePanel, groupList, issuesPanel, macroList, previewPanel, topbar } from './views.js'
import type { Actions, Ctx } from './views.js'

const catalog = catalogJson as unknown as Catalog

const container = document.querySelector<HTMLElement>('#app')
if (!container) throw new Error('На странице нет контейнера #app')
const root: HTMLElement = container

let state: State = withConfig(draftOrDefault())
let toastTimer = 0
let saveTimer = 0

const actions: Actions = { importFile, exportConfig, normalize, clearDraft: clearDraftAction, copyJson }

function draftOrDefault(): WorkspaceConfig {
  const draft = readDraft()
  if (draft) {
    const result = validateConfig(draft, catalog)
    if (result.config) return result.config
  }
  return starterConfig(catalog)
}

function liveIssues(): Issue[] {
  return validateConfig(state.config, catalog).issues
}

function toast(message: string, bad = false): void {
  const node = document.querySelector<HTMLElement>('#toast')
  if (!node) return
  node.textContent = message
  node.classList.toggle('bad', bad)
  node.classList.add('show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 2800)
}

function autosave(): void {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => saveDraft(state.config), 400)
}

function render(): void {
  const focus = captureFocus()
  const ctx: Ctx = { catalog, state, issues: liveIssues(), actions, refresh }
  clear(root)
  root.append(
    topbar(ctx),
    el('main', { class: 'layout' }, [
      el('aside', { class: 'col left' }, [macroList(ctx), groupList(ctx)]),
      el('section', { class: 'col center' }, editor(ctx)),
      el('aside', { class: 'col right' }, [issuesPanel(ctx), estimatePanel(ctx), previewPanel(ctx)]),
    ]),
    el('div', { id: 'toast', class: 'toast' })
  )
  restoreFocus(focus)
}

function refresh(): void {
  render()
  autosave()
}

function normalize(): void {
  const result = validateConfig(state.config, catalog)
  if (!result.config) {
    toast('Каталог некорректен — нормализация невозможна', true)
    return
  }
  state = withConfig(result.config)
  refresh()
  const errors = result.issues.filter((issue) => issue.level === 'error').length
  toast(errors ? `Нормализовано, но осталось ${errors} ошибок` : 'Конфиг нормализован, ошибок нет')
}

function filename(): string {
  const safe = (state.config.name || 'macro-config').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim()
  return `${safe.slice(0, 60) || 'macro-config'}.json`
}

function exportConfig(): void {
  const blob = new Blob([`${JSON.stringify(state.config, null, 2)}\n`], { type: 'application/json' })
  const link = el('a', { href: URL.createObjectURL(blob), download: filename() })
  document.body.append(link)
  link.click()
  link.remove()
  const url = link.href
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast(`Сохранено: ${filename()}`)
}

async function copyJson(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.config, null, 2))
    toast('JSON скопирован в буфер обмена')
  } catch {
    toast('Браузер не дал доступ к буферу обмена', true)
  }
}

function clearDraftAction(): void {
  clearDraft()
  toast('Черновик удалён — после перезагрузки останется стартовый пример')
}

async function importFile(file: File): Promise<void> {
  if (file.size > 1024 * 1024) {
    toast('Файл больше 1 МБ — это не конфиг', true)
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ''))
  } catch {
    toast('Это не корректный JSON', true)
    return
  }
  const result = validateConfig(parsed, catalog)
  if (!result.config) {
    toast(result.issues[0]?.message ?? 'Файл не похож на конфигурацию', true)
    return
  }
  state = withConfig(result.config)
  refresh()
  const errors = result.issues.filter((issue) => issue.level === 'error').length
  toast(errors ? `Загружено с ${errors} ошибками — список справа` : 'Конфиг загружен и проверен')
}

window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) void importFile(file)
})

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    exportConfig()
  }
})

const brokenCatalog = validateCatalog(catalog)
if (brokenCatalog.length) toast(`Каталог сломан: ${brokenCatalog[0].message}`, true)

render()
