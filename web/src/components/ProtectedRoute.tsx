import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../api/types';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles: UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { state, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !state) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const { role } = state.user;
  if (allowedRoles.includes(role) || role === 'admin') {
    return <>{children}</>;
  }

  return <Navigate to="/login" replace />;
}
