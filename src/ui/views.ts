import { el } from './dom.js'
import type { Child, Children } from './dom.js'
import { EXECUTION_BOUNDS, SAFETY_BOUNDS, isFieldVisible } from '../core/catalog.js'
import { emptyConfig } from '../core/config.js'
import { estimateGroup, estimateMacro, formatDuration } from '../core/estimate.js'
import { PRESETS, applyPreset } from '../core/presets.js'
import type { PresetId } from '../core/presets.js'
import type { Catalog, ConfigSettings, ExecutionSettings, FieldDef, Issue, KindDef, Macro, MacroGroup, ParameterValue, SafetySettings } from '../core/types.js'
import { addGroup, addMacro, changeKind, duplicateMacro, findKind, groupOf, macroOf, moveMacro, removeGroup, removeMacro, select, starterConfig, toggleMember } from './state.js'
import type { State, Tab } from './state.js'

export interface Actions {
  importFile(file: File): void
  exportConfig(): void
  normalize(): void
  clearDraft(): void
  copyJson(): void
}

export interface Ctx {
  catalog: Catalog
  state: State
  issues: Issue[]
  actions: Actions
  refresh: () => void
}

const EXEC_LABELS: Record<keyof ExecutionSettings, string> = {
  startDelay: 'Задержка старта',
  intervalMode: 'Тип интервала',
  variation: 'Разброс интервала',
  breakEvery: 'Перерыв каждые',
  breakSeconds: 'Длительность перерыва',
  maxMinutes: 'Лимит времени',
  notifications: 'Уведомления',
}

const SAFETY_LABELS: Record<keyof SafetySettings, string> = {
  confidence: 'Порог распознавания',
  cycleTimeout: 'Тайм-аут цикла',
  onError: 'При ошибке',
  retryLimit: 'Число повторов',
  retryDelay: 'Пауза перед повтором',
  pauseWhenHidden: 'Пауза в фоновом окне',
  logLevel: 'Подробность журнала',
}

const CHOICES: Record<string, { value: string; label: string }[]> = {
  intervalMode: [{ value: 'fixed', label: 'Постоянный' }, { value: 'variable', label: 'С вариацией' }],
  notifications: [{ value: 'silent', label: 'Тихо' }, { value: 'finish', label: 'По завершении' }, { value: 'all', label: 'Всегда' }],
  onError: [{ value: 'retry', label: 'Повторять' }, { value: 'skip', label: 'Пропускать' }, { value: 'stop', label: 'Останавливать' }],
  logLevel: [{ value: 'errors', label: 'Только ошибки' }, { value: 'normal', label: 'Обычный' }, { value: 'verbose', label: 'Подробный' }],
  shortcut: [{ value: 'F6', label: 'F6' }, { value: 'F8', label: 'F8' }, { value: 'F9', label: 'F9' }],
}

function exec<T extends object>(target: T, key: keyof T, value: unknown): void {
  ;(target as Record<string, unknown>)[key as string] = value
}

function issuesFor(issues: Issue[], prefix: string): Issue[] {
  return issues.filter((issue) => issue.path.startsWith(prefix))
}

function badge(count: number, kind: 'error' | 'warning'): Child {
  if (!count) return null
  return el('span', { class: `badge ${kind}`, text: String(count), title: kind === 'error' ? 'ошибки' : 'предупреждения' })
}

function row(label: string, control: HTMLElement, hint?: string, forId?: string): HTMLElement {
  return el('div', { class: 'row' }, [
    el('div', { class: 'row-head' }, [forId ? el('label', { for: forId, text: label }) : el('span', { text: label }), hint ? el('small', { class: 'hint', text: hint }) : null]),
    el('div', { class: 'row-body' }, control),
  ])
}

function textField(id: string, value: string, placeholder: string, maxlength: number, multiline: boolean, on: (value: string) => void): HTMLElement {
  if (multiline) return el('textarea', { id, class: 'input area', rows: 2, placeholder, maxlength, value, oninput: (event: Event) => on((event.target as HTMLTextAreaElement).value) })
  return el('input', { id, class: 'input', type: 'text', placeholder, maxlength, value, oninput: (event: Event) => on((event.target as HTMLInputElement).value) })
}

function numberField(id: string, value: number, min: number, max: number, step: number, on: (value: number) => void): HTMLElement {
  return el('input', {
    id,
    class: 'input num',
    type: 'number',
    min,
    max,
    step,
    value: String(value),
    oninput: (event: Event) => {
      const parsed = Number((event.target as HTMLInputElement).value)
      if (Number.isFinite(parsed)) on(parsed)
    },
  })
}

function rangeField(id: string, value: number, min: number, max: number, step: number, unit: string | undefined, on: (value: number) => void): HTMLElement {
  const out = el('output', { class: 'range-value', text: `${value}${unit ? ` ${unit}` : ''}` })
  const input = el('input', {
    id,
    class: 'range',
    type: 'range',
    min,
    max,
    step,
    value: String(value),
    oninput: (event: Event) => {
      const parsed = Number((event.target as HTMLInputElement).value)
      if (Number.isFinite(parsed)) {
        out.textContent = `${parsed}${unit ? ` ${unit}` : ''}`
        on(parsed)
      }
    },
  })
  return el('div', { class: 'range-wrap' }, [input, out])
}

function choiceField(id: string, value: string, options: { value: string; label: string }[], on: (value: string) => void): HTMLElement {
  return el(
    'select',
    { id, class: 'input select', onchange: (event: Event) => on((event.target as HTMLSelectElement).value) },
    options.map((option) => el('option', { value: option.value, selected: option.value === value, text: option.label }))
  )
}

function switchField(id: string, checked: boolean, on: (value: boolean) => void): HTMLElement {
  return el('button', {
    id,
    class: `switch${checked ? ' on' : ''}`,
    type: 'button',
    role: 'switch',
    'aria-checked': String(checked),
    text: checked ? 'Вкл' : 'Выкл',
    onclick: () => on(!checked),
  })
}

function segmentField(value: string, options: { value: string; label: string }[], on: (value: string) => void): HTMLElement {
  return el(
    'div',
    { class: 'segments', role: 'radiogroup' },
    options.map((option) =>
      el('button', {
        type: 'button',
        class: `segment${option.value === value ? ' active' : ''}`,
        role: 'radio',
        'aria-checked': String(option.value === value),
        text: option.label,
        onclick: () => on(option.value),
      })
    )
  )
}

function button(label: string, handler: () => void, variant = ''): HTMLElement {
  return el('button', { type: 'button', class: `btn ${variant}`.trim(), text: label, onclick: handler })
}

function iconButton(symbol: string, title: string, handler: () => void): HTMLElement {
  return el('button', { type: 'button', class: 'icon', title, 'aria-label': title, text: symbol, onclick: handler })
}

function panelTitle(text: string, actions: Children = null): HTMLElement {
  return el('div', { class: 'panel-title' }, [el('h2', { text }), el('div', { class: 'panel-actions' }, actions)])
}

export function macroList(ctx: Ctx): HTMLElement {
  const { state, catalog, issues, refresh } = ctx
  const kindSelect = el('select', { class: 'input select', id: 'new-kind' }, catalog.kinds.map((kind) => el('option', { value: kind.id, text: kind.label })))
  const nodes = state.config.macros.map((macro, index) => {
    const kind = findKind(catalog, macro.kind)
    const own = issuesFor(issues, `macros[${index}]`)
    const active = state.selection.scope === 'macro' && state.selection.id === macro.id
    return el('li', { class: `item${active ? ' active' : ''}${macro.enabled ? '' : ' muted'}` }, [
      el('button', {
        type: 'button',
        class: 'item-main',
        onclick: () => {
          select(state, 'macro', macro.id)
          refresh()
        },
      }, [
        el('span', { class: 'dot', style: `background:${kind ? '#a578ff' : '#706b7a'}` }),
        el('span', { class: 'item-text' }, [el('strong', { text: macro.name || 'Без названия' }), el('small', { text: `${kind?.label ?? macro.kind} · ${macro.delay} с` })]),
        badge(own.filter((issue) => issue.level === 'error').length, 'error'),
        badge(own.filter((issue) => issue.level === 'warning').length, 'warning'),
      ]),
      el('span', { class: 'item-tools' }, [
        iconButton('↑', 'Выше', () => {
          moveMacro(state, macro, -1)
          refresh()
        }),
        iconButton('↓', 'Ниже', () => {
          moveMacro(state, macro, 1)
          refresh()
        }),
        iconButton('⧉', 'Дублировать', () => {
          duplicateMacro(ctx.state, macro)
          refresh()
        }),
        iconButton('×', 'Удалить', () => {
          removeMacro(ctx.state, macro)
          refresh()
        }),
      ]),
    ])
  })

  return el('section', { class: 'panel' }, [
    panelTitle('Макросы', button('＋', () => {
      const kind = kindSelect.value
      addMacro(ctx.state, findKind(ctx.catalog, kind) ?? ctx.catalog.kinds[0])
      refresh()
    }, 'accent')),
    el('div', { class: 'add-row' }, [kindSelect]),
    el('ul', { class: 'list' }, nodes.length ? nodes : [el('li', { class: 'empty', text: 'Пока пусто — добавьте первый макрос.' })]),
  ])
}

export function groupList(ctx: Ctx): HTMLElement {
  const { state, issues, refresh } = ctx
  const nodes = state.config.groups.map((group, index) => {
    const active = state.selection.scope === 'group' && state.selection.id === group.id
    const own = issuesFor(issues, `groups[${index}]`)
    return el('li', { class: `item${active ? ' active' : ''}` }, [
      el('button', {
        type: 'button',
        class: 'item-main',
        onclick: () => {
          select(state, 'group', group.id)
          refresh()
        },
      }, [
        el('span', { class: 'dot', style: `background:${group.color}` }),
        el('span', { class: 'item-text' }, [el('strong', { text: group.name || 'Без названия' }), el('small', { text: `${group.macroIds.length} макр.` })]),
        badge(own.filter((issue) => issue.level === 'error').length, 'error'),
      ]),
    ])
  })
  return el('section', { class: 'panel' }, [
    panelTitle('Группы', button('＋', () => {
      addGroup(ctx.state)
      refresh()
    })),
    el('ul', { class: 'list' }, nodes.length ? nodes : [el('li', { class: 'empty', text: 'Групп нет.' })]),
    el('p', { class: 'note' }, [
      el('button', { type: 'button', class: 'link', text: 'Свойства конфигурации', onclick: () => { select(state, 'config'); refresh() } }),
    ]),
  ])
}

function runBlock(ctx: Ctx, macro: Macro): HTMLElement {
  const { refresh } = ctx
  return el('div', { class: 'grid-3' }, [
    row('Интервал, сек', numberField('f-delay', macro.delay, 1, 60, 1, (value) => {
      macro.delay = Math.round(value)
      refresh()
    }), '1..60', 'f-delay'),
    row('Циклов', numberField('f-cycles', macro.cycles, 0, 999999, 1, (value) => {
      macro.cycles = Math.round(value)
      refresh()
    }), '0 = без лимита', 'f-cycles'),
    row('Повторов', numberField('f-repeats', macro.repeats, 0, 9999, 1, (value) => {
      macro.repeats = Math.round(value)
      refresh()
    }), '0 = не повторять', 'f-repeats'),
  ])
}

function presetBlock(ctx: Ctx, macro: Macro): HTMLElement {
  return el('div', { class: 'presets' }, PRESETS.map((preset) =>
    el('button', {
      type: 'button',
      class: 'preset',
      title: preset.hint,
      text: preset.label,
      onclick: () => {
        const index = ctx.state.config.macros.indexOf(macro)
        ctx.state.config.macros[index] = applyPreset(macro, preset.id as PresetId)
        select(ctx.state, 'macro', ctx.state.config.macros[index].id)
        ctx.refresh()
      },
    })
  ))
}

function parameterForm(ctx: Ctx, macro: Macro, kind: KindDef): HTMLElement {
  const sections = new Map<string, FieldDef[]>()
  for (const field of kind.fields) {
    if (!isFieldVisible(field, macro.automation.parameters)) continue
    const name = field.section ?? 'Общие'
    const list = sections.get(name)
    if (list) list.push(field)
    else sections.set(name, [field])
  }
  return el('div', { class: 'sections' }, [...sections].map(([name, fields]) =>
    el('section', { class: 'section' }, [
      el('h3', { text: name }),
      ...fields.map((field) => parameterRow(ctx, macro, field)),
    ])
  ))
}

function write(ctx: Ctx, macro: Macro, key: string, value: ParameterValue): void {
  macro.automation.parameters[key] = value
  ctx.refresh()
}

function parameterRow(ctx: Ctx, macro: Macro, field: FieldDef): HTMLElement {
  const current = macro.automation.parameters[field.key]
  const id = `p-${field.key}`
  const hint = field.description

  if (field.type === 'toggle') return row(field.label, switchField(id, current === true, (value) => write(ctx, macro, field.key, value)), hint, id)

  if (field.type === 'range') {
    return row(
      field.label,
      rangeField(id, Number(current), field.min ?? 0, field.max ?? 100, field.step ?? 1, field.unit, (value) => write(ctx, macro, field.key, value)),
      hint,
      id
    )
  }
  if (field.type === 'number') {
    return row(
      `${field.label}${field.unit ? `, ${field.unit}` : ''}`,
      numberField(id, Number(current), field.min ?? 0, field.max ?? 9999, field.step ?? 1, (value) => write(ctx, macro, field.key, value)),
      hint,
      id
    )
  }
  if (field.type === 'text') return row(field.label, textField(id, String(current ?? ''), '', field.max ?? 60, false, (value) => write(ctx, macro, field.key, value)), hint, id)

  if (field.type === 'segments') return row(field.label, segmentField(String(current), field.options ?? [], (value) => write(ctx, macro, field.key, value)), hint)

  if (field.type === 'multi') {
    const picked = Array.isArray(current) ? current : []
    const boxes = (field.options ?? []).map((option) =>
      el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox',
          checked: picked.includes(option.value),
          onchange: (event: Event) => {
            const checked = (event.target as HTMLInputElement).checked
            const next = checked ? [...new Set([...picked, option.value])] : picked.filter((item) => item !== option.value)
            write(ctx, macro, field.key, next)
          },
        }),
        el('span', { text: option.label }),
      ])
    )
    return el('div', { class: 'row column' }, [
      el('div', { class: 'row-head' }, [el('span', { text: field.label }), hint ? el('small', { class: 'hint', text: hint }) : null]),
      el('div', { class: 'multi' }, boxes),
    ])
  }

  return row(field.label, choiceField(id, String(current), field.options ?? [], (value) => write(ctx, macro, field.key, value)), hint, id)
}

function executionForm(ctx: Ctx, macro: Macro): HTMLElement {
  const { refresh } = ctx
  const e = macro.automation.execution
  const rows: HTMLElement[] = []
  for (const [key, bound] of Object.entries(EXECUTION_BOUNDS)) {
    const field = key as keyof ExecutionSettings
    rows.push(
      row(
        `${EXEC_LABELS[field]}, ${bound.unit}`,
        numberField(`x-${key}`, Number(e[field]), bound.min, bound.max, bound.step, (value) => {
          exec(e, field, value)
          refresh()
        }),
        undefined,
        `x-${key}`
      )
    )
  }
  rows.push(
    row(EXEC_LABELS.intervalMode, choiceField('x-intervalMode', e.intervalMode, CHOICES.intervalMode, (value) => {
      exec(e, 'intervalMode', value)
      refresh()
    }), undefined, 'x-intervalMode'),
    row(EXEC_LABELS.notifications, choiceField('x-notifications', e.notifications, CHOICES.notifications, (value) => {
      exec(e, 'notifications', value)
      refresh()
    }), undefined, 'x-notifications')
  )
  return el('div', { class: 'grid-2' }, rows)
}

function safetyForm(ctx: Ctx, macro: Macro): HTMLElement {
  const { refresh } = ctx
  const s = macro.automation.safety
  const rows: HTMLElement[] = []
  for (const [key, bound] of Object.entries(SAFETY_BOUNDS)) {
    const field = key as keyof SafetySettings
    rows.push(
      row(
        `${SAFETY_LABELS[field]}, ${bound.unit}`,
        numberField(`s-${key}`, Number(s[field]), bound.min, bound.max, bound.step, (value) => {
          exec(s, field, value)
          refresh()
        }),
        undefined,
        `s-${key}`
      )
    )
  }
  rows.push(
    row(SAFETY_LABELS.onError, choiceField('s-onError', s.onError, CHOICES.onError, (value) => {
      exec(s, 'onError', value)
      refresh()
    }), undefined, 's-onError'),
    row(SAFETY_LABELS.logLevel, choiceField('s-logLevel', s.logLevel, CHOICES.logLevel, (value) => {
      exec(s, 'logLevel', value)
      refresh()
    }), undefined, 's-logLevel'),
    row(SAFETY_LABELS.pauseWhenHidden, switchField('s-pause', s.pauseWhenHidden, (value) => {
      exec(s, 'pauseWhenHidden', value)
      refresh()
    }), undefined, 's-pause')
  )
  return el('div', { class: 'grid-2' }, rows)
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'parameters', label: 'Параметры' },
  { id: 'execution', label: 'Выполнение' },
  { id: 'safety', label: 'Защита' },
]

export function macroEditor(ctx: Ctx, macro: Macro): HTMLElement {
  const { catalog, state, issues, refresh } = ctx
  const index = state.config.macros.indexOf(macro)
  const kind = findKind(catalog, macro.kind) ?? catalog.kinds[0]
  const own = issuesFor(issues, `macros[${index}]`)
  const errors = own.filter((issue) => issue.level === 'error').length

  const kindField = choiceField('f-kind', macro.kind, catalog.kinds.map((item) => ({ value: item.id, label: item.label })), (value) => {
    const next = findKind(catalog, value)
    if (next) {
      changeKind(macro, next)
      refresh()
    }
  })

  const tabs = el('div', { class: 'tabs' }, TABS.map((tab) =>
    el('button', {
      type: 'button',
      class: `tab${state.tab === tab.id ? ' active' : ''}`,
      text: tab.label,
      onclick: () => {
        state.tab = tab.id
        refresh()
      },
    })
  ))

  const body = state.tab === 'execution' ? executionForm(ctx, macro) : state.tab === 'safety' ? safetyForm(ctx, macro) : parameterForm(ctx, macro, kind)

  return el('div', { class: 'editor' }, [
    el('div', { class: 'editor-head' }, [
      el('div', { class: 'editor-title' }, [
        el('h1', { text: macro.name || 'Новый макрос' }),
        el('p', { class: 'crumb', text: errors ? `${errors} ошибок — конфиг не будет принят при импорте` : `${kind.label} · параметры проверяются по каталогу` }),
      ]),
      switchField('f-enabled', macro.enabled, (value) => {
        macro.enabled = value
        refresh()
      }),
    ]),
    row('Название', textField('f-macro-name', macro.name, 'Например, Evening fish', 40, false, (value) => {
      macro.name = value
      refresh()
    }), 'до 40 символов', 'f-macro-name'),
    row('Описание', textField('f-macro-desc', macro.description, 'Коротко что делает', 90, true, (value) => {
      macro.description = value
      refresh()
    }), 'до 90 символов', 'f-macro-desc'),
    el('div', { class: 'grid-2' }, [
      row('Категория', kindField, undefined, 'f-kind'),
      el('div', { class: 'row' }, [el('div', { class: 'row-head' }, [el('span', { text: 'Пресеты ритма' })]), el('div', { class: 'row-body' }, presetBlock(ctx, macro))]),
    ]),
    runBlock(ctx, macro),
    el('div', { class: 'divider' }),
    tabs,
    body,
  ])
}

export function groupEditor(ctx: Ctx, group: MacroGroup): HTMLElement {
  const { state, catalog, refresh } = ctx
  const members = state.config.macros.filter((macro) => group.macroIds.includes(macro.id))
  const estimate = estimateGroup(members)
  return el('div', { class: 'editor' }, [
    el('div', { class: 'editor-head' }, [
      el('div', { class: 'editor-title' }, [el('h1', { text: group.name || 'Новая группа' }), el('p', { class: 'crumb', text: `${members.length} макросов · ${formatDuration(estimate.totalSeconds)}` })]),
      button('Удалить', () => {
        removeGroup(ctx.state, group)
        refresh()
      }),
    ]),
    row('Название', textField('g-name', group.name, 'Например, Утро', 40, false, (value) => {
      group.name = value
      refresh()
    }), undefined, 'g-name'),
    row('Описание', textField('g-desc', group.description, '', 90, true, (value) => {
      group.description = value
      refresh()
    }), undefined, 'g-desc'),
    row('Цвет', el('div', { class: 'color-row' }, [
      el('input', { id: 'g-color', class: 'color', type: 'color', value: group.color, oninput: (event: Event) => {
        group.color = (event.target as HTMLInputElement).value
        refresh()
      } }),
      el('code', { text: group.color }),
    ]), undefined, 'g-color'),
    el('div', { class: 'divider' }),
    el('h3', { text: 'Состав группы' }),
    el('div', { class: 'members' }, state.config.macros.length
      ? state.config.macros.map((macro) =>
          el('label', { class: 'check wide' }, [
            el('input', {
              type: 'checkbox',
              checked: group.macroIds.includes(macro.id),
              onchange: () => {
                toggleMember(group, macro)
                refresh()
              },
            }),
            el('span', { text: macro.name || macro.id }),
            el('small', { text: findKind(catalog, macro.kind)?.label ?? macro.kind }),
          ])
        )
      : [el('p', { class: 'empty', text: 'Сначала добавьте макросы.' })]),
  ])
}

export function configEditor(ctx: Ctx): HTMLElement {
  const { state, actions, refresh } = ctx
  const config = state.config
  const settings = config.settings
  const set = (key: keyof ConfigSettings, value: unknown) => {
    exec(settings, key, value)
    refresh()
  }
  return el('div', { class: 'editor' }, [
    el('div', { class: 'editor-head' }, [
      el('div', { class: 'editor-title' }, [el('h1', { text: 'Свойства конфигурации' }), el('p', { class: 'crumb', text: `${config.macros.length} макросов · ${config.groups.length} групп` })]),
    ]),
    row('Название', textField('c-name', config.name, 'Мой набор', 60, false, (value) => {
      config.name = value
      refresh()
    }), undefined, 'c-name'),
    row('Описание', textField('c-desc', config.description, '', 160, true, (value) => {
      config.description = value
      refresh()
    }), undefined, 'c-desc'),
    el('div', { class: 'divider' }),
    el('h3', { text: 'Приложение' }),
    el('div', { class: 'grid-2' }, [
      row('Горячая клавиша', choiceField('c-shortcut', settings.shortcut, CHOICES.shortcut, (value) => set('shortcut', value)), undefined, 'c-shortcut'),
      row('Уведомления', switchField('c-notify', settings.notifications, (value) => set('notifications', value)), undefined, 'c-notify'),
      row('Компактный режим', switchField('c-compact', settings.compact, (value) => set('compact', value)), undefined, 'c-compact'),
      row('Анимации', switchField('c-anim', settings.animations, (value) => set('animations', value)), undefined, 'c-anim'),
    ]),
    el('p', { class: 'note', text: 'Формат фиксирует stopOnError = true: редактор не даёт его выключить.' }),
    el('div', { class: 'divider' }),
    el('div', { class: 'row-tools' }, [
      button('Экспорт JSON', actions.exportConfig, 'accent'),
      button('Нормализовать', actions.normalize),
      button('Новый пустой', () => {
        ctx.state.config = emptyConfig('Новый конфиг')
        select(ctx.state, 'config')
        refresh()
      }),
      button('Пример', () => {
        ctx.state.config = starterConfig(ctx.catalog)
        select(ctx.state, 'config')
        refresh()
      }),
      button('Очистить черновик', actions.clearDraft),
    ]),
  ])
}

export function editor(ctx: Ctx): HTMLElement {
  const { state } = ctx
  if (state.selection.scope === 'macro') {
    const macro = macroOf(state)
    if (macro) return macroEditor(ctx, macro)
  }
  if (state.selection.scope === 'group') {
    const group = groupOf(state)
    if (group) return groupEditor(ctx, group)
  }
  return configEditor(ctx)
}

export function issuesPanel(ctx: Ctx): HTMLElement {
  const { issues, state, refresh } = ctx
  const jump = (issue: Issue) => {
    const macro = /^macros\[(\d+)\]/.exec(issue.path)
    if (macro) {
      const target = state.config.macros[Number(macro[1])]
      if (target) select(state, 'macro', target.id)
    }
    const group = /^groups\[(\d+)\]/.exec(issue.path)
    if (group) {
      const target = state.config.groups[Number(group[1])]
      if (target) select(state, 'group', target.id)
    }
    refresh()
  }
  const items = issues.length
    ? issues.slice(0, 60).map((issue) =>
        el('li', { class: `issue ${issue.level}` }, [
          el('button', { type: 'button', class: 'issue-body', onclick: () => jump(issue) }, [
            el('code', { text: issue.path || 'конфиг' }),
            el('span', { text: issue.message }),
          ]),
        ])
      )
    : [el('li', { class: 'empty', text: 'Замечаний нет — конфиг проходит проверку.' })]
  return el('section', { class: 'panel' }, [
    panelTitle('Проверка', el('span', { class: 'count', text: issues.length ? `${issues.length}` : '0' })),
    el('ul', { class: 'issues' }, items),
  ])
}

export function estimatePanel(ctx: Ctx): HTMLElement {
  const { state, catalog } = ctx
  const macro = macroOf(state)
  const group = groupOf(state)
  const members = group ? state.config.macros.filter((item) => group.macroIds.includes(item.id)) : []
  const estimate = macro ? estimateMacro(macro) : group ? estimateGroup(members) : estimateGroup(state.config.macros.filter((item) => item.enabled))
  const subject = macro ? macro.name : group ? group.name : 'Все включённые'
  const kind = macro ? catalog.kinds.find((item) => item.id === macro.kind) : undefined
  const unlimited = estimate.cycles >= 100000
  return el('section', { class: 'panel' }, [
    panelTitle('Оценка прогона'),
    el('dl', { class: 'stats' }, [
      el('dt', { text: 'Что считаем' }),
      el('dd', { text: `${subject || '—'}${kind ? ` · ${kind.label}` : ''}` }),
      el('dt', { text: 'Циклов' }),
      el('dd', { text: unlimited ? 'без лимита' : String(estimate.cycles) }),
      el('dt', { text: 'Средний цикл' }),
      el('dd', { text: formatDuration(estimate.cycleSeconds) }),
      el('dt', { text: 'Перерывов' }),
      el('dd', { text: String(estimate.breaks) }),
      el('dt', { text: 'Всего' }),
      el('dd', { text: unlimited ? 'не ограничено' : formatDuration(estimate.totalSeconds) }),
      el('dt', { text: 'Остановит' }),
      el('dd', { text: estimate.limiter === 'maxMinutes' ? 'лимит времени' : estimate.limiter === 'cycles' ? 'число циклов' : 'ничего' }),
    ]),
  ])
}

export function previewPanel(ctx: Ctx): HTMLElement {
  const json = JSON.stringify(ctx.state.config, null, 2)
  return el('section', { class: 'panel' }, [
    panelTitle('JSON', el('div', { class: 'panel-actions' }, [button('Копировать', ctx.actions.copyJson), button('Скачать', ctx.actions.exportConfig, 'accent')])),
    el('pre', { class: 'json', text: json }),
  ])
}

export function topbar(ctx: Ctx): HTMLElement {
  const { state, issues, actions } = ctx
  const errors = issues.filter((issue) => issue.level === 'error').length
  return el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'logo', text: '◈' }), el('strong', { text: 'macro-studio' }), el('small', { text: ctx.catalog.title })]),
    el('div', { class: 'state' }, [
      el('span', { class: `status ${errors ? 'bad' : 'good'}`, text: errors ? `${errors} ошибок` : 'валиден' }),
      el('span', { class: 'muted', text: state.config.name || 'без названия' }),
    ]),
    el('div', { class: 'tools' }, [
      el('label', { class: 'btn file' }, [
        el('input', { type: 'file', accept: 'application/json,.json', onchange: (event: Event) => {
          const file = (event.target as HTMLInputElement).files?.[0]
          if (file) actions.importFile(file)
        } }),
        el('span', { text: 'Импорт' }),
      ]),
      button('Экспорт', actions.exportConfig, 'accent'),
    ]),
  ])
}
