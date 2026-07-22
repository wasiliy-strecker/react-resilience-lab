import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'

import { App } from './app/app.js'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The root element is missing')
}

const router = createBrowserRouter([
  {
    path: '*',
    element: <App />,
  },
])

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
