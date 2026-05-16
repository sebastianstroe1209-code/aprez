'use client'

// Pending-alert audio chime (C6 P3-2 §3.6).
// Programmatically synthesized via WebAudio so no asset file is needed.
// Two oscillators stacked + a quick gain envelope produce a soft "ping"
// (~300ms, fade in 20ms / fade out 280ms). Frequency 880Hz (A5) primary
// with a 1320Hz overtone at 1/3 amplitude — professional, not jarring.
//
// One AudioContext is reused for the session (Chrome limits ~6 contexts).
// Initial context creation requires a user gesture per browser autoplay
// policy; PendingReservationListener handles the one-time consent prompt
// and creates the context on first click.

const STORAGE_KEY = 'aprez.audio.enabled'
const CONSENT_KEY = 'aprez.audio.consented'

let ctx = null

export function isAudioEnabled() {
  if (typeof window === 'undefined') return true
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === null) return true // default ON per spec
    return v === '1'
  } catch (e) { return true }
}

export function setAudioEnabled(enabled) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0') } catch (e) {}
}

export function hasAudioConsent() {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(CONSENT_KEY) === '1' } catch (e) { return false }
}

export function markAudioConsent() {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(CONSENT_KEY, '1') } catch (e) {}
  // Pre-create the AudioContext while we still have the user-gesture stack
  // available so subsequent automated `playPing()` calls can resume() it.
  ensureCtx()
}

function ensureCtx() {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    return ctx
  } catch (e) {
    return null
  }
}

export function playPing() {
  if (!isAudioEnabled()) return
  const c = ensureCtx()
  if (!c) return
  // If the page lost focus and the context suspended, try to resume.
  if (c.state === 'suspended') c.resume().catch(() => {})
  try {
    const now = c.currentTime
    const gain = c.createGain()
    gain.connect(c.destination)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)

    const fundamental = c.createOscillator()
    fundamental.frequency.value = 880
    fundamental.type = 'sine'
    fundamental.connect(gain)
    fundamental.start(now)
    fundamental.stop(now + 0.32)

    const overtone = c.createOscillator()
    overtone.frequency.value = 1320
    overtone.type = 'sine'
    const overtoneGain = c.createGain()
    overtoneGain.gain.value = 0.33
    overtone.connect(overtoneGain)
    overtoneGain.connect(gain)
    overtone.start(now)
    overtone.stop(now + 0.32)
  } catch (e) {
    // Browser rejected playback (rare in production); silently skip.
  }
}
