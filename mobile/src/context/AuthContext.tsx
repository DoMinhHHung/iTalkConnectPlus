import React, { createContext, useState, useEffect } from "react";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../config/constants";
import {
  findWorkingApiUrl,
  getCurrentApiUrl,
  getAuthApiInstance,
  getApiInstance,
} from "../utils/apiHelper";

// Define types for the context
type User = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  profilePicture?: string;
  avt?: string;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  apiConnected: boolean;
  apiBaseUrl: string;
  login: (credentials: {
    emailOrPhone: string;
    password: string;
  }) => Promise<void>;
  register: (userData: any) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => Promise<void>;
  isAuthenticated: boolean;
  retryConnection: () => Promise<boolean>;
};

// Create the context
export const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  apiConnected: false,
  apiBaseUrl: API_URL,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  updateUser: async () => {},
  isAuthenticated: false,
  retryConnection: async () => false,
});

// Create the provider
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(API_URL);

  // Kiểm tra kết nối API và tải dữ liệu người dùng khi khởi động
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);

        // Thử tìm API URL hoạt động
        const workingUrl = await findWorkingApiUrl();
        if (workingUrl) {
          setApiConnected(true);
          setApiBaseUrl(workingUrl);
          console.log(`Using API URL: ${workingUrl}`);

          // Tải dữ liệu người dùng
          await loadStoredAuthData();
        } else {
          setApiConnected(false);
          console.error("Could not connect to any API server");
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Initialization error:", error);
        setApiConnected(false);
        setIsLoading(false);
      }
    };

    initialize();
  }, []);

  // Configure axios with the token
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common["Authorization"];
    }
  }, [token]);

  const loadStoredAuthData = async () => {
    try {
      const storedToken = await AsyncStorage.getItem("token");
      const storedUser = await AsyncStorage.getItem("user");

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch (error) {
      console.error("Error loading stored auth data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Thử kết nối lại với API
  const retryConnection = async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      const workingUrl = await findWorkingApiUrl();

      if (workingUrl) {
        setApiConnected(true);
        setApiBaseUrl(workingUrl);
        await loadStoredAuthData();
        return true;
      } else {
        setApiConnected(false);
        return false;
      }
    } catch (error) {
      console.error("Retry connection error:", error);
      setApiConnected(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Login function
  const login = async (credentials: {
    emailOrPhone: string;
    password: string;
  }) => {
    try {
      setIsLoading(true);

      // Kiểm tra kết nối trước khi đăng nhập
      if (!apiConnected) {
        const connected = await retryConnection();
        if (!connected) {
          throw new Error("No API connection available");
        }
      }

      // Sử dụng API instance từ helper
      const api = await getApiInstance();
      const response = await api.post(`/api/auth/login`, credentials);

      const { user, token } = response.data;

      // Store user and token
      await AsyncStorage.setItem("user", JSON.stringify(user));
      await AsyncStorage.setItem("token", token);

      setUser(user);
      setToken(token);
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Register function
  const register = async (userData: any) => {
    try {
      setIsLoading(true);

      // Kiểm tra kết nối trước khi đăng ký
      if (!apiConnected) {
        const connected = await retryConnection();
        if (!connected) {
          throw new Error("No API connection available");
        }
      }

      // Sử dụng API instance từ helper
      const api = await getApiInstance();

      // Gửi request đăng ký với OTP
      const response = await api.post(`/api/auth/register`, {
        ...userData,
        otp: userData.otp, // Gửi OTP cùng với dữ liệu đăng ký
      });

      const { user, token } = response.data;

      // Store user and token
      await AsyncStorage.setItem("user", JSON.stringify(user));
      await AsyncStorage.setItem("token", token);

      setUser(user);
      setToken(token);
    } catch (error: any) {
      console.error("Registration error:", error.response?.data || error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Logout function
  const logout = async () => {
    try {
      setIsLoading(true);
      await AsyncStorage.removeItem("user");
      await AsyncStorage.removeItem("token");

      // Reset state
      setUser(null);
      setToken(null);
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Update user data
  const updateUser = async (userData: Partial<User>) => {
    try {
      if (!user || !user._id) throw new Error("User not authenticated");

      // Sử dụng API instance từ helper
      const api = await getAuthApiInstance();
      const response = await api.put(`/api/user/update/${user._id}`, userData);

      const updatedUser = response.data.user;

      // Update stored user data
      await AsyncStorage.setItem("user", JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch (error) {
      console.error("Update user error:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        apiConnected,
        apiBaseUrl,
        login,
        register,
        logout,
        updateUser,
        isAuthenticated: !!user && !!token,
        retryConnection,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
