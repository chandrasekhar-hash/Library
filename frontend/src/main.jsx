import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/home.css'
import './styles/library.css'
import App from './App.jsx'
import AksErrorBoundary from './components/AksErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AksErrorBoundary>
      <App />
    </AksErrorBoundary>
  </StrictMode>,
)
