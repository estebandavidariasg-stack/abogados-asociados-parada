import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ProfilePage from './pages/ProfilePage'
import ProfileContadorPage from './pages/ProfileContadorPage'
import AdminPage from './pages/AdminPage'
import ResetPasswordPage from './pages/ResetPasswordPage'



export default function App() {
  return (
    <Routes>
      <Route path="/"                 element={<HomePage />} />
      <Route path="/perfil"           element={<ProfilePage />} />
      <Route path="/perfil-contador"  element={<ProfileContadorPage />} />
      <Route path="/admin"            element={<AdminPage />} />
      <Route path="/nueva-contrasena" element={<ResetPasswordPage />} />
    </Routes>
  )
}
