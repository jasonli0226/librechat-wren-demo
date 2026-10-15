import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { chartStore } from './semantic/store'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={chartStore} />
  </StrictMode>,
)
