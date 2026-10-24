const KEY = 'optimas.fullscreen'

/** 'on' unless the user turned it off. */
export function fullscreenPref(): 'on' | 'off' {
  try {
    return localStorage.getItem(KEY) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

export function setFullscreenPref(v: 'on' | 'off') {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* storage unavailable — preference just won't persist */
  }
}

export function enterFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {})
}

/**
 * Fullscreen is the default till experience: the first tap or keypress puts the
 * app into fullscreen while the preference is 'on'. Browsers only allow this
 * from a user gesture, hence the once-listeners.
 */
export function initAutoFullscreen() {
  if (fullscreenPref() === 'off' || document.fullscreenElement) return
  const once = () => {
    if (fullscreenPref() === 'off' || document.fullscreenElement) return
    enterFullscreen()
  }
  window.addEventListener('pointerdown', once, { once: true })
  window.addEventListener('keydown', once, { once: true })
}

// A manual exit (Esc, F11, browser chrome) records that the user wants it off,
// so the next boot does not force it back on. Re-enabling from the Full screen
// button sets the preference back to 'on'.
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setFullscreenPref('off')
  })
}
