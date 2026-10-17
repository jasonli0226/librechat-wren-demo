// @vitest-environment node
import type { Spec } from '@json-render/core'
import { describe, expect, it } from 'vitest'
import type { ChartDetail } from '../types'
import { validateArrangement, summaryNumbersMatch } from './arrangement'
import { INSIGHT_MAX, TITLE_MAX } from './catalog'
import { tileKey } from './rulesLayout'
import type { Headlines, TilePlan, TileType } from './types'

type Element = Spec['elements'][string]

const plan = (id: number, type: TileType, allowed: TileType[] = [type]): TilePlan => ({
  chart: { id, title: `c${id}`, description: '', chart_type: 'bar', tables: ['orders'], updated_at: '', x_field: 'x', y_fields: ['y'], sql: '', rows: [], created_at: '' } as ChartDetail,
  type,
  allowed,
  confidence: null,
})

const PLANS = [plan(1, 'stat'), plan(2, 'bar', ['bar', 'table']), plan(3, 'line')]
const HEADLINES: Headlines = { '1': { value: 8_212_000, label: 'Revenue' }, '3': { pct_change: 12.0 } }

const tile = (type: string, chartId: unknown, width = 'half'): Element => ({ type, props: { chartId, width }, children: [] })

const BULLETS = ['Revenue reached $8.2M.', 'Trend is up 12%.']

/** A valid arrangement of PLANS: chart 1 as the hero with insights, then two sections. */
function heroSpec(bullets: string[] = BULLETS): Spec {
  return {
    root: 'dashboard',
    elements: {
      dashboard: { type: 'Dashboard', props: {}, children: ['hero', 's-bar', 's-trend'] },
      hero: { type: 'Hero', props: {}, children: [tileKey(1), 'insights'] },
      insights: { type: 'Insights', props: { bullets }, children: [] },
      's-bar': { type: 'Section', props: { title: 'Breakdown' }, children: [tileKey(2)] },
      's-trend': { type: 'Section', props: { title: 'Trends' }, children: [tileKey(3)] },
      [tileKey(1)]: tile('StatTile', 1, 'full'),
      [tileKey(2)]: tile('BarTile', 2),
      [tileKey(3)]: tile('LineTile', 3, 'full'),
    },
  }
}

/** Turns a spec into the JSONL patch lines the model emits. */
function toJsonl(spec: Spec): string {
  const lines: object[] = [{ op: 'add', path: '/root', value: spec.root }]
  for (const [key, value] of Object.entries(spec.elements)) lines.push({ op: 'add', path: `/elements/${key}`, value })
  if (spec.state) lines.push({ op: 'add', path: '/state', value: spec.state })
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

const withElement = (spec: Spec, key: string, element: Element): Spec => ({ ...spec, elements: { ...spec.elements, [key]: element } })

const validate = (spec: Spec) => validateArrangement(toJsonl(spec), PLANS, HEADLINES)

describe('validateArrangement', () => {
  it('accepts a valid hero arrangement', () => {
    const result = validate(heroSpec())
    expect(result).toEqual({ ok: true, spec: heroSpec(), bulletsDropped: 0 })
  })

  it('accepts a hero without insights and any valid hero width', () => {
    const base = withElement(heroSpec(), 'hero', { type: 'Hero', props: {}, children: [tileKey(1)] })
    const { insights: _gone, ...elements } = withElement(base, tileKey(1), tile('StatTile', 1, 'quarter')).elements
    expect(validate({ ...base, elements })).toMatchObject({ ok: true, bulletsDropped: 0 })
  })

  it('ignores code fences and prose lines', () => {
    const text = ['Here is your dashboard:', '```jsonl', toJsonl(heroSpec()), '```'].join('\n')
    expect(validateArrangement(text, PLANS, HEADLINES)).toMatchObject({ ok: true, bulletsDropped: 0 })
  })

  it('truncates an over-long title instead of rejecting', () => {
    const spec = withElement(heroSpec(), 's-bar', { type: 'Section', props: { title: 'y'.repeat(TITLE_MAX + 5) }, children: [tileKey(2)] })
    const result = validate(spec)
    if (!result.ok) throw new Error(result.reason)
    expect(result.spec.elements['s-bar']!.props.title).toBe(`${'y'.repeat(TITLE_MAX - 1)}…`)
  })

  it('truncates a 200-char bullet to 120 with an ellipsis', () => {
    const result = validate(heroSpec(['x'.repeat(200)]))
    if (!result.ok) throw new Error(result.reason)
    expect(INSIGHT_MAX).toBe(120)
    expect(result.spec.elements.insights!.props.bullets).toEqual([`${'x'.repeat(INSIGHT_MAX - 1)}…`])
  })

  it('rejects a missing chart id', () => {
    const base = heroSpec()
    const spec = withElement(base, 'dashboard', { type: 'Dashboard', props: {}, children: ['hero', 's-bar'] })
    const { [tileKey(3)]: _tile, 's-trend': _section, ...elements } = spec.elements
    expect(validate({ ...spec, elements }).ok).toBe(false)
  })

  it('rejects a duplicated chart id', () => {
    const spec = withElement(heroSpec(), 's-trend', { type: 'Section', props: { title: 'Trends' }, children: [tileKey(3), 'dup'] })
    expect(validate(withElement(spec, 'dup', tile('BarTile', 2))).ok).toBe(false)
  })

  it('rejects an unknown chart id', () => {
    const spec = withElement(heroSpec(), 's-trend', { type: 'Section', props: { title: 'Trends' }, children: [tileKey(3), 'ghost'] })
    expect(validate(withElement(spec, 'ghost', tile('BarTile', 99))).ok).toBe(false)
  })

  it('rejects a tile type outside allowed', () => {
    expect(validate(withElement(heroSpec(), tileKey(2), tile('LineTile', 2))).ok).toBe(false)
  })

  it('rejects a string chartId', () => {
    expect(validate(withElement(heroSpec(), tileKey(2), tile('BarTile', '2'))).ok).toBe(false)
  })

  it('rejects state and on', () => {
    expect(validate({ ...heroSpec(), state: { x: 1 } }).ok).toBe(false)
    const withOn = { ...tile('BarTile', 2), on: { press: { action: 'noop' } } } as Element
    expect(validate(withElement(heroSpec(), tileKey(2), withOn)).ok).toBe(false)
  })

  it('rejects $-expressions in props', () => {
    const expr = { type: 'Section', props: { title: { $state: '/t' } }, children: [tileKey(2)] } as unknown as Element
    expect(validate(withElement(heroSpec(), 's-bar', expr)).ok).toBe(false)
  })

  it('rejects a non-Dashboard root and non-Section root children after the hero', () => {
    expect(validate({ ...heroSpec(), root: 's-bar' }).ok).toBe(false)
    const flat = withElement(heroSpec(), 'dashboard', { type: 'Dashboard', props: {}, children: ['hero', tileKey(2), 's-trend'] })
    expect(validate(flat).ok).toBe(false)
  })

  it('rejects a Section as the first root child', () => {
    const spec = withElement(heroSpec(), 'dashboard', { type: 'Dashboard', props: {}, children: ['s-bar', 'hero', 's-trend'] })
    expect(validate(spec)).toMatchObject({ ok: false })
  })

  it('rejects a duplicate Section key among root children', () => {
    // The repeat plus one unused element would balance the element count and inflate the section count.
    const base = withElement(heroSpec(['3 charts in 4 sections']), 'dashboard', { type: 'Dashboard', props: {}, children: ['hero', 's-bar', 's-trend', 's-empty', 's-empty'] })
    const empty: Element = { type: 'Section', props: { title: 'Spare' }, children: [] }
    const spec = withElement(withElement(base, 's-empty', empty), 'unused', empty)
    expect(validate(spec)).toEqual({ ok: false, reason: 'element s-empty is placed more than once' })
  })

  it('rejects a spec whose hero tile is not plans[0]', () => {
    const swapped = withElement(
      withElement(heroSpec(), 'hero', { type: 'Hero', props: {}, children: [tileKey(2), 'insights'] }),
      's-bar',
      { type: 'Section', props: { title: 'Breakdown' }, children: [tileKey(1)] },
    )
    expect(validate(swapped)).toMatchObject({ ok: false })
  })

  it('rejects a hero tile type outside allowed', () => {
    expect(validate(withElement(heroSpec(), tileKey(1), tile('BarTile', 1, 'full'))).ok).toBe(false)
  })

  it('rejects two Insights in the hero', () => {
    const base = withElement(heroSpec(), 'hero', { type: 'Hero', props: {}, children: [tileKey(1), 'insights', 'insights-2'] })
    const spec = withElement(base, 'insights-2', { type: 'Insights', props: { bullets: ['More.'] }, children: [] })
    expect(validate(spec)).toMatchObject({ ok: false })
  })

  it('rejects a hero that starts with Insights or has no tile', () => {
    expect(validate(withElement(heroSpec(), 'hero', { type: 'Hero', props: {}, children: ['insights', tileKey(1)] })).ok).toBe(false)
    const empty = withElement(heroSpec(), 'hero', { type: 'Hero', props: {}, children: [] })
    const { insights: _i, [tileKey(1)]: _t, ...elements } = empty.elements
    expect(validate({ ...empty, elements }).ok).toBe(false)
  })

  it('rejects Insights with children', () => {
    const spec = withElement(heroSpec(), 'insights', { type: 'Insights', props: { bullets: BULLETS }, children: [tileKey(2)] })
    expect(validate(spec).ok).toBe(false)
  })

  it('rejects empty or more than five bullets', () => {
    expect(validate(heroSpec([])).ok).toBe(false)
    expect(validate(heroSpec(Array.from({ length: 6 }, () => 'Steady.'))).ok).toBe(false)
  })

  it('rejects an unknown element type', () => {
    expect(validate(withElement(heroSpec(), tileKey(2), tile('PieTile', 2))).ok).toBe(false)
  })

  it('rejects a null element and non-array children without throwing', () => {
    const nullLine = JSON.stringify({ op: 'add', path: '/elements/x', value: null })
    expect(validateArrangement(`${toJsonl(heroSpec())}\n${nullLine}`, PLANS, HEADLINES).ok).toBe(false)
    const badChildren = { ...tile('BarTile', 2), children: 5 } as unknown as Element
    expect(validate(withElement(heroSpec(), tileKey(2), badChildren)).ok).toBe(false)
  })

  it('rejects unparseable text', () => {
    expect(validateArrangement('not json', PLANS, HEADLINES).ok).toBe(false)
  })

  it('checks a bullet in its truncated form', () => {
    const lateNumber = `${'x'.repeat(INSIGHT_MAX + 10)} 999`
    const earlyNumber = `999 ${'x'.repeat(INSIGHT_MAX + 10)}`
    const result = validate(heroSpec([lateNumber, earlyNumber]))
    if (!result.ok) throw new Error(result.reason)
    expect(result.bulletsDropped).toBe(1)
    expect(result.spec.elements.insights!.props.bullets).toEqual([`${'x'.repeat(INSIGHT_MAX - 1)}…`])
  })

  it('drops only the bullet with an unknown number', () => {
    const result = validate(heroSpec([BULLETS[0], 'Revenue hit $9M.', BULLETS[1]]))
    if (!result.ok) throw new Error(result.reason)
    expect(result.bulletsDropped).toBe(1)
    expect(result.spec.elements.insights!.props.bullets).toEqual(BULLETS)
    expect(result.spec.elements.hero).toEqual(heroSpec().elements.hero)
    expect(result.spec.elements['s-trend']).toEqual(heroSpec().elements['s-trend'])
  })

  it('removes Insights when every bullet fails', () => {
    const result = validate(heroSpec(['Revenue hit $9M.', 'Up 99%.']))
    if (!result.ok) throw new Error(result.reason)
    expect(result.bulletsDropped).toBe(2)
    expect(result.spec.elements.hero!.children).toEqual([tileKey(1)])
    expect(result.spec.elements.insights).toBeUndefined()
  })

  it('blanks a Section title with an unknown number and keeps the rest of the spec', () => {
    const spec = withElement(heroSpec(), 's-bar', { type: 'Section', props: { title: 'Revenue up 40%' }, children: [tileKey(2)] })
    const result = validate(spec)
    if (!result.ok) throw new Error(result.reason)
    expect(result.spec.elements['s-bar']).toEqual({ ...spec.elements['s-bar'], props: { title: '' } })
    expect(result.spec).toEqual(withElement(spec, 's-bar', result.spec.elements['s-bar']!))
    expect(result.bulletsDropped).toBe(0)
  })

  it('keeps a Section title whose numbers match', () => {
    const spec = withElement(heroSpec(), 's-trend', { type: 'Section', props: { title: 'Trend up 12%' }, children: [tileKey(3)] })
    expect(validate(spec)).toEqual({ ok: true, spec, bulletsDropped: 0 })
  })

  it('checks a Section title in its truncated form', () => {
    const title = `${'y'.repeat(TITLE_MAX + 5)} 999`
    const spec = withElement(heroSpec(), 's-bar', { type: 'Section', props: { title }, children: [tileKey(2)] })
    const result = validate(spec)
    if (!result.ok) throw new Error(result.reason)
    expect(result.spec.elements['s-bar']!.props.title).toBe(`${'y'.repeat(TITLE_MAX - 1)}…`)
  })

  it('rejects an empty bullet', () => {
    expect(validate(heroSpec(['Revenue reached $8.2M.', ''])).ok).toBe(false)
  })

  it('counts sections without the hero', () => {
    const plans = [...PLANS, plan(4, 'bar')]
    const spec = withElement(
      withElement(heroSpec(['4 charts in 2 groups']), 's-trend', { type: 'Section', props: { title: 'Trends' }, children: [tileKey(3), tileKey(4)] }),
      tileKey(4),
      tile('BarTile', 4),
    )
    const result = validateArrangement(toJsonl(spec), plans, {})
    expect(result).toMatchObject({ ok: true, bulletsDropped: 0 })
  })
})

describe('summaryNumbersMatch', () => {
  const h = (values: Record<string, number | string>): Headlines => ({ '1': values })
  const counts = { tiles: 6, sections: 2 }

  it('matches values within the precision the summary states', () => {
    expect(summaryNumbersMatch('$8.2M', h({ value: 8_212_000 }), counts)).toBe(true)
    expect(summaryNumbersMatch('12%', h({ pct_change: 12.0 }), counts)).toBe(true)
    expect(summaryNumbersMatch('1.82 million', h({ value: 1_823_000 }), counts)).toBe(true)
    expect(summaryNumbersMatch('$9M', h({ value: 8_212_000 }), counts)).toBe(false)
  })

  it('matches an unsigned number by absolute value', () => {
    expect(summaryNumbersMatch('down 12%', h({ pct_change: -12 }), counts)).toBe(true)
    expect(summaryNumbersMatch('fell 12%', h({ pct_change: -12 }), counts)).toBe(true)
  })

  it('matches an explicit minus only against a negative value', () => {
    expect(summaryNumbersMatch('-12%', h({ pct_change: 12 }), counts)).toBe(false)
    expect(summaryNumbersMatch('r = -0.8', h({ r: 0.8 }), counts)).toBe(false)
    expect(summaryNumbersMatch('r = -0.8', h({ r: -0.8 }), counts)).toBe(true)
  })

  it('matches an explicit plus only against a non-negative value', () => {
    expect(summaryNumbersMatch('+12%', h({ pct_change: -12 }), counts)).toBe(false)
    expect(summaryNumbersMatch('+12%', h({ pct_change: 12 }), counts)).toBe(true)
  })

  it('bounds a match to 5% of the value, so small values need their real digits', () => {
    expect(summaryNumbersMatch('a perfect correlation, r = 1', h({ r: 0.62 }), counts)).toBe(false)
    expect(summaryNumbersMatch('r is 0', h({ r: 0.3 }), counts)).toBe(false)
    expect(summaryNumbersMatch('r is 0', h({ r: 0 }), counts)).toBe(true)
    expect(summaryNumbersMatch('r is 0.0', h({ r: 0.01 }), counts)).toBe(false)
    expect(summaryNumbersMatch('1.2M', h({ value: 1_234_000 }), counts)).toBe(true)
    expect(summaryNumbersMatch('$8.2M', h({ value: 8_212_000 }), counts)).toBe(true)
  })

  it('allows years and the tile and section counts only', () => {
    expect(summaryNumbersMatch('in 2025', h({}), counts)).toBe(true)
    expect(summaryNumbersMatch('from 2024-2025', h({}), counts)).toBe(true)
    expect(summaryNumbersMatch('6 charts', h({}), counts)).toBe(true)
    expect(summaryNumbersMatch('2 sections', h({}), counts)).toBe(true)
    expect(summaryNumbersMatch('3 charts', h({}), counts)).toBe(false)
  })

  it('strips thousands separators', () => {
    expect(summaryNumbersMatch('$8,200,000', h({ value: 8_212_000 }), counts)).toBe(false)
    expect(summaryNumbersMatch('$8,200,000', h({ value: 8_200_000 }), counts)).toBe(true)
  })

  it('passes a summary with no numbers and ignores string headline values', () => {
    expect(summaryNumbersMatch('Revenue is steady.', h({}), counts)).toBe(true)
    expect(summaryNumbersMatch('Top region 42', h({ label: '42' }), counts)).toBe(false)
  })

  it('does not read a word starting with m, b or k as a suffix', () => {
    expect(summaryNumbersMatch('6 months', h({}), counts)).toBe(true)
  })
})
