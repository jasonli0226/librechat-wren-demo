import { describe, expect, it } from 'vitest'
import { relativeTime } from './time'

const now = new Date('2026-10-16T12:00:00Z')

describe('relativeTime', () => {
  it.each([
    ['2026-10-16T11:59:40Z', 'just now'],
    ['2026-10-16T10:00:00Z', '2 hours ago'],
    ['2026-10-15T12:00:00Z', 'yesterday'],
    ['2026-08-16T12:00:00Z', '2 months ago'],
    ['not a date', ''],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected)
  })
})
