import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/attachments';

interface Friend {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: 'pending' | 'accepted' | 'blocked';
  direction?: 'incoming' | 'outgoing';
}

export const useFriends = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<Friend[]>([]);

  const getToken = () =>
    localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');

  const fetchFriends = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/friends`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
        setFriendRequests(data.requests || []);
      }
    } catch (e) {
      console.error('[Friends] Fetch error:', e);
    }
  }, []);

  const addFriend = useCallback(
    async (username: string) => {
      const token = getToken();
      if (!token) return false;
      try {
        const res = await fetch(`${API_BASE}/api/friends/add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ username }),
        });
        if (res.ok) {
          await fetchFriends();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchFriends],
  );

  const acceptFriend = useCallback(
    async (friendId: string) => {
      const token = getToken();
      if (!token) return false;
      try {
        const res = await fetch(`${API_BASE}/api/friends/accept`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ friendId }),
        });
        if (res.ok) {
          await fetchFriends();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchFriends],
  );

  const rejectFriend = useCallback(
    async (friendId: string) => {
      const token = getToken();
      if (!token) return false;
      try {
        const res = await fetch(`${API_BASE}/api/friends/reject`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ friendId }),
        });
        if (res.ok) {
          await fetchFriends();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchFriends],
  );

  const removeFriend = useCallback(
    async (friendId: string) => {
      const token = getToken();
      if (!token) return false;
      try {
        const res = await fetch(`${API_BASE}/api/friends/remove`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ friendId }),
        });
        if (res.ok) {
          await fetchFriends();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchFriends],
  );

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  return {
    friends,
    friendRequests,
    fetchFriends,
    addFriend,
    acceptFriend,
    rejectFriend,
    removeFriend,
  };
};
