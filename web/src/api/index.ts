"use client";

import axios from "axios";
import { API_ENDPOINT, testAndSetAPIConnection, getStoredIP, POSSIBLE_IPS } from "../constants";

// Hàm lấy API URL hiện tại hoặc thử với các URL thay thế
export const getApiUrl = async () => {
  try {
    const url = await testAndSetAPIConnection();
    return `${url}/api`;
  } catch (error) {
    console.error("Error getting API URL:", error);
    return `http://${getStoredIP()}:3005/api`;
  }
};

// Khởi tạo với URL mặc định, sẽ được cập nhật sau
let API_URL = API_ENDPOINT;
console.log("API URL được khởi tạo là:", API_URL);

// Thử kết nối và cập nhật API URL nếu cần
getApiUrl().then(url => {
  API_URL = url;
  console.log("API URL sau khi kiểm tra kết nối:", API_URL);
  // Cập nhật baseURL cho axios instance
  api.defaults.baseURL = API_URL;
});

// Function to try different API endpoints
export const tryAlternativeEndpoints = async (apiCall: () => Promise<any>) => {
  try {
    return await apiCall();
  } catch (error) {
    console.log("API call failed, trying alternative endpoints");
    
    // Try each alternative IP
    for (const ip of POSSIBLE_IPS) {
      if (`http://${ip}:3005/api` === API_URL) continue; // Skip current URL
      
      try {
        console.log(`Trying with alternative IP: ${ip}`);
        const tempUrl = `http://${ip}:3005/api`;
        
        // Temporarily change the baseURL
        const originalUrl = api.defaults.baseURL;
        api.defaults.baseURL = tempUrl;
        
        const result = await apiCall();
        
        // If successful, update the stored IP and API_URL
        localStorage.setItem('API_IP', ip);
        API_URL = tempUrl;
        console.log(`API call successful with ${tempUrl}, updating default endpoint`);
        
        return result;
      } catch (altError) {
        console.log(`Alternative IP ${ip} also failed`);
        // Restore original baseURL before trying next IP
        api.defaults.baseURL = API_URL;
      }
    }
    
    // If all alternatives fail, throw the original error
    throw error;
  }
};

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add request interceptor
api.interceptors.request.use(
  (config) => {
    // Hiển thị chi tiết hơn nếu là request đăng nhập
    if (config.url?.includes("/login")) {
      console.log("Đang gửi request đăng nhập:");
      console.log("URL:", `${config.baseURL}${config.url}`);
      console.log("Method:", config.method?.toUpperCase());
      console.log("Data:", config.data);
    } else {
      console.log(
        `Đang gửi request đến: ${config.method?.toUpperCase()} ${
          config.baseURL
        }${config.url}`
      );
    }

    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log("Token được thêm vào header");
      } else {
        console.log("Không có token trong localStorage");
      }
    }
    return config;
  },
  (error) => {
    console.error("Lỗi request interceptor:", error);
    return Promise.reject(error);
  }
);

// Add response interceptor
api.interceptors.response.use(
  (response) => {
    // Hiển thị chi tiết hơn nếu là response từ đăng nhập
    if (response.config.url?.includes("/login")) {
      console.log("Đăng nhập thành công:");
      console.log("Status:", response.status);
      console.log("Response data:", response.data);
    } else {
      console.log(`Nhận phản hồi thành công từ: ${response.config.url}`);
    }
    return response;
  },
  (error) => {
    // Hiển thị chi tiết lỗi nếu liên quan đến đăng nhập
    if (error.config?.url?.includes("/login")) {
      console.error("=== LỖI ĐĂNG NHẬP ===");
      console.error("Status:", error.response?.status);
      console.error("Message:", error.message);
      console.error("Response data:", error.response?.data);
      console.error("Request data:", error.config?.data);
      console.error("URL:", error.config?.url);
    } else {
      console.error("Lỗi response:", error.message);
      console.error("Response status:", error.response?.status);
      console.error("Response data:", error.response?.data);
    }

    if (
      typeof window !== "undefined" &&
      error.response &&
      error.response.status === 401 &&
      !error.config.url.includes("/login")
    ) {
      console.log("Lỗi 401 - Token hết hạn hoặc không hợp lệ");
      localStorage.removeItem("token");
    }
    return Promise.reject(error);
  }
);

export default api;
