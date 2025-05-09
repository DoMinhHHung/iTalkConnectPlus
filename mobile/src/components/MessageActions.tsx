import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Modal,
  FlatList,
  Pressable,
  Animated
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

// Common emojis for reactions
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

interface MessageActionsProps {
  isMyMessage: boolean;
  onReaction: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onUnsend: () => void;
  onHideForMe: () => void;
  canUnsend: boolean;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  isMyMessage,
  onReaction,
  onReply,
  onForward,
  onUnsend,
  onHideForMe,
  canUnsend
}) => {
  const [visible, setVisible] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [animation] = useState(new Animated.Value(0));
  
  const showMenu = () => {
    setVisible(true);
    Animated.timing(animation, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true
    }).start();
  };
  
  const hideMenu = () => {
    Animated.timing(animation, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true
    }).start(() => {
      setVisible(false);
      setShowReactions(false);
    });
  };
  
  const translateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [50, 0]
  });
  
  const opacity = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1]
  });
  
  const handleAction = (action: string) => {
    hideMenu();
    
    switch (action) {
      case 'react':
        setShowReactions(true);
        break;
      case 'reply':
        onReply();
        break;
      case 'forward':
        onForward();
        break;
      case 'unsend':
        onUnsend();
        break;
      case 'hide':
        onHideForMe();
        break;
    }
  };
  
  const handleReaction = (emoji: string) => {
    onReaction(emoji);
    hideMenu();
  };
  
  return (
    <>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={showMenu}
      >
        <MaterialIcons name="more-vert" size={18} color="#555" />
      </TouchableOpacity>
      
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={hideMenu}
      >
        <Pressable style={styles.overlay} onPress={hideMenu}>
          {showReactions ? (
            <Animated.View
              style={[
                styles.reactionsContainer,
                { opacity, transform: [{ translateY }] }
              ]}
            >
              {REACTION_EMOJIS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.reactionButton}
                  onPress={() => handleReaction(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </Animated.View>
          ) : (
            <Animated.View
              style={[
                styles.actionsContainer,
                { opacity, transform: [{ translateY }] }
              ]}
            >
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => handleAction('react')}
              >
                <Ionicons name="happy-outline" size={22} color="#555" />
                <Text style={styles.actionText}>React</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => handleAction('reply')}
              >
                <Ionicons name="return-down-back-outline" size={22} color="#555" />
                <Text style={styles.actionText}>Reply</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => handleAction('forward')}
              >
                <Ionicons name="arrow-redo-outline" size={22} color="#555" />
                <Text style={styles.actionText}>Forward</Text>
              </TouchableOpacity>
              
              {canUnsend && (
                <TouchableOpacity
                  style={styles.actionItem}
                  onPress={() => handleAction('unsend')}
                >
                  <Ionicons name="trash-outline" size={22} color="#FF6B6B" />
                  <Text style={[styles.actionText, { color: '#FF6B6B' }]}>Unsend</Text>
                </TouchableOpacity>
              )}
              
              {!isMyMessage && (
                <TouchableOpacity
                  style={styles.actionItem}
                  onPress={() => handleAction('hide')}
                >
                  <Ionicons name="eye-off-outline" size={22} color="#555" />
                  <Text style={styles.actionText}>Hide for me</Text>
                </TouchableOpacity>
              )}
            </Animated.View>
          )}
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  actionButton: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsContainer: {
    backgroundColor: 'white',
    borderRadius: 8,
    width: '80%',
    maxWidth: 300,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  actionText: {
    marginLeft: 12,
    fontSize: 16,
    color: '#333',
  },
  reactionsContainer: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 8,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  reactionButton: {
    padding: 8,
    borderRadius: 20,
    marginHorizontal: 4,
  },
  emojiText: {
    fontSize: 24,
  }
});

export default MessageActions; 