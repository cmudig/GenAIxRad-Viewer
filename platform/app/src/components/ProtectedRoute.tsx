// src/components/ProtectedRoute.tsx
import React from 'react';

// Auth temporarily disabled; always render the requested route.
const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  return children;
};

export default ProtectedRoute;
