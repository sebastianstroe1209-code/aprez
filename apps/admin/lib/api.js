const API_BASE_URL = 'http://localhost:4000'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('adminToken')
}

async function handleResponse(response) {
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('adminToken')
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
    throw new Error(msg)
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

// Tier F commit 1 — multipart upload. Tier F endpoints accept a single
// File under the field name passed in (e.g. 'photo', 'menu'). The
// browser sets Content-Type with the boundary automatically — passing
// it manually breaks the boundary parser server-side.
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

// Build a full URL for a relative /uploads path so admin UI <img src> +
// menu <a href> work without thinking about the API host.
export function uploadUrl(relPath) {
  if (!relPath) return null
  if (/^https?:\/\//.test(relPath)) return relPath
  return `${API_BASE_URL}${relPath}`
}
