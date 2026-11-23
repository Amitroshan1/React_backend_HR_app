import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "./index.css"
import {App} from './App.jsx'
import { installSessionFetchGuard } from './utils/sessionTimeout'
import { getAccessToken, hydrateAccessTokenFromCookie, installAccessTokenMemory } from './utils/authSession'

installAccessTokenMemory()
installSessionFetchGuard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

if (!getAccessToken() && window.location.pathname !== "/") {
  hydrateAccessTokenFromCookie()
}
