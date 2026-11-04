import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import Login from './pages/Login'
import MyTasksPage from './pages/MyTasksPage'
import ObjectPage from './pages/ObjectPage'
import ObjectsPage from './pages/ObjectsPage'
import TaskPage from './pages/TaskPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/objects" replace />} />
          <Route path="/objects" element={<ObjectsPage />} />
          <Route path="/objects/:id" element={<ObjectPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/my" element={<MyTasksPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/objects" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
