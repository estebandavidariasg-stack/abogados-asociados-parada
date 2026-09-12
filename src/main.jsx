import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <App />
      </AuthProvider>
      <Analytics />
    </MotionConfig>
  </BrowserRouter>
)