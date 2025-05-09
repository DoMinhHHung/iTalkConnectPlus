import React, { useState, useRef, useEffect } from 'react';
import { useAppSelector } from '../../redux/hooks';
import './MessageReactions.scss';

// Common emojis for reactions
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

interface ReactionUser {
  _id: string;
  firstName: string;
  lastName: string;
  profileImage?: string;
}

interface Reaction {
  emoji: string;
  userId: ReactionUser;
  createdAt: string;
}

interface MessageReactionsProps {
  messageId: string;
  reactions: Map<string, Reaction[]>;
  onAddReaction: (messageId: string, emoji: string) => void;
  onRemoveReaction: (messageId: string, emoji: string) => void;
  isMine: boolean;
}

const MessageReactions: React.FC<MessageReactionsProps> = ({
  messageId,
  reactions,
  onAddReaction,
  onRemoveReaction,
  isMine
}) => {
  const user = useAppSelector(state => state.auth.user);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showReactionDetails, setShowReactionDetails] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  
  // Convert map to array for easier rendering
  const reactionsList = reactions ? Array.from(reactions.entries()).map(
    ([emoji, users]) => ({ emoji, users, count: users.length })
  ) : [];
  
  // Check if current user has reacted with a specific emoji
  const hasReacted = (emoji: string) => {
    if (!reactions || !reactions.has(emoji) || !user?._id) return false;
    const reactors = reactions.get(emoji) || [];
    return reactors.some(r => r.userId?._id === user._id);
  };
  
  // Handle adding/removing reaction
  const handleReaction = (emoji: string) => {
    if (hasReacted(emoji)) {
      onRemoveReaction(messageId, emoji);
    } else {
      onAddReaction(messageId, emoji);
    }
    setShowReactionPicker(false);
  };
  
  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowReactionPicker(false);
      }
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        setShowReactionDetails(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  return (
    <div className="message-reactions-container">
      {/* Display existing reactions */}
      {reactionsList.length > 0 && (
        <div 
          className={`reactions-display ${isMine ? 'my-message' : 'their-message'}`}
          onClick={() => setShowReactionDetails(true)}
        >
          {reactionsList.map(({ emoji, count }) => (
            <span key={emoji} className="reaction-item">
              {emoji} <span className="reaction-count">{count}</span>
            </span>
          ))}
        </div>
      )}
      
      {/* Add reaction button */}
      <div className="reaction-actions">
        <button 
          className="add-reaction-btn"
          onClick={() => setShowReactionPicker(!showReactionPicker)}
          aria-label="Add reaction"
        >
          😊
        </button>
      </div>
      
      {/* Reaction picker */}
      {showReactionPicker && (
        <div className="reaction-picker" ref={pickerRef}>
          {REACTION_EMOJIS.map(emoji => (
            <button
              key={emoji}
              className={`emoji-btn ${hasReacted(emoji) ? 'selected' : ''}`}
              onClick={() => handleReaction(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      
      {/* Reaction details modal */}
      {showReactionDetails && (
        <div className="reaction-details-modal" ref={detailsRef}>
          <div className="modal-header">
            <h3>Reactions</h3>
            <button onClick={() => setShowReactionDetails(false)}>×</button>
          </div>
          <div className="modal-content">
            {reactionsList.map(({ emoji, users }) => (
              <div key={emoji} className="reaction-group">
                <div className="reaction-emoji">{emoji}</div>
                <div className="reaction-users">
                  {users.map(reaction => (
                    <div key={reaction.userId._id} className="user-item">
                      {reaction.userId.profileImage ? (
                        <img 
                          src={reaction.userId.profileImage} 
                          alt={`${reaction.userId.firstName} ${reaction.userId.lastName}`} 
                          className="user-avatar"
                        />
                      ) : (
                        <div className="user-avatar-placeholder">
                          {reaction.userId.firstName?.charAt(0)}{reaction.userId.lastName?.charAt(0)}
                        </div>
                      )}
                      <span className="user-name">
                        {reaction.userId.firstName} {reaction.userId.lastName}
                        {user?._id && reaction.userId._id === user._id && ' (You)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageReactions; 