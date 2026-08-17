import { useEffect, useRef } from 'react';
import { socket, connectSocket } from '../lib/socket';
import { useNetworkStatus } from '../lib/queue';

export const useSocket = (currentUserKeys: any) => {
  // ── Refs to stabilize callbacks ───────────────────────────────────────
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const connectRef = useRef(false);

  // ── Socket Connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (currentUserKeys && !socket.connected && !connectRef.current) {
      connectRef.current = true;
      connectSocket();
    }
    return () => {
      if (socket.connected) socket.disconnect();
    };
  }, [currentUserKeys]);

  // ── Network Status ─────────────────────────────────────────────────────
  const networkStatus = useNetworkStatus(socket, currentUserKeys?.userId);
  const { isOffline, pendingCount } = networkStatus;

  // ── Event Emit Helpers ─────────────────────────────────────────────────
  const emit = (event: string, data: any) => {
    if (socket.connected) {
      socket.emit(event, data);
    }
  };

  const joinRoom = (room: string, data: any) => {
    if (socket.connected) {
      socket.emit(`user:join`, data);
    }
  };

  return {
    socket,
    isOffline,
    pendingCount,
    networkStatus,
    emit,
    joinRoom,
  };
};