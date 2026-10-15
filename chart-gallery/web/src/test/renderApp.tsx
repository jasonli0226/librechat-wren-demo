import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SemanticProvider } from 'semantic-state/react'
import { AppRoutes } from '../App'
import { createFakeStore } from './fakeStore'

export function renderApp(path: string, store = createFakeStore().store) {
  return {
    store,
    ...render(
      <SemanticProvider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SemanticProvider>,
    ),
  }
}
