import Navbar from '../components/layout/Navbar'
import IntroSection from '../components/home/IntroSection'
import Hero from '../components/home/Hero'
import LawyersSection from '../components/home/LawyersSection'
import TestimoniosSection from '../components/home/TestimoniosSection'
import CTASection from '../components/home/CTASection'
import ChatSection from '../components/chat/ChatSection'
import Footer from '../components/layout/Footer'
import WhatsAppButton from '../components/home/WhatsAppButton'
import { useState, useRef, useEffect, lazy, Suspense } from 'react'
import { useScroll, useSpring, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SubNav from '../components/layout/SubNav'

// Modales de registro/login: solo se montan al hacer clic — lazy para que el
// visitante público no descargue ~1.200 líneas de formularios + recaptcha.
const AuthModal = lazy(() => import('../components/auth/AuthModal'))
const RegisterContadorModal = lazy(() => import('../components/auth/RegisterContadorModal'))
const RegisterGestorModal = lazy(() => import('../components/auth/RegisterGestorModal'))

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

// El lazy() solo saca el chunk del entry; al renderizarse incondicionalmente,
// los 453 kB del mapa se descargaban igual en CADA visita aunque casi nadie
// scrollea hasta la penúltima sección. Montamos el import solo cuando la
// sección se acerca al viewport (mismo patrón que LawyersSection).
function DeferredMap() {
  const [show, setShow] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (show) return
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) { setShow(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some(e => e.isIntersecting)) { setShow(true); io.disconnect() } },
      { rootMargin: '450px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [show])
  return (
    <div ref={ref} style={show ? undefined : { minHeight: 420 }} aria-hidden={show ? undefined : 'true'}>
      {show && (
        <Suspense fallback={<div style={{ minHeight: 420 }} aria-hidden="true" />}>
          <MapSection />
        </Suspense>
      )}
    </div>
  )
}


export default function HomePage() {
  const [modal, setModal] = useState(null)
  const [contadorOpen, setContadorOpen] = useState(false)
  const [gestorOpen, setGestorOpen] = useState(false)
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
        onRegisterGestor={() => setGestorOpen(true)}
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
      <DeferredMap />
      <Footer />
      <WhatsAppButton phone="573124086734" />
      <Suspense fallback={null}>
        {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)} />}
        {contadorOpen && <RegisterContadorModal onClose={() => setContadorOpen(false)} />}
        {gestorOpen && <RegisterGestorModal onClose={() => setGestorOpen(false)} />}
      </Suspense>
    </>
  )
}
