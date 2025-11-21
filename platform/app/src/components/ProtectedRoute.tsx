// src/components/ProtectedRoute.tsx
import React from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '../firebase';
import { Navigate, useLocation } from 'react-router-dom';
import { isDemoRoute } from '../utils/demoRoute';

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const [user, loading] = useAuthState(auth);
  const location = useLocation();
  const demoRouteActive = isDemoRoute(location.pathname, location.search);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user && !demoRouteActive) {
    return <Navigate to="/login" />;
  }

  return children;
};

export default ProtectedRoute;
