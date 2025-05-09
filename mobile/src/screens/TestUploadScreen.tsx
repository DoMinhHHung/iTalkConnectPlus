import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Image, 
  ScrollView,
  ActivityIndicator,
  Alert 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config/constants';
import { 
  uploadFile, 
  uploadImage,
  uploadImageToCloudinary 
} from '../services/cloudinaryService';
import * as FileSystem from 'expo-file-system';

const TestUploadScreen = () => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Array<{
    type: string;
    url: string;
    success: boolean;
    method: string;
    error?: string;
  }>>([]);

  // Pick an image from library
  const pickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'You need to grant access to your photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (result.canceled) return;

      const selectedImage = result.assets[0];
      
      await testImageUpload(selectedImage.uri, result.assets[0].base64);
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image from library');
    }
  };

  // Pick a video from library
  const pickVideo = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'You need to grant access to your media library.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 0.7,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });

      if (result.canceled) return;

      const selectedVideo = result.assets[0];
      
      // Get actual file size
      const fileInfo = await FileSystem.getInfoAsync(selectedVideo.uri, { size: true });
      const fileSize = fileInfo.exists ? fileInfo.size || 0 : 0;
      
      Alert.alert(
        'Upload Video',
        `Selected video of size ${Math.round(fileSize/1024/1024)}MB. Upload this file?`,
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Upload',
            onPress: () => {
              testFileUpload(selectedVideo.uri, {
                name: selectedVideo.fileName || 'video.mp4',
                type: 'video/mp4',
                size: fileSize,
              });
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error picking video:', error);
      Alert.alert('Error', 'Failed to pick video from library');
    }
  };

  // Pick a document
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const selectedDocument = result.assets[0];
      await testFileUpload(selectedDocument.uri, {
        name: selectedDocument.name,
        type: selectedDocument.mimeType || 'application/octet-stream',
        size: selectedDocument.size,
      });
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  // Test the uploadImage function
  const testImageUpload = async (uri: string, base64?: string | null) => {
    setLoading(true);
    setProgress(0);
    
    try {
      // Method 1: Test uploadImage
      try {
        const result1 = await uploadImage(uri, 'test_image', (p) => setProgress(p));
        setResults(prev => [...prev, {
          type: 'image',
          url: result1.secure_url,
          success: true,
          method: 'uploadImage',
        }]);
      } catch (error: any) {
        console.error('uploadImage failed:', error);
        setResults(prev => [...prev, {
          type: 'image',
          url: '',
          success: false,
          method: 'uploadImage',
          error: error.message,
        }]);
      }

      // Method 2: Test uploadImageToCloudinary (if base64 is available)
      if (base64) {
        try {
          const result2 = await uploadImageToCloudinary(base64);
          setResults(prev => [...prev, {
            type: 'image',
            url: result2,
            success: true,
            method: 'uploadImageToCloudinary',
          }]);
        } catch (error: any) {
          console.error('uploadImageToCloudinary failed:', error);
          setResults(prev => [...prev, {
            type: 'image',
            url: '',
            success: false,
            method: 'uploadImageToCloudinary',
            error: error.message,
          }]);
        }
      }
    } catch (error: any) {
      Alert.alert('Upload Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Test the uploadFile function
  const testFileUpload = async (uri: string, fileInfo: { name: string, type: string, size: number }) => {
    setLoading(true);
    setProgress(0);
    
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || '';
      
      const result = await uploadFile(uri, fileInfo, token, (p) => setProgress(p));
      
      setResults(prev => [...prev, {
        type: 'file',
        url: result.fileUrl,
        success: true,
        method: 'uploadFile',
      }]);
    } catch (error: any) {
      console.error('uploadFile failed:', error);
      setResults(prev => [...prev, {
        type: 'file',
        url: '',
        success: false,
        method: 'uploadFile',
        error: error.message,
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Clear results
  const clearResults = () => {
    setResults([]);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Upload Test Screen</Text>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={styles.button} 
          onPress={pickImage}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Test Image Upload</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={pickVideo}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Test Video Upload</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={pickDocument}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Test File Upload</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#ff6b6b' }]} 
          onPress={clearResults}
        >
          <Text style={styles.buttonText}>Clear Results</Text>
        </TouchableOpacity>
      </View>
      
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0066ff" />
          <Text style={styles.progressText}>{progress}%</Text>
        </View>
      )}
      
      {results.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>Upload Results:</Text>
          
          {results.map((result, index) => (
            <View key={index} style={styles.resultItem}>
              <Text style={styles.resultText}>
                <Text style={styles.bold}>Type:</Text> {result.type}
              </Text>
              <Text style={styles.resultText}>
                <Text style={styles.bold}>Method:</Text> {result.method}
              </Text>
              <Text style={styles.resultText}>
                <Text style={styles.bold}>Success:</Text>{' '}
                <Text style={{ color: result.success ? 'green' : 'red' }}>
                  {result.success ? 'Yes' : 'No'}
                </Text>
              </Text>
              
              {result.error && (
                <Text style={[styles.resultText, { color: 'red' }]}>
                  <Text style={styles.bold}>Error:</Text> {result.error}
                </Text>
              )}
              
              {result.success && result.url && (
                <>
                  <Text style={styles.resultText}>
                    <Text style={styles.bold}>URL:</Text> {result.url.substring(0, 40)}...
                  </Text>
                  
                  {result.type === 'image' && (
                    <Image
                      source={{ uri: result.url }}
                      style={styles.previewImage}
                      resizeMode="cover"
                    />
                  )}
                </>
              )}
              
              <View style={styles.divider} />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  button: {
    backgroundColor: '#0066ff',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    width: '48%',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  progressText: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  resultsContainer: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  resultItem: {
    marginBottom: 16,
  },
  resultText: {
    fontSize: 14,
    marginBottom: 4,
  },
  bold: {
    fontWeight: 'bold',
  },
  previewImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginTop: 16,
  },
});

export default TestUploadScreen; 