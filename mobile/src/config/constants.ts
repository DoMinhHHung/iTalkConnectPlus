// Đảm bảo import Platform
import { Platform } from "react-native";
import { useState, useEffect } from "react";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

// API URLs
// Các IP phổ biến:
// - 192.168.1.x: IP trong mạng LAN
// - 10.0.2.2: IP đặc biệt cho Android Emulator để kết nối đến localhost của máy
// - localhost: cho thiết bị iOS
// - 127.0.0.1: localhost

// Danh sách các IP phổ biến có thể thử kết nối (theo thứ tự ưu tiên)
export const POSSIBLE_IPS = [
  "192.168.1.6", // IP hiện tại của máy
  // "192.168.1.7", // IP thay thế 1
  // "192.168.1.2", // IP thay thế 2
];

// Hàm lấy IP đã lưu hoặc IP mặc định
const getStoredOrDefaultIp = async () => {
  try {
    // Thử lấy IP đã lưu
    const storedIp = await AsyncStorage.getItem("API_IP");
    if (storedIp) {
      // Kiểm tra nếu IP đã lưu vẫn nằm trong danh sách IP khả dụng
      if (POSSIBLE_IPS.includes(storedIp)) {
        return storedIp;
      }
    }
  } catch (error) {
    console.log("Lỗi khi lấy IP đã lưu:", error);
  }

  // Nếu không có IP đã lưu hoặc IP đã lưu không còn hợp lệ, trả về IP đầu tiên
  return POSSIBLE_IPS[0];
};

// Biến toàn cục để theo dõi IP hiện tại
let currentIpIndex = 0;

const getHostAddress = () => {
  if (Platform.OS === "android") {
    // Cho Android emulator, sử dụng 10.0.2.2 để truy cập localhost của máy host
    if (__DEV__ && Platform.constants.uiMode?.includes("simulator")) {
      return "10.0.2.2";
    }

    // Cho thiết bị Android thật, thử các IP trong mạng LAN
    return POSSIBLE_IPS[currentIpIndex]; // Sử dụng IP theo index hiện tại
  }

  if (Platform.OS === "ios") {
    // Cho iOS simulator
    if (__DEV__) {
      return "localhost";
    }

    // Cho thiết bị iOS thật, thử các IP trong mạng LAN
    return POSSIBLE_IPS[currentIpIndex];
  }

  // Fallback cho web hoặc các nền tảng khác
  return "localhost";
};

// Khởi tạo API URL với IP đầu tiên
export let API_URL = `http://${getHostAddress()}:3005`;
console.log(`Khởi tạo API_URL: ${API_URL}`);

// Hàm để lấy URL thay thế dựa trên index
export const getAlternativeAPI = (index: number): string | null => {
  if (index >= 0 && index < POSSIBLE_IPS.length) {
    return `http://${POSSIBLE_IPS[index]}:3005`;
  }
  return null;
};

// Hàm để kiểm tra kết nối API và thay đổi IP nếu cần
export const testAndSetAPIConnection = async (forceRefresh = false) => {
  // Khởi tạo với IP đã lưu, trừ khi forceRefresh = true
  if (!forceRefresh) {
    const storedIp = await getStoredOrDefaultIp();
    currentIpIndex = POSSIBLE_IPS.indexOf(storedIp);
    if (currentIpIndex === -1) currentIpIndex = 0;
    API_URL = `http://${POSSIBLE_IPS[currentIpIndex]}:3005`;
  }

  console.log(`Testing current API URL: ${API_URL}`);

  // Thử kết nối với API hiện tại
  try {
    const response = await axios.get(`${API_URL}/api/health`, {
      timeout: 3000,
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Expires: "0",
      },
    });

    if (response.status === 200) {
      console.log(`API connection test successful to ${API_URL}/api/health`);
      // Lưu IP thành công vào AsyncStorage
      await AsyncStorage.setItem("API_IP", POSSIBLE_IPS[currentIpIndex]);
      return true;
    }
  } catch (error) {
    console.log(`API connection test failed for ${API_URL}:`, error.message);

    // Thử các IP khác nếu IP hiện tại thất bại
    let found = false;
    for (let i = 0; i < POSSIBLE_IPS.length; i++) {
      if (i === currentIpIndex) continue; // Bỏ qua IP hiện tại

      const testUrl = `http://${POSSIBLE_IPS[i]}:3005`;
      try {
        console.log(`Trying alternative IP: ${testUrl}`);
        const altResponse = await axios.get(`${testUrl}/api/health`, {
          timeout: 3000,
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Expires: "0",
          },
        });

        if (altResponse.status === 200) {
          console.log(`Found working API at ${testUrl}`);
          currentIpIndex = i;
          API_URL = testUrl;
          // Lưu IP thành công vào AsyncStorage
          await AsyncStorage.setItem("API_IP", POSSIBLE_IPS[i]);
          found = true;
          break;
        }
      } catch (altError) {
        console.log(`Alternative IP ${testUrl} failed:`, altError.message);
      }
    }

    if (!found) {
      console.log(
        "All API connections failed, sticking with current URL:",
        API_URL
      );
      return false;
    }
  }

  console.log(`Current API URL works: ${API_URL}`);
  return true;
};

// Khởi chạy kiểm tra kết nối khi import module
testAndSetAPIConnection().then(() => {
  console.log(`Using API URL: ${API_URL}`);
});

// Hàm để lấy API_URL hiện tại hoặc thử lại kết nối
export const getAPIURL = async (forceRefresh = false) => {
  if (forceRefresh) {
    await testAndSetAPIConnection(true);
  }

  // Luôn trả về chuỗi hoàn chỉnh để tránh lỗi [object Object]
  if (!API_URL || typeof API_URL !== "string" || !API_URL.startsWith("http")) {
    // Fallback to hardcoded URL if API_URL is invalid
    console.error("Invalid API_URL detected:", API_URL);
    return `http://${POSSIBLE_IPS[0]}:3005`;
  }

  return API_URL;
};

// Sử dụng Socket URL giống API URL nhưng đảm bảo đó là một chuỗi hợp lệ
export const getSocketURL = () => {
  // Đảm bảo trả về một chuỗi hợp lệ
  if (!API_URL || typeof API_URL !== "string" || !API_URL.startsWith("http")) {
    console.error("Invalid API_URL for socket:", API_URL);
    return `http://${POSSIBLE_IPS[0]}:3005`;
  }
  return API_URL;
};

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
