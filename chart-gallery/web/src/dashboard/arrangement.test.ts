// @vitest-environment node
import type { Spec } from '@json-render/core'
import { describe, expect, it } from 'vitest'
import type { ChartDetail } from '../types'
import { validateArrangement, summaryNumbersMatch } from './arrangement'
import { SUMMARY_MAX, TITLE_MAX } from './catalog'
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

/** A valid two-section arrangement of PLANS. */
function twoSections(summary = 'Revenue reached $8.2M, up 12%.'): Spec {
  return {
    root: 'dashboard',
    elements: {
      dashboard: { type: 'Dashboard', props: { summary }, children: ['s-kpi', 's-trend'] },
      's-kpi': { type: 'Section', props: { title: 'Headline' }, children: [tileKey(1)] },
      's-trend': { type: 'Section', props: { title: 'Trends' }, children: [tileKey(2), tileKey(3)] },
      [tileKey(1)]: tile('StatTile', 1, 'quarter'),
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
  it('accepts a valid two-section arrangement', () => {
    const result = validate(twoSections())
    expect(result).toEqual({ ok: true, spec: twoSections(), summaryDropped: false })
  })

  it('ignores code fences and prose lines', () => {
    const text = ['Here is your dashboard:', '```jsonl', toJsonl(twoSections()), '```'].join('\n')
    expect(validateArrangement(text, PLANS, HEADLINES)).toMatchObject({ ok: true, summaryDropped: false })
  })

  it('truncates an over-long summary and title instead of rejecting', () => {
    const base = twoSections('x'.repeat(SUMMARY_MAX + 50))
    const spec = withElement(base, 's-kpi', { type: 'Section', props: { title: 'y'.repeat(TITLE_MAX + 5) }, children: [tileKey(1)] })
    const result = validate(spec)
    if (!result.ok) throw new Error(result.reason)
    const summary = result.spec.elements.dashboard!.props.summary as string
    const title = result.spec.elements['s-kpi']!.props.title as string
    expect(summary).toBe(`${'x'.repeat(SUMMARY_MAX - 1)}…`)
    expect(title).toBe(`${'y'.repeat(TITLE_MAX - 1)}…`)
  })

  it('rejects a missing chart id', () => {
    const base = twoSections()
    const spec = withElement(base, 's-trend', { type: 'Section', props: { title: 'Trends' }, children: [tileKey(2)] })
    const { [tileKey(3)]: _dropped, ...elements } = spec.elements
    expect(validate({ ...spec, elements }).ok).toBe(false)
  })

  it('rejects a duplicated chart id', () => {
    const spec = withElement(twoSections(), 's-trend', { type: 'Section', props: { title: 'Trends' }, children: [tileKey(2), tileKey(3), 'dup'] })
    expect(validate(withElement(spec, 'dup', tile('BarTile', 2))).ok).toBe(false)
  })

  it('rejects an unknown chart id', () => {
    const spec = withElement(twoSections(), 's-trend', { type: 'Section', props: { title: 'Trends' }, children: [tileKey(2), tileKey(3), 'ghost'] })
    expect(validate(withElement(spec, 'ghost', tile('BarTile', 99))).ok).toBe(false)
  })

  it('rejects a tile type outside allowed', () => {
    expect(validate(withElement(twoSections(), tileKey(2), tile('LineTile', 2))).ok).toBe(false)
  })

  it('rejects a string chartId', () => {
    expect(validate(withElement(twoSections(), tileKey(2), tile('BarTile', '2'))).ok).toBe(false)
  })

  it('rejects state and on', () => {
    expect(validate({ ...twoSections(), state: { x: 1 } }).ok).toBe(false)
    const withOn = { ...tile('BarTile', 2), on: { press: { action: 'noop' } } } as Element
    expect(validate(withElement(twoSections(), tileKey(2), withOn)).ok).toBe(false)
  })

  it('rejects $-expressions in props', () => {
    const expr = { type: 'Section', props: { title: { $state: '/t' } }, children: [tileKey(1)] } as unknown as Element
    expect(validate(withElement(twoSections(), 's-kpi', expr)).ok).toBe(false)
  })

  it('rejects a non-Dashboard root and non-Section root children', () => {
    expect(validate({ ...twoSections(), root: 's-kpi' }).ok).toBe(false)
    const flat = withElement(twoSections(), 'dashboard', { type: 'Dashboard', props: { summary: '' }, children: [tileKey(1), 's-trend'] })
    expect(validate(flat).ok).toBe(false)
  })

  it('rejects an unknown element type', () => {
    expect(validate(withElement(twoSections(), tileKey(2), tile('PieTile', 2))).ok).toBe(false)
  })

  it('rejects unparseable text', () => {
    expect(validateArrangement('not json', PLANS, HEADLINES).ok).toBe(false)
  })

  it('drops only the summary when it cites an unknown number', () => {
    const result = validate(twoSections('Revenue hit $9M.'))
    if (!result.ok) throw new Error(result.reason)
    expect(result.summaryDropped).toBe(true)
    expect(result.spec.elements.dashboard).toEqual({ ...twoSections().elements.dashboard, props: { summary: '' } })
    expect(result.spec.elements['s-trend']).toEqual(twoSections().elements['s-trend'])
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

  it('allows years and the tile and section counts only', () => {
    expect(summaryNumbersMatch('in 2025', h({}), counts)).toBe(true)
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
