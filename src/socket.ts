import { io } from "socket.io-client";

const SOCKET_URL = "https://dummy-bac.onrender.com";

const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 2000,
  timeout: 20000,
  forceNew: true,
});

export const connectSocket = () => {
  if (!socket.connected) socket.connect();
  return socket;
};

export default socket;
