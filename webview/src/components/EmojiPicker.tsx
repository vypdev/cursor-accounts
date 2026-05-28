import React from 'react';

const PROFILE_EMOJIS = [
  '👤',
  '💼',
  '🏠',
  '🚀',
  '⭐',
  '🔵',
  '🟢',
  '🟣',
  '🟡',
  '🔴',
  '💻',
  '🎯',
  '🌙',
  '☀️',
  '🦊',
  '🐱',
  '🐶',
  '🎨',
  '📚',
  '⚡',
  '🔧',
  '🌍',
  '🎮',
  '📝',
];

interface EmojiPickerProps {
  value?: string;
  onChange: (emoji: string) => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ value, onChange }) => {
  return (
    <div className="emoji-picker" role="listbox" aria-label="Choose profile emoji">
      {PROFILE_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="option"
          aria-selected={value === emoji}
          className={`emoji-option ${value === emoji ? 'selected' : ''}`}
          onClick={() => onChange(emoji)}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

export const DEFAULT_PROFILE_EMOJI = '👤';
