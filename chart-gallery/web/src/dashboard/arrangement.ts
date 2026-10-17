import { compileSpecStream, validateSpec } from '@json-render/core'
import type { Spec } from '@json-render/core'
import { SUMMARY_MAX, TILE_COMPONENT, TITLE_MAX, catalog } from './catalog'
import type { Headlines, TilePlan } from './types'

export type ArrangeResult = { ok: true; spec: Spec; summaryDropped: boolean } | { ok: false; reason: string }

type Element = Spec['elements'][string]
type PropsSchema = { safeParse: (v: unknown) => { success: boolean } }

const COMPONENTS = catalog.data.components as Record<string, { props: PropsSchema }>
const TILE_TYPES = new Set(Object.values(TILE_COMPONENT))
const FORBIDDEN_ELEMENT_KEYS = ['on', 'watch', 'repeat', 'visible'] as const
const ELLIPSIS = '…'
const CODE_FENCE = /^\s*```/

const fail = (reason: string): ArrangeResult => ({ ok: false, reason })

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const truncate = (text: unknown, max: number): unknown =>
  typeof text === 'string' && text.length > max ? text.slice(0, max - 1) + ELLIPSIS : text

/** True when a value is (or contains) an object with a `$`-prefixed key, i.e. a json-render expression. */
function hasExpression(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExpression)
  if (!isObject(value)) return false
  return Object.entries(value).some(([k, v]) => k.startsWith('$') || hasExpression(v))
}

function compile(text: string): Record<string, unknown> | null {
  const jsonl = text
    .split('\n')
    .filter((line) => !CODE_FENCE.test(line))
    .join('\n')
  try {
    return compileSpecStream(jsonl)
  } catch {
    return null
  }
}

/** Returns a copy with the summary and section titles clipped to the catalog limits. */
function truncateTexts(elements: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, el] of Object.entries(elements)) {
    if (isObject(el) && isObject(el.props) && (el.type === 'Dashboard' || el.type === 'Section')) {
      const [prop, max] = el.type === 'Dashboard' ? ['summary', SUMMARY_MAX] : ['title', TITLE_MAX]
      out[key] = { ...el, props: { ...el.props, [prop]: truncate(el.props[prop], max) } }
    } else {
      out[key] = el
    }
  }
  return out
}

/** Shape checks that must pass before validateSpec, which dereferences elements unguarded. */
function checkShape(key: string, el: unknown): string | null {
  if (!isObject(el) || typeof el.type !== 'string') return `element ${key} is malformed`
  const { children } = el
  if (children !== undefined && !(Array.isArray(children) && children.every((c) => typeof c === 'string'))) {
    return `element ${key} has invalid children`
  }
  return null
}

function checkElement(key: string, el: Element): string | null {
  const forbidden = FORBIDDEN_ELEMENT_KEYS.find((k) => k in el)
  if (forbidden) return `element ${key} uses ${forbidden}`
  const component = COMPONENTS[el.type]
  if (!component) return `element ${key} has unknown type ${el.type}`
  if (hasExpression(el.props)) return `element ${key} uses an expression in props`
  if (!component.props.safeParse(el.props).success) return `element ${key} has invalid props`
  return null
}

/** Checks Dashboard -> Sections -> tiles, every plan placed once with an allowed tile type. */
function checkLayout(spec: Spec, plans: readonly TilePlan[]): string | null {
  const root = spec.elements[spec.root]
  if (root?.type !== 'Dashboard') return 'root is not a Dashboard'
  const sectionKeys = root.children ?? []
  const tileKeys: string[] = []
  for (const key of sectionKeys) {
    const section = spec.elements[key]
    if (section?.type !== 'Section') return `root child ${key} is not a Section`
    tileKeys.push(...(section.children ?? []))
  }
  if (Object.keys(spec.elements).length !== 1 + sectionKeys.length + tileKeys.length) {
    return 'elements are orphaned or placed more than once'
  }
  const byId = new Map(plans.map((p) => [p.chart.id, p]))
  const seen = new Set<number>()
  for (const key of tileKeys) {
    const tile = spec.elements[key] as Element
    if (!TILE_TYPES.has(tile.type)) return `section child ${key} is not a tile`
    const id = tile.props.chartId as number
    const plan = byId.get(id)
    if (!plan) return `unknown chart id ${id}`
    if (seen.has(id)) return `chart id ${id} appears more than once`
    seen.add(id)
    if (!plan.allowed.some((t) => TILE_COMPONENT[t] === tile.type)) return `chart ${id} cannot be a ${tile.type}`
  }
  if (seen.size !== plans.length) return 'some chosen charts are missing'
  return null
}

/** Never throws: any unexpected exception from malformed model output becomes a rejection. */
export function validateArrangement(text: string, plans: readonly TilePlan[], headlines: Headlines): ArrangeResult {
  try {
    return arrange(text, plans, headlines)
  } catch {
    return fail('invalid spec')
  }
}

function arrange(text: string, plans: readonly TilePlan[], headlines: Headlines): ArrangeResult {
  const compiled = compile(text)
  if (!compiled || typeof compiled.root !== 'string' || !isObject(compiled.elements)) return fail('no spec in response')
  if ('state' in compiled) return fail('spec uses state')

  for (const [key, el] of Object.entries(compiled.elements)) {
    const problem = checkShape(key, el)
    if (problem) return fail(problem)
  }

  const spec = { root: compiled.root, elements: truncateTexts(compiled.elements) } as Spec
  const structure = validateSpec(spec)
  if (!structure.valid) return fail(`invalid spec: ${structure.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`)
  for (const [key, el] of Object.entries(spec.elements)) {
    const problem = checkElement(key, el)
    if (problem) return fail(problem)
  }
  const layoutProblem = checkLayout(spec, plans)
  if (layoutProblem) return fail(layoutProblem)

  const root = spec.elements[spec.root] as Element
  const sections = root.children?.length ?? 0
  const counts = { tiles: plans.length, sections }
  if (summaryNumbersMatch(String(root.props.summary), headlines, counts)) return { ok: true, spec, summaryDropped: false }
  const dropped = { ...root, props: { ...root.props, summary: '' } }
  return { ok: true, spec: { ...spec, elements: { ...spec.elements, [spec.root]: dropped } }, summaryDropped: true }
}

const NUMBER = /(?:(?<![\w])[-+])?\$?\d[\d,]*(?:\.\d+)?\s*(?:%|(?:thousand|million|billion|k|m|b)(?![a-z]))?/gi
const MULTIPLIER: Record<string, number> = { '': 1, '%': 1, k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }
const YEAR_MIN = 1900
const YEAR_MAX = 2100
/** Absorbs float error in value × multiplier at the tolerance boundary. */
const EPSILON = 1e-9

/** True when every number in the summary is (by absolute value) a headline value (to its stated precision), a year, or a count. */
export function summaryNumbersMatch(
  summary: string,
  headlines: Headlines,
  counts: { tiles: number; sections: number },
): boolean {
  const values = Object.values(headlines).flatMap((h) =>
    Object.values(h).flatMap((v) => (typeof v === 'number' ? [Math.abs(v)] : [])),
  )
  for (const [match] of summary.matchAll(NUMBER)) {
    const parsed = /^[-+]?\$?([\d,]+(?:\.(\d+))?)\s*(.*)$/i.exec(match)
    if (!parsed) return false
    const [, digits, decimals = '', suffix] = parsed
    const multiplier = MULTIPLIER[suffix.toLowerCase()] ?? 1
    const raw = Number(digits.replace(/,/g, ''))
    const value = raw * multiplier
    const isPlainInteger = decimals === '' && suffix === ''
    if (isPlainInteger && ((raw >= YEAR_MIN && raw <= YEAR_MAX) || raw === counts.tiles || raw === counts.sections)) continue
    const tolerance = 0.5 * 10 ** -decimals.length * multiplier * (1 + EPSILON)
    if (!values.some((v) => Math.abs(v - value) <= tolerance)) return false
  }
  return true
}
