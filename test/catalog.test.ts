import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { validateCatalog } from '../src/core/catalog.js'
import type { Catalog, KindDef } from '../src/core/types.js'

const shipped = JSON.parse(readFileSync(new URL('../../catalogs/nte-automation.json', import.meta.url), 'utf8')) as Catalog

const base: KindDef = {
  id: 'demo',
  label: 'Демо',
  fields: [{ key: 'mode', label: 'Режим', type: 'select', default: 'a', options: [{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }] }],
}

function catalogWith(kind: KindDef): Catalog {
  return { version: 1, title: 'тест', kinds: [kind] }
}

function paths(catalog: Catalog): string {
  return validateCatalog(catalog).map((issue) => `${issue.path}: ${issue.message}`).join('\n')
}

it('поставляемый каталог валиден целиком', () => {
  assert.deepEqual(validateCatalog(shipped), [])
})

it('корректная категория не даёт замечаний', () => {
  assert.deepEqual(validateCatalog(catalogWith(base)), [])
})

it('ловит неверный id категории и дубликаты', () => {
  assert.match(paths(catalogWith({ ...base, id: 'Fishing' })), /kinds\[0\]\.id/)
  assert.match(paths(catalogWith({ ...base, id: 'd' })), /kinds\[0\]\.id/)
  const duplicated: KindDef = { ...base, id: 'demo-x' }
  assert.match(paths({ version: 1, title: '', kinds: [duplicated, duplicated] }), /повторяется/)
})

it('требует options и совпадения default', () => {
  assert.match(paths(catalogWith({ ...base, fields: [{ ...base.fields[0], options: undefined }] })), /нужен непустой список options/)
  assert.match(paths(catalogWith({ ...base, fields: [{ ...base.fields[0], default: 'c' }] })), /default должно быть одним из options/)
  assert.match(paths(catalogWith({ ...base, fields: [{ ...base.fields[0], type: 'multi', default: 'a' }] })), /Для multi default/)
})

it('проверяет границы числовых полей', () => {
  assert.match(paths(catalogWith({ ...base, fields: [{ key: 'power', label: 'Сила', type: 'number', default: 5 }] })), /нужны min и max/)
  assert.match(paths(catalogWith({ ...base, fields: [{ key: 'power', label: 'Сила', type: 'number', default: 5, min: 10, max: 1 }] })), /min не может быть больше/)
  assert.match(paths(catalogWith({ ...base, fields: [{ key: 'power', label: 'Сила', type: 'range', default: 99, min: 1, max: 10 }] })), /default вне диапазона/)
  assert.match(paths(catalogWith({ ...base, fields: [{ key: 'power', label: 'Сила', type: 'number', default: 5, min: 1, max: 10, step: 0 }] })), /step должен быть больше нуля/)
})

it('проверяет тип default у toggle и text', () => {
  assert.match(paths(catalogWith({ ...base, fields: [{ key: 'flag', label: 'Флаг', type: 'toggle', default: 'yes' }] })), /toggle/)
  assert.match(paths(catalogWith({ ...base, fields: [{ key: 'note', label: 'Заметка', type: 'text', default: 3 }] })), /text/)
})

it('ловит ссылку requires на неизвестное поле', () => {
  const kind: KindDef = { ...base, fields: [{ key: 'extra', label: 'Доп', type: 'number', default: 1, min: 0, max: 5, requires: { key: 'ghost', value: true } }] }
  assert.match(paths(catalogWith(kind)), /неизвестный key «ghost»/)
})

it('ловит битые перекрёстные правила', () => {
  const ordered: KindDef = { ...base, rules: [{ id: 'r', type: 'ordered', message: 'м', smaller: 'mode', larger: 'ghost' }] }
  assert.match(paths(catalogWith(ordered)), /ordered ссылается/)
  const implies: KindDef = { ...base, rules: [{ id: 'r', type: 'implies', message: 'м', when: { key: 'ghost', min: Number.NaN }, then: { key: 'ghost', equals: 'a' } }] }
  assert.match(paths(catalogWith(implies)), /implies ссылается/)
  const wrongRule = [{ id: 'r', type: 'nope', message: 'м' } as unknown as NonNullable<KindDef['rules']>[number]]
  assert.match(paths(catalogWith({ ...base, rules: wrongRule })), /Неизвестный тип правила/)
})

it('не принимает каталог не первой версии и без категорий', () => {
  assert.match(paths({ version: 2 as unknown as 1, title: '', kinds: [base] }), /только версия 1/)
  assert.match(paths({ version: 1, title: '', kinds: [] }), /хотя бы одна категория/)
})
