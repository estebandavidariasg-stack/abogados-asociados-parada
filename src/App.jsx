import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/admin/AdminPage'



export default function App() {
  return (
    <Routes>
      <Route path="/"       element={<HomePage />} />
      <Route path="/perfil" element={<ProfilePage />} />
      <Route path="/admin"  element={<AdminPage />} />
    </Routes>
  )
}
