import { useState } from 'react'
import { PASSWORD_RULES, getPasswordStrength, isPasswordValid } from '../lib/validaciones'
import styles from './PasswordField.module.css'

export default function PasswordField({
  value,
  onChange,
  label = 'Contraseña',
  placeholder = 'Mínimo 8 caracteres',
  inputClassName = '',
  required = false,
}) {
  const [visible,  setVisible]  = useState(false)
  const [touched,  setTouched]  = useState(false)

  const strength  = getPasswordStrength(value)
  const rules     = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(value) }))
  const showList  = touched && value.length > 0

  return (
    <div className={styles.wrap}>
      {label && (
        <label className={styles.label}>
          {label} {required && <span className={styles.req}>*</span>}
        </label>
      )}

      {/* Input + toggle visibilidad */}
      <div className={styles.inputWrap}>
        <input
          type={visible ? 'text' : 'password'}
          className={`${styles.input} ${inputClassName} ${
            touched && value
              ? isPasswordValid(value) ? styles.inputValid : styles.inputInvalid
              : ''
          }`}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setTouched(true)}
          placeholder={placeholder}
          autoComplete="new-password"
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setVisible(v => !v)}
          tabIndex={-1}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>

      {/* Barra de fortaleza */}
      {showList && strength && (
        <div className={styles.strengthWrap}>
          <div className={styles.strengthBars}>
            {[1,2,3].map(lvl => (
              <div
                key={lvl}
                className={styles.strengthBar}
                style={{
                  background: strength.level >= lvl ? strength.color : 'rgba(255,255,255,0.1)',
                  transition: 'background 0.3s',
                }}
              />
            ))}
          </div>
          <span className={styles.strengthLabel} style={{ color: strength.color }}>
            {strength.label}
          </span>
        </div>
      )}

      {/* Checklist de requisitos */}
      {showList && (
        <ul className={styles.checklist}>
          {rules.map(rule => (
            <li key={rule.id} className={`${styles.checkItem} ${rule.ok ? styles.checkOk : styles.checkPending}`}>
              <span className={styles.checkIcon}>
                {rule.ok ? '✓' : '○'}
              </span>
              <span className={styles.checkLabel}>{rule.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}