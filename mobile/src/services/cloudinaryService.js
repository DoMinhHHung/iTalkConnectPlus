import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { getAPIURL } from '../config/constants';

// Fallback URL in case getAPIURL fails
const FALLBACK_API_URL = 'http://192.168.1.3:3005';

export const uploadImage = async (uri, folder = 'chat_image', onProgress) => {
  try {
    // Use a hardcoded string URL
    const apiURL = "http://192.168.1.3:3005";
    console.log(`Uploading image to hardcoded URL: ${apiURL}/api/chat/upload-cloudinary`);
    
    const formData = new FormData();
    formData.append('file', {
      uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
      type: 'image/jpeg',
      name: `image_${Date.now()}.jpg`,
    });
    
    const response = await axios.post(
      apiURL + "/api/chat/upload-cloudinary",
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress && onProgress(progress);
          }
        },
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

export const uploadFile = async (uri, fileInfo, token, onProgress) => {
  try {
    console.log(`Starting file upload with URI: ${uri}`);
    console.log(`File info: ${JSON.stringify(fileInfo)}`);

    // Use a hardcoded string URL directly to avoid any issues with object formatting
    const apiURL = "http://192.168.1.3:3005";
    console.log(`Using hardcoded string URL: ${apiURL}`);

    // Try with first endpoint
    try {
      console.log('Trying primary upload endpoint...');
      
      // Create a direct URL for upload with explicit string concatenation
      const directUploadURL = apiURL + "/api/chat/upload-cloudinary";
      console.log(`Uploading to hardcoded URL: ${directUploadURL}`);
      
      // Create FormData with minimally required fields
      const formData = new FormData();
      
      // Create proper URI for the file
      const fileUri = Platform.OS === 'ios' ? uri.replace('file://', '') : uri;
      
      // Add file to FormData
      formData.append('file', {
        uri: fileUri,
        type: fileInfo.type || 'application/octet-stream',
        name: fileInfo.name || `file_${Date.now()}`,
      });
      
      // Log what we're sending
      console.log('FormData contents:', {
        uri: fileUri,
        type: fileInfo.type || 'application/octet-stream',
        name: fileInfo.name || `file_${Date.now()}`,
      });
      
      try {
        console.log(`Uploading with FormData to: ${directUploadURL}`);
        
        // Make the POST request with a long timeout
        const response = await axios.post(directUploadURL, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          timeout: 60000, // 60 second timeout
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress && onProgress(progress);
            }
          }
        });
        
        console.log('Upload response:', response.data);
        
        // Handle the response
        if (response.data && response.data.file && response.data.file.fileUrl) {
          return {
            fileUrl: response.data.file.fileUrl,
            fileName: response.data.file.fileName || fileInfo.name,
            fileSize: response.data.file.fileSize || fileInfo.size
          };
        } else if (response.data && response.data.fileUrl) {
          return {
            fileUrl: response.data.fileUrl,
            fileName: response.data.fileName || fileInfo.name,
            fileSize: response.data.fileSize || fileInfo.size
          };
        } else if (response.data && response.data.url) {
          return {
            fileUrl: response.data.url,
            fileName: fileInfo.name,
            fileSize: fileInfo.size
          };
        } else {
          console.error('Invalid response format:', response.data);
          throw new Error('Invalid response format from server');
        }
      } catch (formDataError) {
        console.error('FormData upload failed:', formDataError);
        throw formDataError;
      }
    } catch (directError) {
      console.error('Primary upload endpoint failed:', directError);
      
      // Try alternative endpoint as fallback
      try {
        console.log('Trying alternative upload endpoint...');
        const alternativeURL = apiURL + "/api/chat/upload";
        console.log(`Uploading to hardcoded alternative URL: ${alternativeURL}`);
        
        const formData = new FormData();
        formData.append('file', {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          type: fileInfo.type || 'application/octet-stream',
          name: fileInfo.name || `file_${Date.now()}`,
        });
        
        // Add additional parameters for the regular upload endpoint
        formData.append('type', fileInfo.type === 'audio/m4a' ? 'audio' : 'file');
        formData.append('fileSize', fileInfo.size ? fileInfo.size.toString() : '0');
        formData.append('senderId', 'mobile-app');
        
        const response = await axios.post(alternativeURL, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          timeout: 30000
        });
        
        console.log('Alternative upload response:', response.data);
        
        if (response.data && response.data.url) {
          return {
            fileUrl: response.data.url,
            fileName: fileInfo.name,
            fileSize: fileInfo.size
          };
        } else if (response.data && response.data.fileUrl) {
          return {
            fileUrl: response.data.fileUrl,
            fileName: response.data.fileName || fileInfo.name,
            fileSize: response.data.fileSize || fileInfo.size
          };
        } else {
          throw new Error('Invalid response from alternative endpoint');
        }
      } catch (alternativeError) {
        console.error('Alternative upload also failed:', alternativeError);
        throw new Error(`All upload methods failed: ${alternativeError.message}`);
      }
    }
  } catch (error) {
    console.error('Error in cloudinaryService.uploadFile:', error);
    throw error;
  }
}; 