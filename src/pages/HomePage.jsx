import Navbar from '../components/layout/Navbar'
import Hero from '../components/home/Hero'
import LawyersSection from '../components/home/LawyersSection'
import CTASection from '../components/home/CTASection'
import MapSection from '../components/home/MapSection'
import ChatSection from '../components/chat/ChatSection'
import Footer from '../components/layout/Footer'
import WhatsAppButton from '../components/home/WhatsAppButton'
import AuthModal from '../components/auth/AuthModal'
import RegisterContadorModal from '../components/auth/RegisterContadorModal'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import VideoCarousel from '../components/home/VideoCarousel'
import ModelosContractualesSection from '../components/home/ModelosContractualesSection'


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
      <VideoCarousel/>
      <ChatSection />
      <CTASection />
      <LawyersSection />
      <ModelosContractualesSection />
      <Hero
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        isSuperAdmin={isSuperAdmin}
      />
      <MapSection />
      <Footer />
      <WhatsAppButton phone="573124086734" />
      {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)} />}
      {contadorOpen && <RegisterContadorModal onClose={() => setContadorOpen(false)} />}
    </>
  )
}
