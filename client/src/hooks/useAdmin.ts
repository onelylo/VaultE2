import { useCallback, useEffect } from 'react';
import { socket } from '../lib/socket';
import type { User, UserKeyPair, UserRole, AdminUser } from '../types/chat';
import { showToast } from '../lib/toast';

const getJwtToken = () => {
  const token = localStorage.getItem('vaultchat_jwt');
  if (token) return token;
  return sessionStorage.getItem('vaultchat_jwt');
};

export const useAdmin = (
  currentUserKeys: UserKeyPair | null,
  setAllUsers: React.Dispatch<React.SetStateAction<User[]>>,
  setCurrentUserKeys: React.Dispatch<React.SetStateAction<UserKeyPair | null>>
) => {
  const fetchAdminUsers = useCallback(async (): Promise<AdminUser[]> => {
    const token = getJwtToken();
    if (!token) return [];
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.users || []) as AdminUser[];
    } catch (e) {
      console.error('[Admin] Fetch error:', e);
      return [];
    }
  }, []);

  const handleSetRole = useCallback(async (userId: string, role: UserRole): Promise<boolean> => {
    const token = getJwtToken();
    if (!token) return false;
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Role change failed', 'error');
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Admin] Role change error:', e);
      return false;
    }
  }, []);

  const handleDeleteUser = useCallback(async (userId: string): Promise<boolean> => {
    const token = getJwtToken();
    if (!token) return false;
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'User deletion failed', 'error');
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Admin] User deletion error:', e);
      return false;
    }
  }, []);

  // Socket handlers for admin-triggered events
  useEffect(() => {
    const onUserRemoved = (data: { userId: string }) => {
      setAllUsers((prev: User[]) => prev.map(u => u.userId === data.userId ? { ...u, isOnline: false, statusMessage: '[deleted]' } : u));
    };

    const onUserRoleChange = (data: { userId: string; role: UserRole }) => {
      setAllUsers((prev: User[]) => prev.map(u => u.userId === data.userId ? { ...u, role: data.role } : u));
      if (data.userId === currentUserKeys?.userId) {
        setCurrentUserKeys(prev => prev ? { ...prev, role: data.role } : prev);
      }
    };

    const onUserSuspended = () => {
      socket.disconnect();
      localStorage.removeItem('vaultchat_jwt');
      sessionStorage.removeItem('vaultchat_jwt');
      setCurrentUserKeys(null);
      showToast('Your account has been suspended', 'error');
      window.location.reload();
    };

    socket.on('user:removed', onUserRemoved);
    socket.on('user:role_change', onUserRoleChange);
    socket.on('user:suspended', onUserSuspended);

    return () => {
      socket.off('user:removed', onUserRemoved);
      socket.off('user:role_change', onUserRoleChange);
      socket.off('user:suspended', onUserSuspended);
    };
  }, [currentUserKeys, setAllUsers, setCurrentUserKeys]);

  return {
    fetchAdminUsers,
    handleSetRole,
    handleDeleteUser,
  };
};