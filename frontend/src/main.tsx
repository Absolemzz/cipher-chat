import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'  // Add this line

const root = createRoot(document.getElementById('root')!)
root.render(<App />)