import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  SafeAreaView,
  Alert
} from 'react-native';
import { pickOptimizedVideo, uploadVideoWithConfirmation } from '../utils/videoUploader';
import { Video } from 'expo-av';
import * as FileSystem from 'expo-file-system';

const VideoTestScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState(null);
  const [videoSize, setVideoSize] = useState(null);
  const [error, setError] = useState(null);

  // Chọn video với các tùy chọn tối ưu
  const handlePickVideo = async () => {
    try {
      const result = await pickOptimizedVideo();
      if (!result) return;

      // Hiển thị thông tin video đã chọn
      const fileInfo = await FileSystem.getInfoAsync(result.uri, { size: true });
      const fileSizeMB = fileInfo.size / (1024 * 1024);
      
      setSelectedVideo(result.uri);
      setVideoSize(`${fileSizeMB.toFixed(2)} MB`);
      setUploadedVideoUrl(null);
      setError(null);
    } catch (error) {
      console.error('Lỗi khi chọn video:', error);
      setError(`Lỗi khi chọn video: ${error.message}`);
    }
  };

  // Tải video lên với phương pháp cải tiến
  const handleUploadVideo = async () => {
    if (!selectedVideo) {
      Alert.alert('Lưu ý', 'Vui lòng chọn video trước khi tải lên');
      return;
    }

    try {
      setLoading(true);
      setProgress(0);
      setError(null);

      // Sử dụng hàm upload cải tiến với xác nhận cho video lớn
      const result = await uploadVideoWithConfirmation(
        selectedVideo,
        (progress) => setProgress(progress)
      );

      if (result) {
        console.log('Video đã được tải lên:', result);
        setUploadedVideoUrl(result.fileUrl);
        Alert.alert('Thành công', 'Video đã được tải lên thành công!');
      } else {
        // Người dùng đã hủy
        console.log('Tải lên video đã bị hủy bởi người dùng');
      }
    } catch (error) {
      console.error('Lỗi khi tải video lên:', error);
      setError(`Lỗi khi tải lên: ${error.message}`);
      Alert.alert('Lỗi', `Không thể tải lên video: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Kiểm tra Tải lên Video</Text>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={styles.button} 
            onPress={handlePickVideo}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Chọn Video</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, loading && styles.disabledButton]}
            onPress={handleUploadVideo}
            disabled={!selectedVideo || loading}
          >
            <Text style={styles.buttonText}>Tải lên Video</Text>
          </TouchableOpacity>
        </View>

        {selectedVideo && (
          <View style={styles.videoContainer}>
            <Text style={styles.sectionTitle}>Video đã chọn:</Text>
            <Video
              source={{ uri: selectedVideo }}
              style={styles.video}
              useNativeControls
              resizeMode="contain"
            />
            {videoSize && (
              <Text style={styles.infoText}>Kích thước: {videoSize}</Text>
            )}
          </View>
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0066FF" />
            <Text style={styles.progressText}>{progress}%</Text>
            <Text style={styles.infoText}>Đang tải lên, vui lòng đợi...</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {uploadedVideoUrl && !loading && (
          <View style={styles.resultContainer}>
            <Text style={styles.sectionTitle}>Video đã tải lên:</Text>
            <Video
              source={{ uri: uploadedVideoUrl }}
              style={styles.video}
              useNativeControls
              resizeMode="contain"
            />
            <Text style={styles.successText}>Tải lên thành công!</Text>
            <Text style={styles.urlText} numberOfLines={2} ellipsizeMode="middle">
              {uploadedVideoUrl}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContainer: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 24,
    color: '#333',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#0066FF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    width: '48%',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  disabledButton: {
    backgroundColor: '#B3B3B3',
  },
  videoContainer: {
    marginBottom: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  video: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#e1e1e1',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 20,
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  progressText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginVertical: 8,
    color: '#0066FF',
  },
  errorContainer: {
    padding: 16,
    backgroundColor: '#ffefef',
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ffcaca',
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 14,
  },
  resultContainer: {
    marginTop: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  successText: {
    color: '#4CAF50',
    fontWeight: 'bold',
    fontSize: 16,
    marginVertical: 8,
  },
  urlText: {
    color: '#666',
    fontSize: 12,
  },
});

export default VideoTestScreen; 