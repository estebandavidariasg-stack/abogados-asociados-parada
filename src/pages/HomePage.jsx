import Navbar from '../components/Navbar'
import Hero from '../components/Hero'
import LawyersSection from '../components/LawyersSection'
import CTASection from '../components/CTASection'
import MapSection from '../components/MapSection'
import ChatSection from '../components/ChatSection'
import Footer from '../components/Footer'
import WhatsAppButton from '../components/WhatsAppButton'
import AuthModal from '../components/AuthModal'
import RegisterContadorModal from '../components/RegisterContadorModal'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import VideoCarousel from '../components/VideoCarousel'
import ModelosContractualesSection from '../components/ModelosContractualesSection'


export default function HomePage() {
  const [modal, setModal] = useState(null)
  const [contadorOpen, setContadorOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const { profile } = useAuth()

  const isSuperAdmin = profile?.rol === 'superadmin'

  return (
    <>
      <Navbar
        onLogin={() => setModal('login')}
        onRegister={() => setModal('register')}
        onRegisterContador={() => setContadorOpen(true)}
      />
      <Hero
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        isSuperAdmin={isSuperAdmin}
      />
      <VideoCarousel/>
      <CTASection />
      <ChatSection />
      <LawyersSection />
      <ModelosContractualesSection />
      <MapSection />
      <Footer />
      <WhatsAppButton phone="573108886571" />
      {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)} />}
      {contadorOpen && <RegisterContadorModal onClose={() => setContadorOpen(false)} />}
    </>
  )
}
