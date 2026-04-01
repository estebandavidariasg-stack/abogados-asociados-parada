import Navbar from '../components/Navbar'
import Hero from '../components/Hero'
import LawyersSection from '../components/LawyersSection'
import CTASection from '../components/CTASection'
import Footer from '../components/Footer'
import WhatsAppButton from '../components/WhatsAppButton'
import AuthModal from '../components/AuthModal'
import { useState } from 'react'

export default function HomePage() {
  const [modal, setModal] = useState(null) // null | 'login' | 'register'

  return (
    <>
      <Navbar onLogin={() => setModal('login')} onRegister={() => setModal('register')} />
      <Hero />
      <CTASection />
      <LawyersSection />
      <Footer />
      <WhatsAppButton phone="573001234567" />
      {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)} />}
    </>
  )
}
