import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SharedResultPage from './SharedResultPage.jsx'

const shareMatch = window.location.pathname.match(/^\/result\/([^/]+)\/?$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {shareMatch ? <SharedResultPage token={decodeURIComponent(shareMatch[1])} /> : <App />}
  </StrictMode>,
)
