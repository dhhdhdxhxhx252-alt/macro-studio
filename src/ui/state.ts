import { emptyConfig, makeMacro, normalizeAutomation, newMacroId } from '../core/config.js'
import type { Catalog, KindDef, Macro, MacroGroup, WorkspaceConfig } from '../core/types.js'

export const STORAGE_KEY = 'macro-studio:draft:v1'

export type Tab = 'parameters' | 'execution' | 'safety'
export type Selection = { scope: 'macro' | 'group' | 'config'; id: string }

export interface State {
  config: WorkspaceConfig
  selection: Selection
  tab: Tab
}

const GROUP_COLORS = ['#a578ff', '#5ec8ff', '#7ee0a1', '#ffb86b', '#ff7ea8']

export function findKind(catalog: Catalog, id: string): KindDef | undefined {
  return catalog.kinds.find((kind) => kind.id === id)
}

export function macroOf(state: State): Macro | undefined {
  return state.config.macros.find((macro) => macro.id === state.selection.id)
}

export function groupOf(state: State): MacroGroup | undefined {
  return state.config.groups.find((group) => group.id === state.selection.id)
}

export function select(state: State, scope: Selection['scope'], id = ''): void {
  state.selection = { scope, id }
}

function restoreSelection(config: WorkspaceConfig): Selection {
  if (config.macros.length) return { scope: 'macro', id: config.macros[0].id }
  if (config.groups.length) return { scope: 'group', id: config.groups[0].id }
  return { scope: 'config', id: '' }
}

export function withConfig(config: WorkspaceConfig): State {
  return { config, selection: restoreSelection(config), tab: 'parameters' }
}

// Первый запуск должен показывать рабочий пример, а не пустой экран.
export function starterConfig(catalog: Catalog): WorkspaceConfig {
  const config = emptyConfig('Первый проект')
  const taken = new Set<string>()
  const kinds = catalog.kinds.slice(0, 3)
  kinds.forEach((kind, index) => {
    const macro = makeMacro(kind, taken, index)
    macro.cycles = index === 0 ? 0 : 20
    config.macros.push(macro)
  })
  if (config.macros.length) {
    config.groups.push({
      id: 'evening',
      name: 'Вечерний набор',
      description: 'Макросы, которые запускаются вместе',
      color: GROUP_COLORS[0],
      macroIds: config.macros.map((macro) => macro.id),
    })
  }
  config.description = 'Черновик создан в macro-studio'
  return config
}

export function addMacro(state: State, kind: KindDef): Macro {
  const taken = new Set(state.config.macros.map((macro) => macro.id))
  const macro = makeMacro(kind, taken, state.config.macros.length)
  state.config.macros.push(macro)
  select(state, 'macro', macro.id)
  return macro
}

export function duplicateMacro(state: State, macro: Macro): Macro | undefined {
  const taken = new Set(state.config.macros.map((item) => item.id))
  const clone: Macro = JSON.parse(JSON.stringify(macro))
  clone.id = newMacroId(macro.kind, taken)
  clone.name = `${macro.name} (копия)`.slice(0, 40)
  const index = state.config.macros.indexOf(macro)
  state.config.macros.splice(index + 1, 0, clone)
  for (const group of state.config.groups) {
    if (group.macroIds.includes(macro.id) && !group.macroIds.includes(clone.id)) group.macroIds.push(clone.id)
  }
  select(state, 'macro', clone.id)
  return clone
}

export function removeMacro(state: State, macro: Macro): void {
  const rest = state.config.macros.filter((item) => item !== macro)
  state.config.macros = rest
  for (const group of state.config.groups) group.macroIds = group.macroIds.filter((id) => id !== macro.id)
  if (state.selection.scope === 'macro') state.selection = restoreSelection(state.config)
}

export function moveMacro(state: State, macro: Macro, delta: number): void {
  const list = state.config.macros
  const from = list.indexOf(macro)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return
  list.splice(to, 0, list.splice(from, 1)[0])
}

export function addGroup(state: State): MacroGroup {
  const taken = new Set(state.config.groups.map((group) => group.id))
  const index = state.config.groups.length + 1
  let id = `group-${index}`
  let n = index + 1
  while (taken.has(id)) id = `group-${n++}`
  const group: MacroGroup = { id, name: `Группа ${index}`, description: '', color: GROUP_COLORS[index % GROUP_COLORS.length], macroIds: [] }
  state.config.groups.push(group)
  select(state, 'group', id)
  return group
}

export function removeGroup(state: State, group: MacroGroup): void {
  state.config.groups = state.config.groups.filter((item) => item !== group)
  if (state.selection.scope === 'group') state.selection = restoreSelection(state.config)
}

export function toggleMember(group: MacroGroup, macro: Macro): void {
  const index = group.macroIds.indexOf(macro.id)
  if (index >= 0) group.macroIds.splice(index, 1)
  else group.macroIds.push(macro.id)
}

// Смена категории: параметры пересобираются из каталога, ритм и защита остаются как были.
export function changeKind(macro: Macro, kind: KindDef): void {
  const { automation } = normalizeAutomation(kind, macro.automation)
  macro.kind = kind.id
  macro.automation = automation
  if (!macro.delay) macro.delay = kind.delay ?? 5
}

export function saveDraft(config: WorkspaceConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* приватный режим или переполнение — черновик просто не сохранится */
  }
}

export function readDraft(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* см. saveDraft */
  }
}
