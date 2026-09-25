// Global styles first: tokens, then the global rules. Every CSS Module is
// imported through App below, so component styles come later in the bundle
// and win ties against global.css, as intended.
import './assets/styles/_variables.css'
import './assets/styles/global.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from './context/ThemeContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
