// Use NGROK URL for LOCALHOST MODE
const NGROK_URL = "https://701dcc86fbd5.ngrok-free.app";

// Enable localhost mode
const useLocalhost = false;

// Backend URL
export const API_BASE = useLocalhost
  ? NGROK_URL
  : "https://bbaacckkend.onrender.com/api";

// Socket URL
export const SOCKET_URL = useLocalhost
  ? NGROK_URL
  : "https://bbaacckkend.onrender.com";
