import React, { lazy } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { basePath } from './lib/basePath'
import './index.css'
import App from './shell/App'
import Login from './pages/Login'
import Home from './pages/Home'
import ServerConnectionGate from './components/ServerConnectionGate'
import { I18nProvider } from './lib/i18n'

declare global {
  interface Window {
    __nekomimiRoot?: Root
  }
}

const AddWork = lazy(() => import('./pages/AddWork'))
const Circle = lazy(() => import('./pages/Circle'))
const Circles = lazy(() => import('./pages/Circles'))
const Collections = lazy(() => import('./pages/Collections'))
const EditWork = lazy(() => import('./pages/EditWork'))
const Search = lazy(() => import('./pages/Search'))
const Settings = lazy(() => import('./pages/Setting'))
const Work = lazy(() => import('./pages/Work'))

const router = createBrowserRouter([
  { path: '/login', element: <Login/> },
  {
    path: '/',
    element: <App/>,
    children: [
      { index: true, element: <Home/> },
      { path: 'add', element: <AddWork/> },
      { path: 'edit/:id', element: <EditWork/> },
      { path: 'work/:id', element: <Work/> },
      { path: 'circles', element: <Circles/> },
      { path: 'circles/:name', element: <Circle/> },
      { path: 'search', element: <Search/> },
      { path: 'collections', element: <Collections/> },
      { path: 'settings', element: <Settings/> },
    ]
  }
], { basename: basePath || '/' })

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root container element #root not found')
}

const root = window.__nekomimiRoot ?? createRoot(rootElement)
window.__nekomimiRoot = root

root.render(
  <React.StrictMode>
    <I18nProvider>
      <ServerConnectionGate>
        <RouterProvider router={router} />
      </ServerConnectionGate>
    </I18nProvider>
  </React.StrictMode>
)
