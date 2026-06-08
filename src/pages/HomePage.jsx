import Navbar from '../components/layout/Navbar'
import IntroSection from '../components/home/IntroSection'
import Hero from '../components/home/Hero'
import LawyersSection from '../components/home/LawyersSection'
import TestimoniosSection from '../components/home/TestimoniosSection'
import CTASection from '../components/home/CTASection'
import ChatSection from '../components/chat/ChatSection'
import Footer from '../components/layout/Footer'
import WhatsAppButton from '../components/home/WhatsAppButton'
import AuthModal from '../components/auth/AuthModal'
import RegisterContadorModal from '../components/auth/RegisterContadorModal'
import { useState, lazy, Suspense } from 'react'
import { useScroll, useSpring, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SubNav from '../components/layout/SubNav'

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })
  return (
    <motion.div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'var(--gold)',
        scaleX,
        transformOrigin: 'left',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  )
}
import VideoCarousel from '../components/home/VideoCarousel'
import ModelosContractualesSection from '../components/home/ModelosContractualesSection'

// MapSection arrastra d3 + topojson (pesados) y está abajo del fold → se carga
// bajo demanda para no bloquear el render inicial del home.
const MapSection = lazy(() => import('../components/home/MapSection'))


export default function HomePage() {
  const [modal, setModal] = useState(null)
  const [contadorOpen, setContadorOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const { profile } = useAuth()

  const isSuperAdmin = profile?.rol === 'superadmin'

  return (
    <>
      <ScrollProgress />
      <Navbar
        onLogin={() => setModal('login')}
        onRegister={() => setModal('register')}
        onRegisterContador={() => setContadorOpen(true)}
      />
      <SubNav onUnirse={() => setModal('register')} />
      <IntroSection onUnirse={() => setModal('register')} />
      <VideoCarousel/>
      <ChatSection />
      <CTASection />
      <LawyersSection />
      <TestimoniosSection />
      <ModelosContractualesSection />
      <Hero
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        isSuperAdmin={isSuperAdmin}
      />
      <Suspense fallback={<div style={{ minHeight: 420 }} aria-hidden="true" />}>
        <MapSection />
      </Suspense>
      <Footer />
      <WhatsAppButton phone="573124086734" />
      {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)} />}
      {contadorOpen && <RegisterContadorModal onClose={() => setContadorOpen(false)} />}
    </>
  )
}
