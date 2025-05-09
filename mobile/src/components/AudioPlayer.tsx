import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Audio } from "expo-av";
import { Ionicons, FontAwesome } from "@expo/vector-icons";

interface AudioPlayerProps {
  audioUri: string;
  small?: boolean;
  autoPlay?: boolean;
}

const AudioPlayer = ({ audioUri, small = false, autoPlay = false }: AudioPlayerProps) => {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let soundObject: Audio.Sound | null = null;
    
    const loadSound = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        console.log(`Loading audio from: ${audioUri}`);
        
        // Unload any previous sound
        if (sound) {
          await sound.unloadAsync();
        }
        
        // Create a new sound object
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: autoPlay },
          onPlaybackStatusUpdate
        );
        
        soundObject = newSound;
        
        if (isMounted) {
          setSound(newSound);
          setIsLoading(false);
          
          if (autoPlay) {
            setIsPlaying(true);
          }
        }
      } catch (error) {
        console.error('Error loading audio:', error);
        if (isMounted) {
          setIsLoading(false);
          setError('Không thể tải file audio');
        }
      }
    };
    
    loadSound();
    
    // Clean up function
    return () => {
      isMounted = false;
      if (soundObject) {
        soundObject.unloadAsync();
      }
    };
  }, [audioUri]);
  
  // Update status when sound is playing
  const onPlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDuration(status.durationMillis);
      setIsPlaying(status.isPlaying);
      
      // Auto stop at end
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
        sound?.setPositionAsync(0);
      }
    }
  };
  
  // Toggle play/pause
  const togglePlayPause = async () => {
    if (!sound) return;
    
    try {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        // If finished, restart
        if (position >= (duration || 0)) {
          await sound.setPositionAsync(0);
        }
        await sound.playAsync();
      }
    } catch (error) {
      console.error('Error toggling play/pause:', error);
      setError('Lỗi phát audio');
    }
  };
  
  // Format time (mm:ss)
  const formatTime = (millis: number | null) => {
    if (!millis) return '00:00';
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };
  
  // Calculate progress percentage
  const progress = duration ? (position / duration) * 100 : 0;
  
  // Determine time to display (current position for playing, duration for paused)
  const displayTime = isPlaying 
    ? formatTime(position) 
    : (duration ? formatTime(duration) : '00:00');
  
  // Small version for chat bubbles
  if (small) {
    return (
      <View style={styles.smallContainer}>
        {isLoading ? (
          <ActivityIndicator size="small" color="#2196F3" />
        ) : error ? (
          <Text style={styles.errorText}>❌</Text>
        ) : (
          <TouchableOpacity 
            onPress={togglePlayPause} 
            style={styles.smallButton}
          >
            <Ionicons 
              name={isPlaying ? "pause" : "play"} 
              size={20} 
              color="#2196F3" 
            />
            <View style={styles.smallProgressContainer}>
              <View 
                style={[
                  styles.smallProgressBar, 
                  { width: `${progress}%` }
                ]} 
              />
            </View>
            <Text style={styles.smallTimeText}>{displayTime}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  
  // Full version for media preview
  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Đang tải audio...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <FontAwesome name="exclamation-triangle" size={24} color="#ff6b6b" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity 
            onPress={togglePlayPause} 
            style={styles.playButton}
          >
            <Ionicons 
              name={isPlaying ? "pause-circle" : "play-circle"} 
              size={50} 
              color="#2196F3" 
            />
          </TouchableOpacity>
          
          <View style={styles.progressContainer}>
            <View style={styles.progressBackground}>
              <View 
                style={[
                  styles.progressBar, 
                  { width: `${progress}%` }
                ]} 
              />
            </View>
            <View style={styles.timeContainer}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  loadingContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  errorContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  errorText: {
    marginTop: 10,
    color: '#ff6b6b',
  },
  playButton: {
    padding: 5,
  },
  progressContainer: {
    flex: 1,
    marginLeft: 15,
  },
  progressBackground: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#2196F3',
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  timeText: {
    fontSize: 12,
    color: '#666',
  },
  
  // Styles for small version in chat bubbles
  smallContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  smallProgressContainer: {
    width: 70,
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  smallProgressBar: {
    height: '100%',
    backgroundColor: '#2196F3',
  },
  smallTimeText: {
    fontSize: 11,
    color: '#666',
  },
});

export default AudioPlayer;
