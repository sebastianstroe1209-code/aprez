const API_BASE_URL = 'http://localhost:4000'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('restaurantToken')
}

async function handleResponse(response) {
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('restaurantToken')
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    // Handle all server error formats:
    // { error: 'message' } from route handlers
    // { error: { message: 'message' } } from error middleware
    // { errors: [{ msg: '...' }] } from express-validator
    const msg = (typeof data.error === 'string' ? data.error : data.error?.message)
      || data.message
      || data.errors?.map(e => e.msg).join(', ')
      || `HTTP ${response.status}`
    const err = new Error(msg)
    // Tier I commit 2 fix-the-fix #4 — attach the raw status + parsed
    // payload so callers can read structured error.code fields (e.g.
    // `party-too-large` on assign-table 409 → routes to OverrideModal
    // in live/page.js). Mirrors the admin app's lib/api.js shape
    // (added there in Tier F2 for the same reason). Without this, the
    // catch site on the assign-table click handler fell through to a
    // raw window.alert() with the backend message verbatim — bypassing
    // the localized OverrideConfirmModal entirely.
    err.status = response.status
    err.payload = data
    throw err
  }

  if (response.status === 204) return null
  return response.json()
}

export async function apiGet(path) {
  const token = getToken()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })
  return handleResponse(response)
}

export async function apiPost(path, body) {
  const token = getToken()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })
  return handleResponse(response)
}

export async function apiPut(path, body) {
  const token = getToken()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })
  return handleResponse(response)
}

export async function apiDelete(path) {
  const token = getToken()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })
  return handleResponse(response)
}

// Multipart POST for file uploads (Tier G3 — staff photo/menu upload).
// Mirrors the admin app's apiUpload. No Content-Type header — the browser
// sets the multipart boundary itself.
export async function apiUpload(path, fieldName, file) {
  const token = getToken()
  const form = new FormData()
  form.append(fieldName, file, file.name)
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: form,
  })
  return handleResponse(response)
}

// Resolve a stored `/uploads/...` relative path to an absolute URL the
// browser can load. Absolute URLs pass through unchanged.
export function uploadUrl(relPath) {
  if (!relPath) return null
  if (/^https?:\/\//.test(relPath)) return relPath
  return `${API_BASE_URL}${relPath}`
}
