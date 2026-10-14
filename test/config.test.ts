import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { emptyConfig, makeMacro, normalizeAutomation, validateConfig } from '../src/core/config.js'
import { defaultAutomation } from '../src/core/catalog.js'
import type { Catalog, Issue, KindDef, Macro, WorkspaceConfig } from '../src/core/types.js'

const catalog = JSON.parse(readFileSync(new URL('../../catalogs/nte-automation.json', import.meta.url), 'utf8')) as Catalog
const weekend = JSON.parse(readFileSync(new URL('../../samples/weekend.json', import.meta.url), 'utf8'))
const broken = JSON.parse(readFileSync(new URL('../../samples/broken.json', import.meta.url), 'utf8'))

const fishing = catalog.kinds[0]

function messageFor(issues: Issue[], pathPart: string): string {
  const found = issues.find((issue) => issue.path.includes(pathPart))
  assert.ok(found, `нет замечания по пути с «${pathPart}»: ${issues.map((i) => i.path).join(', ')}`)
  return found.message
}

function configOf(macros: Macro[], groups: WorkspaceConfig['groups'] = []): WorkspaceConfig {
  return { ...emptyConfig('Тест'), macros, groups, exportedAt: '2026-01-01T00:00:00.000Z' }
}

describe('каталог и выборки', () => {
  it('образец weekend.json не вызывает ни одного замечания', () => {
    assert.deepEqual(validateConfig(weekend, catalog).issues, [])
  })

  it('образец weekend.json валиден и не теряет ничего при нормализации', () => {
    const result = validateConfig(weekend, catalog)
    assert.equal(result.ok, true)
    assert.equal(result.config?.macros.length, 3)
    assert.equal(result.config?.groups.length, 2)
  })

  it('нормализация идемпотентна', () => {
    const once = validateConfig(weekend, catalog).config
    assert.ok(once)
    const twice = validateConfig(once, catalog).config
    assert.deepEqual(twice, once)
  })

  it('отсутствующие параметры берутся из каталога, заданные — сохраняются', () => {
    const macro = validateConfig(weekend, catalog).config?.macros[0]
    assert.equal(macro?.automation.parameters.location, 'pier')
    assert.equal(macro?.automation.parameters.bait, 'lure')
    assert.equal(macro?.automation.parameters.castPower, 80)
    assert.equal(macro?.automation.parameters.autoRecast, true, 'autoRecast должен прийти из default')
    assert.equal(macro?.automation.parameters.capacity, 60)
  })
})

describe('ошибки формата', () => {
  it('не тот тип корня — одна понятная ошибка', () => {
    const result = validateConfig([], catalog)
    assert.equal(result.ok, false)
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0].message, /JSON-объект/)
  })

  it('сломанный образец показывает все классы проблем', () => {
    const result = validateConfig(broken, catalog)
    assert.equal(result.ok, false)
    assert.match(messageFor(result.issues, 'version'), /Версия/)
    assert.match(messageFor(result.issues, 'macros[0].name'), /не может быть пустым/)
    assert.match(messageFor(result.issues, 'macros[0].delay'), /целое 1\.\.60/)
    assert.match(messageFor(result.issues, 'macros[0].repeats'), /целое 0\.\.9999/)
    assert.match(messageFor(result.issues, 'macros[0].automation.parameters.hookWindowMs'), /больше задержки/)
    assert.match(messageFor(result.issues, 'macros[0].automation.parameters.minWeight'), /20/)
    assert.match(messageFor(result.issues, 'macros[0].automation.execution.startDelay'), /0\.\.300/)
    assert.match(messageFor(result.issues, 'macros[1].kind'), /Неизвестная категория/)
    assert.match(messageFor(result.issues, 'macros[1].id'), /некорректный идентификатор/)
    assert.match(messageFor(result.issues, 'groups[0].color'), /#RRGGBB/)
    assert.match(messageFor(result.issues, 'groups[0].macroIds'), /отсутствующий макрос/)
    assert.match(messageFor(result.issues, 'settings.shortcut'), /F6, F8 или F9/)
  })

  it('неизвестный параметр — предупреждение, а не ошибка', () => {
    const issues = validateConfig(broken, catalog).issues
    const warning = issues.find((issue) => issue.path.endsWith('unknownSwitch'))
    assert.equal(warning?.level, 'warning')
  })

  it('значение вне шага — предупреждение', () => {
    const issues = validateConfig(broken, catalog).issues
    assert.equal(issues.find((issue) => issue.path.endsWith('variation'))?.level, 'warning')
  })

  it('stopOnError всегда true, но чужое значение помечается', () => {
    const settings = { ...emptyConfig('Тест').settings, stopOnError: false }
    const result = validateConfig({ ...emptyConfig('Тест'), settings }, catalog)
    assert.equal(result.config?.settings.stopOnError, true)
    assert.equal(result.issues.find((issue) => issue.path === 'settings.stopOnError')?.level, 'warning')
  })

  it('дубликаты id макросов и групп не проходят', () => {
    const first = makeMacro(fishing, new Set(), 0)
    const result = validateConfig(configOf([first, { ...first }]), catalog)
    assert.match(messageFor(result.issues, 'macros[1].id'), /повторяется/)

    const group = { id: 'g-1', name: 'G', description: '', color: '#a578ff', macroIds: [first.id] }
    const withGroups = validateConfig(configOf([first], [group, { ...group }]), catalog)
    assert.match(messageFor(withGroups.issues, 'groups[1].id'), /повторяется/)
  })

  it('зарезервированные имена полей отклоняются', () => {
    const macro = { ...makeMacro(fishing, new Set(), 0), id: '__proto__' }
    assert.match(messageFor(validateConfig(configOf([macro]), catalog).issues, 'macros[0].id'), /некорректный идентификатор/)
  })

  it('превышение лимитов массивов ловится', () => {
    const macro = makeMacro(fishing, new Set(), 0)
    const macros = Array.from({ length: 201 }, (_, index) => ({ ...macro, id: `m-${index}` }))
    assert.match(messageFor(validateConfig(configOf(macros), catalog).issues, 'macros'), /не длиннее 200/)
  })
})

describe('параметры по каталогу', () => {
  it('multi не принимает пустой список и неизвестные варианты', () => {
    const macro = makeMacro(catalog.kinds[2], new Set(), 0)
    macro.automation.parameters.menu = []
    assert.match(messageFor(validateConfig(configOf([macro]), catalog).issues, 'macros[0].automation.parameters.menu'), /хотя бы один/)

    macro.automation.parameters.menu = ['coffee', 'pizza']
    assert.match(messageFor(validateConfig(configOf([macro]), catalog).issues, 'parameters.menu'), /pizza/)
  })

  it('видимые через requires поля всё равно валидируются', () => {
    const macro = makeMacro(fishing, new Set(), 0)
    macro.automation.parameters.releaseSmall = true
    macro.automation.parameters.minWeight = 99
    assert.match(messageFor(validateConfig(configOf([macro]), catalog).issues, 'minWeight'), /0\.\.20/)
  })

  it('правило ordered ловит подсечку', () => {
    const macro = makeMacro(fishing, new Set(), 0)
    macro.automation.parameters.reactionMs = 1200
    macro.automation.parameters.hookWindowMs = 800
    const result = validateConfig(configOf([macro]), catalog)
    assert.equal(result.ok, false)
    assert.match(messageFor(result.issues, 'hookWindowMs'), /больше задержки/)
  })

  it('правило nonEmpty ловит свой маршрут без имени', () => {
    const macro = makeMacro(catalog.kinds[1], new Set(), 0)
    macro.automation.parameters.route = 'custom'
    macro.automation.parameters.routeName = '   '
    assert.match(messageFor(validateConfig(configOf([macro]), catalog).issues, 'routeName'), /название/)
  })

  it('правило requiresValue ловит цель без авторбора', () => {
    const macro = makeMacro(catalog.kinds[4], new Set(), 0)
    macro.automation.parameters.autoPickup = false
    macro.automation.parameters.target = 5
    assert.match(messageFor(validateConfig(configOf([macro]), catalog).issues, 'target'), /должна быть 0/)
  })

  it('automation неизвестной версии — ошибка, но параметры всё равно заполняются', () => {
    const macro = makeMacro(fishing, new Set(), 0)
    ;(macro.automation as { version: number }).version = 2
    const result = validateConfig(configOf([macro]), catalog)
    assert.match(messageFor(result.issues, 'automation.version'), /версия automation/i)
    assert.equal(result.config?.macros[0].automation.version, 1)
  })
})

describe('конструктор новых объектов', () => {
  it('emptyConfig проходит проверку сам по себе', () => {
    assert.equal(validateConfig(emptyConfig('Пустой'), catalog).ok, true)
  })

  it('makeMacro даёт макрос с дефолтами категории и уникальным id', () => {
    const taken = new Set<string>()
    const a = makeMacro(fishing, taken, 0)
    const b = makeMacro(fishing, new Set([a.id]), 1)
    assert.equal(a.id, 'fishing-1')
    assert.equal(b.id, 'fishing-2')
    assert.deepEqual(a.automation.parameters, Object.fromEntries(fishing.fields.map((field) => [field.key, field.default])))
    assert.equal(a.delay, fishing.delay)
  })

  it('normalizeAutomation на undefined возвращает чистые дефолты категории', () => {
    const kind: KindDef = catalog.kinds[0]
    const { automation, issues } = normalizeAutomation(kind, undefined)
    assert.deepEqual(issues, [])
    assert.deepEqual(automation.execution, defaultAutomation().execution)
    assert.equal(automation.parameters.location, 'current')
  })
})
