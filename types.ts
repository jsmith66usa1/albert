export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface Suggestion {
  label: string;
  text: string;
}

export enum GameState {
  IDLE,
  ACTIVE,
  ERROR
}
