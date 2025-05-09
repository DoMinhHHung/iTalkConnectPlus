import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal, 
  FlatList,
  Image,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  profileImage?: string;
}

interface Reaction {
  emoji: string;
  userId: User;
  createdAt: string;
}

type ReactionsMap = Map<string, Reaction[]>;

interface MessageReactionsProps {
  reactions: ReactionsMap;
  currentUserId: string;
}

const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions,
  currentUserId
}) => {
  const [showDetails, setShowDetails] = useState(false);
  
  // Convert map to array for displaying
  const reactionsList = Array.from(reactions || new Map()).map(
    ([emoji, users]) => ({ emoji, users, count: users.length })
  );
  
  // Filter out empty categories
  const nonEmptyReactions = reactionsList.filter(r => r.count > 0);
  
  if (nonEmptyReactions.length === 0) {
    return null;
  }
  
  return (
    <>
      <TouchableOpacity 
        style={styles.reactionsContainer}
        onPress={() => setShowDetails(true)}
      >
        {nonEmptyReactions.map(({ emoji, count }) => (
          <View key={emoji} style={styles.reactionItem}>
            <Text style={styles.emojiText}>{emoji}</Text>
            {count > 1 && <Text style={styles.countText}>{count}</Text>}
          </View>
        ))}
      </TouchableOpacity>
      
      <Modal
        visible={showDetails}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reactions</Text>
              <TouchableOpacity onPress={() => setShowDetails(false)}>
                <Ionicons name="close" size={24} color="#555" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.reactionsScroll}>
              {nonEmptyReactions.map(({ emoji, users }) => (
                <View key={emoji} style={styles.reactionSection}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionEmoji}>{emoji}</Text>
                    <Text style={styles.sectionCount}>{users.length}</Text>
                  </View>
                  
                  {users.map(reaction => (
                    <View key={reaction.userId._id} style={styles.userItem}>
                      {reaction.userId.profileImage ? (
                        <Image 
                          source={{ uri: reaction.userId.profileImage }} 
                          style={styles.userAvatar} 
                        />
                      ) : (
                        <View style={styles.userAvatarPlaceholder}>
                          <Text style={styles.avatarInitials}>
                            {reaction.userId.firstName?.charAt(0)}
                            {reaction.userId.lastName?.charAt(0)}
                          </Text>
                        </View>
                      )}
                      
                      <Text style={styles.userName}>
                        {reaction.userId.firstName} {reaction.userId.lastName}
                        {reaction.userId._id === currentUserId && ' (You)'}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  reactionsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(248, 248, 248, 0.9)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginVertical: 4,
    maxWidth: '80%',
    flexWrap: 'wrap',
  },
  reactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 2,
  },
  emojiText: {
    fontSize: 14,
  },
  countText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '85%',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  reactionsScroll: {
    maxHeight: '90%',
  },
  reactionSection: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sectionEmoji: {
    fontSize: 22,
    marginRight: 8,
  },
  sectionCount: {
    fontSize: 14,
    color: '#666',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
  },
  userAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarInitials: {
    color: '#555',
    fontSize: 14,
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 16,
    color: '#333',
  },
});

export default MessageReactions; 