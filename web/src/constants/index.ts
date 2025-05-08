// API endpoints
export const API_URL = "http://192.168.1.6:3005";
export const SOCKET_URL = API_URL; // Using same URL for socket connection
export const API_ENDPOINT = `${API_URL}/api`;

// Auth related constants
export const TOKEN_KEY = "token";
export const USER_KEY = "user";

// Auth action types
export const AUTH_LOADING = "AUTH_LOADING";
export const LOGIN_SUCCESS = "LOGIN_SUCCESS";
export const REGISTER_SUCCESS = "REGISTER_SUCCESS";
export const AUTH_ERROR = "AUTH_ERROR";
export const LOGIN_ERROR = "LOGIN_ERROR";
export const LOGOUT = "LOGOUT";
export const GET_USER_SUCCESS = "GET_USER_SUCCESS";
export const UPDATE_USER_SUCCESS = "UPDATE_USER_SUCCESS";

// Toast notification types
export const TOAST_SUCCESS = "success";
export const TOAST_ERROR = "error";
export const TOAST_INFO = "info";
export const TOAST_WARNING = "warning";

// Socket connection config
export const SOCKET_OPTIONS = {
  reconnection: true,
  reconnectionAttempts: Infinity, // Keep trying to reconnect forever
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  autoConnect: true,
  transports: ["websocket", "polling"],
  // This is important for consistency with the mobile client
  forceNew: false,
  // Add explicit path for socket to ensure consistent connection
  path: "/socket.io",
};
