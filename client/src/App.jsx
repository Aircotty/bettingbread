import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';

import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      {/* Public landing page (includes pricing section) */}
      <Route path="/" element={<Home />} />

      {/* Protected Routes (now standalone for full-screen immersive design) */}
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute adminOnly>
            <Admin />
          </ProtectedRoute>
        } 
      />


      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}