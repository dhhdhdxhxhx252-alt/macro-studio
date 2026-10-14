import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { emptyConfig, makeMacro, validateConfig } from '../src/core/config.js'
import { applyPreset } from '../src/core/presets.js'
import type { Catalog, Macro } from '../src/core/types.js'

const catalog = JSON.parse(readFileSync(new URL('../../catalogs/nte-automation.json', import.meta.url), 'utf8')) as Catalog

function withMacro(macro: Macro) {
  return validateConfig({ ...emptyConfig('Тест'), macros: [macro] }, catalog)
}

it('пресеты не портят параметры категории и остаются валидными', () => {
  for (const preset of ['careful', 'balanced', 'fast'] as const) {
    const source = makeMacro(catalog.kinds[0], new Set(), 0)
    source.automation.parameters.bait = 'lure'
    const next = applyPreset(source, preset)
    assert.equal(next.automation.parameters.bait, 'lure', preset)
    assert.deepEqual(next.automation.parameters, { ...source.automation.parameters }, preset)
    assert.equal(withMacro(next).ok, true, `${preset}: ${JSON.stringify(withMacro(next).issues)}`)
  }
})

it('осторожный добавляет перерывы и поднимает порог', () => {
  const next = applyPreset(makeMacro(catalog.kinds[0], new Set(), 0), 'careful')
  assert.equal(next.automation.execution.breakEvery, 10)
  assert.equal(next.automation.execution.maxMinutes, 60)
  assert.equal(next.automation.execution.intervalMode, 'variable')
  assert.equal(next.automation.safety.confidence, 90)
})

it('быстрый убирает задержку и перерывы', () => {
  const next = applyPreset(makeMacro(catalog.kinds[0], new Set(), 0), 'fast')
  assert.equal(next.automation.execution.startDelay, 0)
  assert.equal(next.automation.execution.breakEvery, 0)
  assert.equal(next.automation.safety.onError, 'skip')
})

it('баланс возвращает дефолтные значения выполнения и защиты', () => {
  const careful = applyPreset(makeMacro(catalog.kinds[0], new Set(), 0), 'careful')
  const back = applyPreset(careful, 'balanced')
  assert.equal(back.automation.execution.maxMinutes, 0)
  assert.equal(back.automation.safety.confidence, 80)
  assert.equal(back.automation.safety.onError, 'retry')
})

it('интервал после пресета остаётся в пределах 1..60', () => {
  const slow = makeMacro(catalog.kinds[0], new Set(), 0)
  slow.delay = 60
  assert.equal(applyPreset(slow, 'careful').delay, 60)
  const quick = makeMacro(catalog.kinds[0], new Set(), 0)
  quick.delay = 1
  assert.equal(applyPreset(quick, 'fast').delay, 1)
})
