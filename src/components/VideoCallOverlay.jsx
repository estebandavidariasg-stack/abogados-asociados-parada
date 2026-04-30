import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import styles from './VideoCallOverlay.module.css'
import { IconMic, IconMicOff, IconCamera, IconCameraOff, IconPhoneOff, IconPhone } from './Icons'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
}

export default function VideoCallOverlay({ roomId, isCaller, myName, remoteName, onEnd }) {
  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)
  const pcRef          = useRef(null)
  const localStreamRef = useRef(null)
  const channelRef     = useRef(null)
  const pendingRef     = useRef([])
  const cleanedUpRef   = useRef(false)
  const setupDoneRef   = useRef(false)   // evita doble setup

  // ── CLAVE: streams en estado → dispara useEffect cuando están listos ──
  const [localStream,  setLocalStream]  = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)

  const [status,    setStatus]    = useState(isCaller ? 'calling' : 'incoming')
  const [micOn,     setMicOn]     = useState(true)
  const [camOn,     setCamOn]     = useState(true)
  const [duration,  setDuration]  = useState(0)
  const [permError, setPermError] = useState(null)

  // ── Asignar stream local al <video> cuando el ref Y el stream estén listos ──
  useEffect(() => {
    const el = localVideoRef.current
    if (!localStream || !el) return
    if (el.srcObject === localStream) return   // ya asignado
    el.srcObject = localStream
    el.play().catch(() => {})
  }, [localStream])

  // ── Asignar stream remoto al <video> ──
  useEffect(() => {
    const el = remoteVideoRef.current
    if (!remoteStream || !el) return
    if (el.srcObject === remoteStream) return
    el.srcObject = remoteStream
    el.play().catch(() => {})
  }, [remoteStream])

  // ── Timer de duración ──
  useEffect(() => {
    if (status !== 'connected') return
    const t = setInterval(() => setDuration(d => d + 1), 1000)
    return () => clearInterval(t)
  }, [status])

  // ── Init en mount ──
  useEffect(() => {
    initSignaling()
    if (isCaller) setupMedia()
    return () => cleanup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function fmt(s) {
    return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`
  }

  // ── Setup cámara + micrófono ──────────────────────────────────────────────
  async function setupMedia() {
    if (setupDoneRef.current) return pcRef.current  // evitar doble llamada
    setupDoneRef.current = true
    try {
      setPermError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      setLocalStream(stream)   // ← dispara el useEffect que asigna al <video>

      const pc = new RTCPeerConnection(ICE_SERVERS)
      pcRef.current = pc
      stream.getTracks().forEach(track => pc.addTrack(track, stream))

      pc.ontrack = (e) => {
        const [rs] = e.streams
        if (rs) setRemoteStream(rs)  // ← dispara el useEffect remoto
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channelRef.current?.send({
            type: 'broadcast', event: 'ice_candidate',
            payload: { candidate: e.candidate.toJSON() },
          })
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected')    setStatus('connected')
        if (pc.connectionState === 'failed') {
          setStatus('failed')
          setTimeout(safeEnd, 2500)
        }
        if (pc.connectionState === 'disconnected') {
          setTimeout(() => {
            if (pc.connectionState === 'disconnected') {
              setStatus('ended')
              setTimeout(safeEnd, 1500)
            }
          }, 3000)
        }
      }

      return pc
    } catch (err) {
      setupDoneRef.current = false   // permitir reintento si falló
      const msg = err.name === 'NotAllowedError'
        ? 'Permiso de cámara/micrófono denegado. Revisa los permisos del navegador.'
        : `No se pudo acceder al dispositivo: ${err.message}`
      setPermError(msg)
      setStatus('error')
      return null
    }
  }

  // ── Canal de señalización ─────────────────────────────────────────────────
  async function initSignaling() {
    channelRef.current = supabase
      .channel(`call:${roomId}`)

      // Caller recibe aceptación → crea oferta
      .on('broadcast', { event: 'call_accepted' }, async () => {
        if (!isCaller || !pcRef.current) return
        await createOffer()
      })

      // Callee recibe oferta
      .on('broadcast', { event: 'call_offer' }, async ({ payload }) => {
        if (isCaller || !payload?.sdp) return
        setStatus('connecting')
        // setupMedia ya fue llamado en acceptCall — solo esperamos a que termine
        let attempts = 0
        while (!pcRef.current && attempts < 20) {
          await new Promise(r => setTimeout(r, 150))
          attempts++
        }
        if (!pcRef.current) return
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        for (const c of pendingRef.current) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)) } catch (_) {}
        }
        pendingRef.current = []
        const answer = await pcRef.current.createAnswer()
        await pcRef.current.setLocalDescription(answer)
        channelRef.current?.send({ type:'broadcast', event:'call_answer', payload:{ sdp: answer } })
        setStatus('connected')
      })

      // Caller recibe respuesta
      .on('broadcast', { event: 'call_answer' }, async ({ payload }) => {
        if (!isCaller || !pcRef.current || !payload?.sdp) return
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        setStatus('connected')
      })

      // ICE candidates
      .on('broadcast', { event: 'ice_candidate' }, async ({ payload }) => {
        if (!payload?.candidate) return
        if (!pcRef.current?.remoteDescription) {
          pendingRef.current.push(payload.candidate); return
        }
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)) } catch (_) {}
      })

      // Fin / rechazo
      .on('broadcast', { event: 'call_end' }, () => {
        setStatus('ended'); cleanup(); setTimeout(safeEnd, 1500)
      })
      .on('broadcast', { event: 'call_reject' }, () => {
        setStatus('rejected'); cleanup(); setTimeout(safeEnd, 2000)
      })

      .subscribe()
  }

  async function createOffer() {
    try {
      const offer = await pcRef.current.createOffer()
      await pcRef.current.setLocalDescription(offer)
      channelRef.current?.send({ type:'broadcast', event:'call_offer', payload:{ sdp: offer } })
      setStatus('connecting')
    } catch (_) {}
  }

  async function acceptCall() {
    setStatus('connecting')
    channelRef.current?.send({ type:'broadcast', event:'call_accepted', payload:{} })
    await setupMedia()   // setupDoneRef evita doble llamada
  }

  function rejectCall() {
    channelRef.current?.send({ type:'broadcast', event:'call_reject', payload:{} })
    cleanup(); onEnd()
  }

  function endCall() {
    channelRef.current?.send({ type:'broadcast', event:'call_end', payload:{} })
    setStatus('ended'); cleanup(); setTimeout(safeEnd, 600)
  }

  const cleanup = useCallback(() => {
    if (cleanedUpRef.current) return
    cleanedUpRef.current = true
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    // Limpiar srcObject para que el navegador libere la cámara
    if (localVideoRef.current)  localVideoRef.current.srcObject  = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    try { pcRef.current?.close() } catch (_) {}
    pcRef.current = null
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
  }, [])

  function safeEnd() { cleanup(); onEnd() }

  function toggleMic() {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setMicOn(m => !m)
  }
  function toggleCam() {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setCamOn(c => !c)
  }

  const isActive = ['calling', 'connecting', 'connected'].includes(status)

  const statusLabel = {
    calling:    'Llamando…',
    incoming:   'Llamada entrante',
    connecting: 'Conectando…',
    connected:  fmt(duration),
    ended:      'Llamada finalizada',
    rejected:   'Llamada rechazada',
    failed:     'Error de conexión',
    error:      'Sin acceso a cámara/micrófono',
  }[status] || status

  return (
    <div className={styles.overlay}>
      <div className={styles.callBox}>

        {/* Status bar */}
        <div className={styles.statusBar}>
          <div className={styles.callerInfo}>
            <div className={`${styles.statusDot} ${
              status === 'connected' ? styles.dotGreen :
              status === 'error' || status === 'failed' ? styles.dotRed :
              styles.dotYellow
            }`} />
            <span className={styles.remoteName}>{remoteName || 'Usuario'}</span>
          </div>
          <span className={styles.statusText}>{statusLabel}</span>
          {isActive && (
            <button className={styles.btnEndTop} onClick={endCall} title="Finalizar llamada">
              <IconPhoneOff size={14} />
            </button>
          )}
        </div>

        {/* Video area */}
        <div className={styles.videoArea}>

          {/* Video remoto — pantalla completa */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={styles.remoteVideo}
          />

          {/* Avatar placeholder mientras no hay conexión */}
          {status !== 'connected' && (
            <div className={styles.avatarWrap}>
              <div className={styles.avatarRing}>
                <div className={`${styles.avatarCircle} ${
                  status === 'calling' || status === 'incoming' ? styles.avatarPulse : ''
                }`}>
                  {(remoteName?.[0] || '?').toUpperCase()}
                </div>
              </div>
              <p className={styles.avatarName}>{remoteName || 'Usuario'}</p>
              <p className={styles.avatarStatus}>{statusLabel}</p>
            </div>
          )}

          {/* Video local — PIP esquina inferior derecha */}
          <div className={styles.localVideoWrap}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={styles.localVideo}
            />
            {!camOn && (
              <div className={styles.localCamOff}>
                <IconCameraOff size={18} />
              </div>
            )}
          </div>

          {/* Error de permisos */}
          {permError && (
            <div className={styles.permError}>
              <span>⚠️ {permError}</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className={styles.controls}>
          {status === 'incoming' && (
            <>
              <button className={styles.btnAccept} onClick={acceptCall}>
                <IconPhone size={18} /><span>Aceptar</span>
              </button>
              <button className={styles.btnReject} onClick={rejectCall}>
                <IconPhoneOff size={18} /><span>Rechazar</span>
              </button>
            </>
          )}

          {isActive && (
            <>
              <button className={micOn ? styles.ctrlBtn : styles.ctrlBtnOff}
                onClick={toggleMic} title={micOn ? 'Silenciar' : 'Activar micrófono'}>
                {micOn ? <IconMic size={18}/> : <IconMicOff size={18}/>}
              </button>
              <button className={styles.btnEnd} onClick={endCall} title="Finalizar llamada">
                <IconPhoneOff size={20}/>
              </button>
              <button className={camOn ? styles.ctrlBtn : styles.ctrlBtnOff}
                onClick={toggleCam} title={camOn ? 'Desactivar cámara' : 'Activar cámara'}>
                {camOn ? <IconCamera size={18}/> : <IconCameraOff size={18}/>}
              </button>
            </>
          )}

          {['ended','rejected','failed','error'].includes(status) && (
            <button className={styles.btnClose} onClick={safeEnd}>Cerrar</button>
          )}
        </div>

      </div>
    </div>
  )
}