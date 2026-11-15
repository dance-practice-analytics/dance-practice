// Entry of the v2 tree. Only the design stylesheet and v2.css are loaded here;
// never import the old styles.css / pages.css / shell.css / motion.css.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './studio.css'
import './v2.css'
import './theme'
import { App } from './App'

document.title = 'Dance Practice Analytics'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
