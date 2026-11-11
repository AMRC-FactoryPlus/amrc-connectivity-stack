import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { normalizeServerUrl, useConnectionStore } from './stores/connection'
import { applyServerFromQuery } from './services/serverFromQuery'
import { loadRuntimeConfig } from './config/runtimeConfig'
// ACS: framed by the Manager UI, connect to its i3X service with its session.
import { configureForHost, startHosted } from './acs/host'
import { performConnect } from './services/connection'

async function init() {
  // Runtime config lets operators override defaults without rebuilding. The server
  // URL and recent list apply only on a first visit (a returning user's choice wins);
  // OAuth defaults are read on every launch and never persisted.
  const config = await loadRuntimeConfig()
  const hasExistingState = !!localStorage.getItem('i3x-connection')
  if (!hasExistingState) {
    const store = useConnectionStore.getState()
    if (config.serverUrl) store.setServerUrl(config.serverUrl)
    if (config.recentUrls?.length) {
      useConnectionStore.setState({ recentConnections: config.recentUrls.map(url => ({ url: normalizeServerUrl(url), auth: 'none' as const })) })
    }
  }

  // A `?server=` deep-link overrides both the config.json default and any
  // persisted value, so apply it last (it waits for store hydration itself).
  applyServerFromQuery()
  await configureForHost() // ACS

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )

  startHosted(performConnect) // ACS
}

init()
