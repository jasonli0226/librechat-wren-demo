// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TILE_COMPONENT, catalog } from './catalog'

const prompt = readFileSync(new URL('./arrange-prompt.md', import.meta.url), 'utf8')
const components = catalog.data.components as Record<
  string,
  { props: { shape: object; safeParse: (v: unknown) => { success: boolean } } }
>

describe('arrange prompt', () => {
  it('mentions every catalog component and prop', () => {
    for (const [name, def] of Object.entries(components)) {
      expect(prompt).toContain(name)
      for (const prop of Object.keys(def.props.shape)) expect(prompt).toContain(prop)
    }
  })

  it('forbids state and invented data', () => {
    for (const phrase of ['state', 'exactly once', 'allowed_types']) expect(prompt).toContain(phrase)
  })

  it('stays compact', () => {
    expect(prompt.length).toBeLessThan(3000)
  })
})

describe('catalog', () => {
  it('tile props reject a string chartId and an unknown width', () => {
    const { props } = components.BarTile
    expect(props.safeParse({ chartId: '1', width: 'half' }).success).toBe(false)
    expect(props.safeParse({ chartId: 1, width: 'third' }).success).toBe(false)
    expect(props.safeParse({ chartId: 1, width: 'half' }).success).toBe(true)
  })

  it('TILE_COMPONENT maps every tile type to a catalog component', () => {
    expect(Object.keys(TILE_COMPONENT).sort()).toEqual(['bar', 'line', 'stackedBar', 'stat', 'table'])
    for (const name of Object.values(TILE_COMPONENT)) expect(components).toHaveProperty(name)
  })
})
