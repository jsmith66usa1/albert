export enum Era {
  Introduction = 'Introduction',
  Foundations = 'Foundations',
  Geometry = 'The Geometry of Forms',
  Zero = 'The Origins of Zero',
  Algebra = 'The Birth of Algebra',
  Calculus = 'The Calculus Revolution',
  Analysis = 'The Age of Analysis',
  Quantum = 'The Quantum Leap',
  Unified = 'The Unified Theory'
}

export interface Message {
  role: 'user' | 'einstein';
  text: string;
  imagePrompt?: string;
  imageUrl?: string;
  timestamp: number;
}

export interface Chapter {
  id: Era;
  title: string;
  description: string;
  prompt: string;
}