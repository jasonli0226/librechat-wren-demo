import { type FormEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { DashboardView } from '../dashboard/DashboardView'
import {
  type DashboardParams,
  type DashboardSource,
  MAX_BOUNDS,
  MIN_BOUNDS,
  parseDashboardParams,
} from '../dashboard/selection'
import { useDashboard } from '../dashboard/useDashboard'

const MIN_STEP = 0.05

function BackLink() {
  return (
    <p>
      <Link to="/">Back to the gallery</Link>
    </p>
  )
}

function describeSource(source: DashboardSource): string {
  return source.kind === 'chart' ? `Charts related to chart ${source.id}` : `Charts matching “${source.q}”`
}

interface ControlsProps {
  readonly params: DashboardParams
  readonly onRebuild: (min: string, max: string) => void
}

function Controls({ params, onRebuild }: ControlsProps) {
  const [min, setMin] = useState(String(params.min))
  const [max, setMax] = useState(String(params.max))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onRebuild(min, max)
  }
  return (
    <form className="toolbar dashboard-controls" onSubmit={submit}>
      <label>
        Min score
        <input
          type="number"
          min={MIN_BOUNDS.lo}
          max={MIN_BOUNDS.hi}
          step={MIN_STEP}
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
      </label>
      <label>
        Max tiles
        <input
          type="number"
          min={MAX_BOUNDS.lo}
          max={MAX_BOUNDS.hi}
          step={1}
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </label>
      <button type="submit">Rebuild</button>
    </form>
  )
}

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const params = useMemo(() => parseDashboardParams(searchParams), [searchParams])
  const [buildId, setBuildId] = useState(0)
  const state = useDashboard(params, buildId)

  if (params.source === null) {
    return (
      <div className="dashboard-page">
        <h1>Dashboard</h1>
        <p className="status">Pick a chart or search the gallery to build a dashboard.</p>
        <BackLink />
      </div>
    )
  }

  const rebuild = (min: string, max: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('min', min)
    next.set('max', max)
    // Store the clamped values, so the URL says what the dashboard actually used.
    const clamped = parseDashboardParams(next)
    next.set('min', String(clamped.min))
    next.set('max', String(clamped.max))
    setSearchParams(next)
    setBuildId((id) => id + 1)
  }

  return (
    <div className="dashboard-page">
      <h1>Dashboard</h1>
      <p className="status">{describeSource(params.source)}</p>
      <Controls key={`${params.min} ${params.max}`} params={params} onRebuild={rebuild} />
      {state.status === 'selecting' ? <p className="status">Finding related charts…</p> : null}
      {state.status === 'missing' ? (
        <>
          <p className="status">{state.message}</p>
          <BackLink />
        </>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.belowThreshold ? <p className="status">Lower Min score to see more charts.</p> : null}
          <DashboardView spec={state.spec} plans={state.plans} data={state.data} note={state.note} />
        </>
      ) : null}
    </div>
  )
}
