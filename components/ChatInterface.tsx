import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  isTyping: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, isTyping }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mathTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const triggerMathTypeset = () => {
      const MathJax = (window as any).MathJax;
      if (containerRef.current && MathJax && MathJax.typesetPromise) {
        if (mathTimerRef.current) window.clearTimeout(mathTimerRef.current);
        
        mathTimerRef.current = window.setTimeout(() => {
          MathJax.typesetPromise([containerRef.current]).catch((err: any) => {
            console.debug("MathJax pending...");
          });
        }, 150);
      }
    };

    triggerMathTypeset();

    // Forced Top Scrolling: Since we now reverse the list visually to keep text at the top,
    // we scroll to 0 to show the newest messages which are at the start of the list.
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }

    return () => {
      if (mathTimerRef.current) window.clearTimeout(mathTimerRef.current);
    };
  }, [messages, isTyping]);

  const cleanText = (text: string) => {
    return text
      .replace(/\[IMAGE:.*?\]/g, '')
      .replace(/\[SECTION_COMPLETE\]/g, '')
      .replace(/\[CHAPTER_COMPLETED:.*?\]/g, '');
  };

  // Reverse messages so newest is at the top of the container
  const reversedMessages = [...messages].reverse();

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 md:space-y-6 bg-zinc-950/30 relative flex flex-col justify-start custom-scrollbar tex2jax_process" 
    >
      {isTyping && (
        <div className="flex justify-start pb-2">
           <div className="bg-zinc-900 border border-zinc-800 p-3 md:p-4 rounded-xl rounded-tl-none shadow-xl flex items-center space-x-2">
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
             <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
             <span className="text-[9px] md:text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-widest ml-1">Professor is thinking</span>
           </div>
        </div>
      )}

      {reversedMessages.map((msg) => (
        <div
          key={msg.id}
          className={`flex w-full animate-in fade-in slide-in-from-top-4 duration-500 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[92%] md:max-w-[85%] p-4 md:p-5 rounded-xl shadow-lg transition-all ${
              msg.role === 'user'
                ? 'bg-indigo-900/30 text-white rounded-tr-none border border-indigo-700/20 text-[10px] md:text-xs font-mono italic opacity-50'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-50 rounded-tl-none border-l-2 border-l-indigo-500 shadow-xl'
            }`}
          >
            {msg.role === 'model' ? (
               <div className="whitespace-pre-wrap font-serif leading-relaxed text-sm md:text-base lg:text-lg selection:bg-indigo-900/50 text-zinc-200">
                 {cleanText(msg.text)}
               </div>
            ) : (
              <div className="text-xs font-sans">{msg.text}</div>
            )}
          </div>
        </div>
      ))}
      
      <div className="h-4 shrink-0" />
    </div>
  );
};

export default ChatInterface;