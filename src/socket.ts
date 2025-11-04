import { io } from "socket.io-client";
import { Alert, Platform } from "react-native";
import { AppState } from 'react-native';

const SOCKET_URL = "https://cmp-back.onrender.com";


// Enhanced socket configuration
const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10, // Increased attempts
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  forceNew: true,
  withCredentials: false,
});

// Add connection status logging
socket.on("connect", () => {
  console.log("🟢 Driver socket connected:", socket.id);
  reconnectAttempts = 0;
  
  // Always emit online status when connected
  if (socket.connected) {
    socket.emit("driverOnline", { 
      timestamp: new Date().toISOString(),
      platform: Platform.OS 
    });
  }
});

socket.on("connect_error", (err) => {
  console.log("🔴 Driver socket connection error:", err.message);
  reconnectAttempts++;
  
  if (reconnectAttempts <= 10) {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  }
});
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;

// Enhanced connection handling
socket.on("connect", () => {
  console.log("🟢 Driver socket connected:", socket.id);
  reconnectAttempts = 0;
  
  // Emit online status to server
  if (socket.connected) {
    socket.emit("driverOnline", { 
      timestamp: new Date().toISOString(),
      platform: Platform.OS 
    });
  }
});

socket.on("connect_error", (err) => {
  console.log("🔴 Driver socket connection error:", err.message);
  reconnectAttempts++;
  
  if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    
    setTimeout(() => {
      if (!socket.connected) {
        socket.connect();
      }
    }, delay);
  }
  
  // More specific error handling
  if (err.message.includes("timeout")) {
    console.log("⏰ Connection timeout - retrying...");
  } else if (err.message.includes("Network Error")) {
    console.log("🌐 Network error - will retry when network available");
  }
});

socket.on("disconnect", (reason) => {
  console.log("🔴 Driver socket disconnected:", reason);
  
  // Auto-reconnect for certain disconnect reasons
  if (reason === "io server disconnect" || reason === "transport close") {
    console.log("🔄 Server initiated disconnect - reconnecting...");
    setTimeout(() => {
      if (!socket.connected) {
        socket.connect();
      }
    }, 2000);
  }
});

socket.on("reconnect", (attemptNumber) => {
  console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
});

socket.on("reconnect_attempt", (attemptNumber) => {
  console.log(`🔄 Reconnection attempt: ${attemptNumber}`);
});

socket.on("reconnect_error", (error) => {
  console.log("🔴 Reconnection error:", error);
});

socket.on("reconnect_failed", () => {
  console.log("🔴 All reconnection attempts failed");
});

// Handle app state changes for socket connection
let appState = AppState.currentState;

AppState.addEventListener('change', (nextAppState) => {
  if (appState.match(/inactive|background/) && nextAppState === 'active') {
    // App came to foreground - ensure socket is connected
    console.log('🔄 App came to foreground - checking socket connection');
    if (!socket.connected) {
      console.log('🔄 Reconnecting socket in foreground');
      socket.connect();
    }
  } else if (nextAppState.match(/inactive|background/)) {
    // App going to background - keep socket alive
    console.log('🔄 App going to background - keeping socket alive');
    // Don't disconnect - let it stay connected
  }
  
  appState = nextAppState;
});

// Export a function to manually reconnect
export const reconnectSocket = () => {
  if (!socket.connected) {
    console.log('🔄 Manually reconnecting socket...');
    socket.connect();
  }
};

// Export a function to check connection status
export const isSocketConnected = () => socket.connected;

// Function to connect socket
export const connectSocket = () => {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

// Function to disconnect socket
export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};

// Function to enable auto reconnect
export const enableAutoReconnect = () => {
  socket.io.reconnection(true);
};

// Function to disable auto reconnect
export const disableAutoReconnect = () => {
  socket.io.reconnection(false);
};

export default socket;