
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
    // Smooth scroll to bottom
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    
    // Trigger MathJax typeset
    if ((window as any).MathJax && containerRef.current) {
      requestAnimationFrame(() => {
        try {
          (window as any).MathJax.typesetPromise([containerRef.current])
            .catch((err: any) => console.error("MathJax promise error:", err));
        } catch (err) {
          console.error("MathJax call error:", err);
        }
      });
    }
  }, [messages, isTyping]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-950/50 relative tex2jax_process scroll-smooth" 
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[95%] md:max-w-[85%] p-6 rounded-2xl shadow-xl transition-all ${
              msg.role === 'user'
                ? 'bg-indigo-700 text-white rounded-br-none border border-indigo-500/50 shadow-indigo-500/10'
                : 'bg-slate-900 border border-indigo-500/20 text-indigo-50 rounded-bl-none border-l-4 border-l-indigo-500 shadow-2xl'
            }`}
          >
            {msg.role === 'model' ? (
               <div className="whitespace-pre-wrap font-serif leading-relaxed text-lg lg:text-xl math-content selection:bg-indigo-500/30">
                 {msg.text
                   .replace(/\[IMAGE:.*?\]/g, '')
                   .replace(/\[SECTION_COMPLETE\]/g, '')
                   .replace(/\[CHAPTER_COMPLETED:.*?\]/g, '')} 
               </div>
            ) : (
              <div className="font-sans text-base tracking-wide opacity-90 italic">{msg.text}</div>
            )}
          </div>
        </div>
      ))}
      
      {isTyping && (
        <div className="flex justify-start">
           <div className="bg-slate-900 border border-indigo-500/20 p-5 rounded-2xl rounded-bl-none shadow-2xl flex items-center space-x-3">
             <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
             <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
             <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
             <span className="text-xs font-sans font-bold text-indigo-400 uppercase tracking-widest ml-2">Einstein is thinking</span>
           </div>
        </div>
      )}
      <div ref={endRef} className="h-8" />
    </div>
  );
};

export default ChatInterface;
