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
