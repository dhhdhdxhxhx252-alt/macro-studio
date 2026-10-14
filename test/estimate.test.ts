import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { makeMacro } from '../src/core/config.js'
import { estimateGroup, estimateMacro, formatDuration } from '../src/core/estimate.js'
import type { Catalog, ExecutionSettings, Macro } from '../src/core/types.js'

const catalog = JSON.parse(readFileSync(new URL('../../catalogs/nte-automation.json', import.meta.url), 'utf8')) as Catalog
const fishing = catalog.kinds[0]

function macro(patch: Partial<Macro> = {}, execution: Partial<ExecutionSettings> = {}): Macro {
  const base = makeMacro(fishing, new Set(), 0)
  return {
    ...base,
    ...patch,
    automation: { ...base.automation, execution: { ...base.automation.execution, ...execution } },
  }
}

it('постоянный интервал: циклы считаются по delay', () => {
  const e = estimateMacro(macro({ cycles: 10, delay: 5 }, { startDelay: 2, maxMinutes: 0, breakEvery: 0 }))
  assert.equal(e.cycleSeconds, 5)
  assert.equal(e.cycles, 10)
  assert.equal(e.breaks, 0)
  assert.equal(e.totalSeconds, 52)
  assert.equal(e.limiter, 'cycles')
})

it('вариативный интервал увеличивает средний цикл на половину разброса', () => {
  const e = estimateMacro(macro({ cycles: 10, delay: 10 }, { intervalMode: 'variable', variation: 20 }))
  assert.equal(e.cycleSeconds, 11)
})

it('фиксированный режим игнорирует разброс', () => {
  const e = estimateMacro(macro({ cycles: 10, delay: 10 }, { intervalMode: 'fixed', variation: 50 }))
  assert.equal(e.cycleSeconds, 10)
})

it('лимит времени важнее числа циклов', () => {
  const e = estimateMacro(macro({ cycles: 100, delay: 60 }, { maxMinutes: 5, startDelay: 0 }))
  assert.equal(e.cycles, 5)
  assert.equal(e.limiter, 'maxMinutes')
})

it('перерывы добавляются к общему времени', () => {
  const e = estimateMacro(macro({ cycles: 20, delay: 1 }, { startDelay: 0, breakEvery: 5, breakSeconds: 30 }))
  assert.equal(e.breaks, 4)
  assert.equal(e.totalSeconds, 140)
})

it('без циклов и без лимита считается по максимуму', () => {
  const e = estimateMacro(macro({ cycles: 0, delay: 5 }, { maxMinutes: 0 }))
  assert.equal(e.cycles, 100000)
  assert.equal(e.limiter, 'none')
})

it('слишком короткий лимит даёт нулевой прогон', () => {
  const e = estimateMacro(macro({ cycles: 10, delay: 60 }, { maxMinutes: 1, startDelay: 0 }))
  assert.equal(e.cycles, 1)
  assert.equal(e.totalSeconds, 60)
})

it('группа складывает длительности', () => {
  const a = macro({ cycles: 10, delay: 5 }, { startDelay: 0, maxMinutes: 0, breakEvery: 0 })
  const b = macro({ id: 'b', cycles: 4, delay: 10 }, { startDelay: 0, maxMinutes: 0, breakEvery: 0 })
  const group = estimateGroup([a, b])
  assert.equal(group.cycles, 14)
  assert.equal(group.totalSeconds, 50 + 40)
})

it('пустая группа — ноль', () => {
  assert.deepEqual(estimateGroup([]), { cycleSeconds: 0, cycles: 0, breaks: 0, totalSeconds: 0, limiter: 'none' })
})

it('формат длительности человекочитаем', () => {
  assert.equal(formatDuration(0), '—')
  assert.equal(formatDuration(45), '45 с')
  assert.equal(formatDuration(125), '2 мин 5 с')
  assert.equal(formatDuration(3725), '1 ч 2 мин')
})
