import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { ClientDashboard } from './pages/ClientDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { User, UserRole } from './types';
import { supabase, getCurrentUserProfile, signOut } from './services/storageService';
import { Loader2 } from 'lucide-react';
import { ToastProvider } from './components/Toast';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [initLoading, setInitLoading] = useState(true);

  // Initialize Auth Listener
  useEffect(() => {
    const initAuth = async () => {
      const user = await getCurrentUserProfile();
      if (user) {
        setCurrentUser(user);
      }
      setInitLoading(false);
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const user = await getCurrentUserProfile();
        setCurrentUser(user);
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
  };

  const handleLogout = async () => {
    await signOut();
    setCurrentUser(null);
  };

  // Fix: Memoize refreshUser to prevent infinite loops in child components
  const refreshUser = useCallback(async () => {
    // We only fetch if we think we are logged in, or to check status.
    const latestUser = await getCurrentUserProfile();
    
    setCurrentUser(prevUser => {
      // If we are logged out and found no user, stay logged out
      if (!prevUser && !latestUser) return null;
      
      // If we were logged out but found a user, log in
      if (!prevUser && latestUser) return latestUser;
      
      // If we were logged in but found no user (unlikely given auth listener), log out
      if (prevUser && !latestUser) return null;

      // If both exist, compare key fields to avoid unnecessary re-renders
      if (prevUser && latestUser) {
        if (
          prevUser.balance !== latestUser.balance ||
          prevUser.role !== latestUser.role ||
          prevUser.username !== latestUser.username ||
          prevUser.phone !== latestUser.phone
        ) {
          return latestUser;
        }
        // Return previous reference if data is effectively the same
        return prevUser;
      }
      return prevUser;
    });
  }, []);

  if (initLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-brand-600">
        <Loader2 className="animate-spin w-10 h-10" />
      </div>
    );
  }

  // Check if user is Admin OR Super Admin
  const isAdminOrSuper = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.SUPER_ADMIN;

  return (
    <ToastProvider>
      <Layout currentUser={currentUser} onLogout={handleLogout}>
        {!currentUser ? (
          <Login onLogin={handleLogin} />
        ) : (
          <>
            {isAdminOrSuper ? (
              <AdminDashboard currentUser={currentUser} />
            ) : (
              <ClientDashboard currentUser={currentUser} refreshUser={refreshUser} />
            )}
          </>
        )}
      </Layout>
    </ToastProvider>
  );
};

export default App;