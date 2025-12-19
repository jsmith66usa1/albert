
import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  isTyping: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, isTyping }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto p-5 space-y-6 bg-zinc-950/50 relative scroll-smooth" 
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[90%] md:max-w-[85%] p-5 rounded-xl shadow-lg transition-all ${
              msg.role === 'user'
                ? 'bg-indigo-900 text-white rounded-tr-none border border-indigo-700/50 shadow-indigo-500/10'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-50 rounded-tl-none border-l-2 border-l-indigo-500 shadow-xl'
            }`}
          >
            {msg.role === 'model' ? (
               <div className="whitespace-pre-wrap font-serif leading-relaxed text-base lg:text-lg selection:bg-indigo-900/50 text-zinc-200">
                 {msg.text
                   .replace(/\[IMAGE:.*?\]/g, '')
                   .replace(/\[SECTION_COMPLETE\]/g, '')
                   .replace(/\[CHAPTER_COMPLETED:.*?\]/g, '')} 
               </div>
            ) : (
              <div className="font-mono text-xs tracking-tight opacity-90 italic text-indigo-200">{msg.text}</div>
            )}
          </div>
        </div>
      ))}
      
      {isTyping && (
        <div className="flex justify-start">
           <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl rounded-tl-none shadow-xl flex items-center space-x-2">
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
             <span className="text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-widest ml-1">Einstein is thinking</span>
           </div>
        </div>
      )}
      <div ref={endRef} className="h-4" />
    </div>
  );
};

export default ChatInterface;
