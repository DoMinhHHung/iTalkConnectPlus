// Đảm bảo import Platform
import { Platform } from "react-native";
import { useState, useEffect } from "react";
import axios from "axios";

// API URLs
// Các IP phổ biến:
// - 192.168.1.x: IP trong mạng LAN
// - 10.0.2.2: IP đặc biệt cho Android Emulator để kết nối đến localhost của máy
// - localhost: cho thiết bị iOS
// - 127.0.0.1: localhost

// Danh sách các IP phổ biến có thể thử kết nối (theo thứ tự ưu tiên)
export const POSSIBLE_IPS = [
  "192.168.1.6", // ip v4 hien tai cua may
];

const getHostAddress = () => {
  if (Platform.OS === "android") {
    // Cho Android emulator, sử dụng 10.0.2.2 để truy cập localhost của máy host
    if (__DEV__ && Platform.constants.uiMode?.includes("simulator")) {
      return "10.0.2.2";
    }

    return POSSIBLE_IPS[0];
  }

  if (Platform.OS === "ios") {
    // Cho iOS simulator
    if (__DEV__) {
      return "localhost";
    }

    // Cho thiết bị iOS thật, thử các IP trong mạng LAN
    return POSSIBLE_IPS[0];
  }

  return "localhost";
};

// Khởi tạo API URL
export const API_URL = `http://${getHostAddress()}:3005`;
console.log(`Khởi tạo API_URL: ${API_URL}`);

// Để client có thể chuyển đổi giữa các IP khác nhau nếu kết nối thất bại
export const getAlternativeAPI = (index: number = 0) => {
  if (index >= POSSIBLE_IPS.length) {
    return null; // Đã thử tất cả các IP khả dụng
  }
  const alternativeIP = POSSIBLE_IPS[index];
  return `http://${alternativeIP}:3005`;
};

// Sử dụng Socket URL giống API URL
export const SOCKET_URL = API_URL;

// App constants
export const APP_NAME = "iTalk+";
export const APP_VERSION = "1.0.0";

// Storage keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: "auth_token",
  USER: "user",
  THEME: "app_theme",
  LANGUAGE: "app_language",
  API_IP: "api_ip", // Thêm khóa lưu IP đang sử dụng
};

// Default avatar
export const DEFAULT_AVATAR = "https://ui-avatars.com/api/?background=random";

// Cloudinary configuration
export const CLOUDINARY_CONFIG = {
  CLOUD_NAME: "dj5a0wx2n",
  API_KEY: "731712143896246",
  API_SECRET: "BPwn4ELB3UL0W4obHwW3Vjeoo1M",
  UPLOAD_PRESET: "italk_app_preset",
  FOLDER: "italk_app",
};
//BPwn4ELB3UL0W4obHwW3Vjeoo1M api secret key
