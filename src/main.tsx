import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/primitives.css'
import './styles/app.css'
import './styles/forge.css'
import './styles/cast.css'
import './styles/ring.css'
import './styles/brawl.css'
import './styles/bluff.css'
import './styles/buzzer.css'
import './styles/mirror.css'
import './styles/show.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
