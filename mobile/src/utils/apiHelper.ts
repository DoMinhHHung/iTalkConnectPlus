import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  API_URL,
  getAlternativeAPI,
  POSSIBLE_IPS,
  STORAGE_KEYS,
} from "../config/constants";

// Thời gian timeout cho mỗi yêu cầu kiểm tra kết nối (ms)
const CONNECTION_TIMEOUT = 3000;

/**
 * Kiểm tra kết nối đến một API endpoint cụ thể
 * @param baseUrl URL cơ bản của API
 * @returns Promise<boolean> kết quả kiểm tra kết nối
 */
export const testApiConnection = async (baseUrl: string): Promise<boolean> => {
  try {
    // Thử gửi request đến endpoints có khả năng phản hồi nhanh nhất
    const testEndpoints = [
      "/api/health",
      "/api/status",
      "/health",
      "/status",
      "/",
    ];

    for (const endpoint of testEndpoints) {
      try {
        const response = await axios.get(`${baseUrl}${endpoint}`, {
          timeout: CONNECTION_TIMEOUT,
          // Không cần xác thực cho health checks
          validateStatus: (status) => status < 500, // Chấp nhận cả 200-499
        });
        // Nếu bất kỳ endpoint nào phản hồi thành công
        console.log(`API connection test successful to ${baseUrl}${endpoint}`);
        return true;
      } catch (err) {
        console.log(`Failed testing ${baseUrl}${endpoint}: ${err.message}`);
        // Tiếp tục thử endpoint khác
      }
    }

    // Tất cả endpoints đều thất bại
    return false;
  } catch (error) {
    console.error(`API connection test error: ${error.message}`);
    return false;
  }
};

/**
 * Tìm API URL hoạt động từ danh sách và lưu vào AsyncStorage
 * @returns Promise<string|null> URL hoạt động hoặc null nếu không tìm thấy
 */
export const findWorkingApiUrl = async (): Promise<string | null> => {
  // Thử với URL hiện tại trước
  console.log(`Testing current API URL: ${API_URL}`);
  const currentWorks = await testApiConnection(API_URL);

  if (currentWorks) {
    console.log(`Current API URL works: ${API_URL}`);
    await AsyncStorage.setItem(STORAGE_KEYS.API_IP, API_URL);
    return API_URL;
  }

  // Nếu không, thử lần lượt các URL thay thế
  console.log("Current API URL failed, trying alternatives...");

  for (let i = 0; i < POSSIBLE_IPS.length; i++) {
    const alternativeUrl = getAlternativeAPI(i);
    if (!alternativeUrl) break;

    console.log(`Testing alternative API URL: ${alternativeUrl}`);
    const works = await testApiConnection(alternativeUrl);

    if (works) {
      console.log(`Found working API URL: ${alternativeUrl}`);
      await AsyncStorage.setItem(STORAGE_KEYS.API_IP, alternativeUrl);
      return alternativeUrl;
    }
  }

  console.log("No working API URL found");
  return null;
};

/**
 * Lấy API URL hiện tại từ AsyncStorage nếu có, nếu không dùng mặc định
 * @returns Promise<string> API URL hiệu lực
 */
export const getCurrentApiUrl = async (): Promise<string> => {
  try {
    const savedUrl = await AsyncStorage.getItem(STORAGE_KEYS.API_IP);
    return savedUrl || API_URL;
  } catch (error) {
    console.log("Error getting saved API URL, using default");
    return API_URL;
  }
};

/**
 * Tạo axios instance với URL API hiện tại
 * @returns Promise<AxiosInstance> axios instance đã cấu hình
 */
export const getApiInstance = async () => {
  const apiUrl = await getCurrentApiUrl();

  return axios.create({
    baseURL: apiUrl,
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// Dùng khi cần thêm token xác thực
export const getAuthApiInstance = async () => {
  const apiUrl = await getCurrentApiUrl();
  const token = await AsyncStorage.getItem("token");

  return axios.create({
    baseURL: apiUrl,
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    },
  });
};
