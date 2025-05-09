import AsyncStorage from '@react-native-async-storage/async-storage';

// Get the authentication token from AsyncStorage
export const getAuthToken = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem('token');
  } catch (error) {
    console.error('Error retrieving auth token:', error);
    return null;
  }
};

// Get the current user from AsyncStorage
export const getCurrentUser = async (): Promise<any | null> => {
  try {
    const userData = await AsyncStorage.getItem('user');
    if (userData) {
      return JSON.parse(userData);
    }
    return null;
  } catch (error) {
    console.error('Error retrieving current user:', error);
    return null;
  }
};

// Store auth token in AsyncStorage
export const setAuthToken = async (token: string): Promise<boolean> => {
  try {
    await AsyncStorage.setItem('token', token);
    return true;
  } catch (error) {
    console.error('Error storing auth token:', error);
    return false;
  }
};

// Store user data in AsyncStorage
export const setCurrentUser = async (user: any): Promise<boolean> => {
  try {
    await AsyncStorage.setItem('user', JSON.stringify(user));
    return true;
  } catch (error) {
    console.error('Error storing user data:', error);
    return false;
  }
};

// Clear auth data (for logout)
export const clearAuthData = async (): Promise<boolean> => {
  try {
    await AsyncStorage.multiRemove(['token', 'user']);
    return true;
  } catch (error) {
    console.error('Error clearing auth data:', error);
    return false;
  }
}; 