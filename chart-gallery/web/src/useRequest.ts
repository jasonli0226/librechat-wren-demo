import { type DependencyList, useEffect, useState } from 'react'
import { ApiError } from './api'

export type RequestState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: ApiError }

export function useRequest<T>(load: () => Promise<T>, deps: DependencyList): RequestState<T> {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' })
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    load().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) =>
        active && setState({ status: 'error', error: error instanceof ApiError ? error : new ApiError(String(error), 0) }),
    )
    return () => {
      active = false
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}
