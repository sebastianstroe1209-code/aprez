import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Your laptop's local IP — phone must be on the same WiFi network
const API_BASE = __DEV__
  ? 'http://155.48.155.143:4000/api'
  : 'https://api.aprez.ro/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach token to every request
api.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // SecureStore not available (web)
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('userToken').catch(() => {});
    }
    return Promise.reject(error);
  }
);

export default api;

// Helper to get user-friendly error messages
export function getErrorMessage(error) {
  if (error.response?.data?.error) return error.response.data.error;
  if (error.response?.data?.errors) {
    return error.response.data.errors.map((e) => e.msg || e.message).join(', ');
  }
  if (error.message === 'Network Error') return 'No internet connection';
  return error.message || 'Something went wrong';
}
