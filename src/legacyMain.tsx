// The MT-1 prototype tree (mock data, participant codes), loaded by main.tsx when
// Supabase is not configured. Unchanged apart from living behind a dynamic import.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './state/theme'
import './styles.css'
import './pages.css'
import './shell.css'
import './motion.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
