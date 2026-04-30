import Navbar from '../components/Navbar'
import Hero from '../components/Hero'
import LawyersSection from '../components/LawyersSection'
import CTASection from '../components/CTASection'
import MapSection from '../components/MapSection'
import ChatSection from '../components/ChatSection'
import Footer from '../components/Footer'
import WhatsAppButton from '../components/WhatsAppButton'
import AuthModal from '../components/AuthModal'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import VideoCarousel from '../components/VideoCarousel'


export default function HomePage() {
  const [modal, setModal] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const { profile } = useAuth()

  const isSuperAdmin = profile?.rol === 'superadmin'

  return (
    <>
      <Navbar onLogin={() => setModal('login')} onRegister={() => setModal('register')} />
      <Hero
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        isSuperAdmin={isSuperAdmin}
      />
      <VideoCarousel/>
      <CTASection />
      <ChatSection />
      <LawyersSection />
      <MapSection />
      <Footer />
      <WhatsAppButton phone="573108886571" />
      {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)} />}
    </>
  )
}
