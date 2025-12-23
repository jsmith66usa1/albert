
import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  isTyping: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, isTyping }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // MathJax rendering logic for dynamic content
    const mathJax = (window as any).MathJax;
    if (containerRef.current && mathJax && mathJax.typesetPromise) {
      mathJax.typesetPromise([containerRef.current]).catch((err: any) => {
        console.warn("MathJax typeset failed:", err);
      });
    }

    if (messages.length <= 2) {
      // New chapter or reset: snap to top
      containerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      // Ongoing conversation: smooth scroll to latest
      containerRef.current?.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isTyping]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto p-5 space-y-6 bg-zinc-950/50 relative scroll-smooth flex flex-col justify-start custom-scrollbar tex2jax_process" 
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex w-full animate-in fade-in slide-in-from-top-4 duration-500 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[90%] md:max-w-[85%] p-5 rounded-xl shadow-lg transition-all ${
              msg.role === 'user'
                ? 'bg-indigo-900/40 text-white rounded-tr-none border border-indigo-700/30 text-xs font-mono italic opacity-60'
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
              <div className="text-sm font-sans">{msg.text}</div>
            )}
          </div>
        </div>
      ))}
      
      {isTyping && (
        <div className="flex justify-start pb-4">
           <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl rounded-tl-none shadow-xl flex items-center space-x-2">
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
             <span className="text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-widest ml-1">Professor is writing</span>
           </div>
        </div>
      )}
      <div className="h-10 shrink-0" />
    </div>
  );
};

export default ChatInterface;