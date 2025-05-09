// Danh sách các IP có thể sử dụng
export const POSSIBLE_IPS = [
  "192.168.1.6", // IP hiện tại của máy
  "192.168.1.5", // IP trước đây đã hoạt động
  "192.168.1.4", // IP thay thế khác có thể
];

// Hàm lấy IP từ localStorage nếu có
export const getStoredIP = () => {
  try {
    const storedIP = localStorage.getItem("API_IP");
    return storedIP && POSSIBLE_IPS.includes(storedIP)
      ? storedIP
      : POSSIBLE_IPS[0];
  } catch (error) {
    console.error("Error getting stored IP:", error);
    return POSSIBLE_IPS[0];
  }
};

// API endpoints
export const API_URL = `http://${getStoredIP()}:3005`;
export const SOCKET_URL = API_URL; // Using same URL for socket connection
export const API_ENDPOINT = `${API_URL}/api`;

// Hàm kiểm tra kết nối API và thay đổi IP nếu cần
export const testAndSetAPIConnection = async () => {
  let currentAPI = API_URL;
  let connected = false;

  try {
    // Thử API hiện tại trước
    console.log(`Testing current API URL: ${currentAPI}`);
    const response = await fetch(`${currentAPI}/api/health`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      console.log(`API connection test successful to ${currentAPI}/api/health`);
      localStorage.setItem("API_IP", getStoredIP());
      connected = true;
      return currentAPI;
    }
  } catch (error) {
    console.log(`API connection test failed for ${currentAPI}:`, error);
  }

  if (!connected) {
    // Thử các IP khác
    for (const ip of POSSIBLE_IPS) {
      const testUrl = `http://${ip}:3005`;
      if (testUrl === currentAPI) continue; // Bỏ qua IP hiện tại

      try {
        console.log(`Trying alternative IP: ${testUrl}`);
        const response = await fetch(`${testUrl}/api/health`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (response.ok) {
          console.log(`Found working API at ${testUrl}`);
          localStorage.setItem("API_IP", ip);

          // Tải lại trang để áp dụng IP mới
          setTimeout(() => {
            window.location.reload();
          }, 1000);

          return testUrl;
        }
      } catch (altError) {
        console.log(`Alternative IP ${testUrl} failed:`, altError);
      }
    }

    console.log("All API connections failed");
    return currentAPI; // Trả về API hiện tại nếu tất cả đều thất bại
  }

  return currentAPI;
};

// Kiểm tra kết nối khi trang được tải
setTimeout(() => {
  testAndSetAPIConnection().then((apiUrl) => {
    console.log(`Using API URL: ${apiUrl}`);
  });
}, 1000);

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
  timeout: 20000, // Tăng timeout để đảm bảo kết nối tốt hơn
  autoConnect: true,
  transports: ["websocket", "polling"],
  // Thay đổi forceNew thành true để bắt buộc tạo kết nối mới
  forceNew: true,
  // Add explicit path for socket to ensure consistent connection
  path: "/socket.io",
};
