import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000',
  withCredentials: true,
});

export const signInWithDiscord = () => {
  window.location.href = `${api.defaults.baseURL}/auth/discord`;
};  

export default api;