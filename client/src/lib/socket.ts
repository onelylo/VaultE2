import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  auth: () => ({
    token: localStorage.getItem('vaultchat_jwt'),
  }),
});

/** Re-attach the current JWT whenever the socket reconnects */
socket.on('connect', () => {
  socket.off('connect');
  socket.on('disconnect', () => {
    // Re-bind auth on next connect
    socket.off('connect');
    socket.on('connect', () => {});
  });
});
