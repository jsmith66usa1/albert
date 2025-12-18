
import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, Suggestion } from './types';
import { sendMessageStream, generateHistoricalImage, generateSpeech, playAudioBuffer, warmupAudioContext, cancelAllPendingTTS } from './services/geminiService';
import { INITIAL_IMAGE } from './constants';
import { CHAPTER_CONTENT } from './data/chapters';
import ChatInterface from './components/ChatInterface';

const SECTIONS = [
  { id: 'stop', label: '■ Silence', prompt: 'STOP', chapterNum: -1 },
  { id: 'start', label: 'Introduction', prompt: 'Start', chapterNum: 0 },
  { id: 'ch1', label: 'Chapter 1: Foundations', prompt: 'Start at Chapter 1: The Foundations', chapterNum: 1 },
  { id: 'ch2', label: 'Chapter 2: Greeks', prompt: 'Start at Chapter 2: The Greek Revolution', chapterNum: 2 },
  { id: 'ch3', label: 'Chapter 3: Algebra', prompt: 'Start at Chapter 3: The Golden Age of Algebra', chapterNum: 3 },
  { id: 'ch4', label: 'Chapter 4: Calculus', prompt: 'Start at Chapter 4: The Scientific Revolution', chapterNum: 4 },
  { id: 'ch5', label: 'Chapter 5: Modern Era', prompt: 'Start at Chapter 5: The Modern Era', chapterNum: 5 },
];

type AudioState = 'idle' | 'loading' | 'playing';

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentImage, setCurrentImage] = useState<string>(INITIAL_IMAGE);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [completedChapterNum, setCompletedChapterNum] = useState<number>(-1);
  const [currentTopicLabel, setCurrentTopicLabel] = useState<string>("Professor Einstein");
  
  const audioQueueRef = useRef<Promise<AudioBuffer | null>[]>([]);
  const isPlayingQueueRef = useRef(false);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sessionIDRef = useRef(0);
  const imageCacheRef = useRef<Map<string, string>>(new Map());
  const lastTriggeredPromptRef = useRef<string | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unlock = () => warmupAudioContext();
    window.addEventListener('click', unlock);
    return () => window.removeEventListener('click', unlock);
  }, []);

  const stopAudio = () => {
    sessionIDRef.current++;
    cancelAllPendingTTS();
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch(e) {}
      activeSourceRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingQueueRef.current = false;
    setAudioState('idle');
  };

  const processAudioQueue = async () => {
    if (isPlayingQueueRef.current) return;
    isPlayingQueueRef.current = true;
    const currentSession = sessionIDRef.current;
    try {
      while (audioQueueRef.current.length > 0) {
        if (sessionIDRef.current !== currentSession) break;
        setAudioState('loading');
        const nextAudioPromise = audioQueueRef.current[0];
        audioQueueRef.current.shift(); 
        const buffer = await nextAudioPromise;
        if (sessionIDRef.current !== currentSession) break;
        if (buffer) {
           setAudioState('playing');
           const source = await playAudioBuffer(buffer);
           if (source) {
             activeSourceRef.current = source;
             await new Promise<void>((resolve) => {
               source.onended = () => resolve();
               setTimeout(resolve, (buffer.duration * 1000) + 100);
             });
           }
        }
      }
    } finally {
      if (sessionIDRef.current === currentSession) {
        isPlayingQueueRef.current = false;
        if (audioQueueRef.current.length === 0) setAudioState('idle');
      }
    }
  };

  const handleHearSpeak = () => {
    if (audioState === 'playing' || audioState === 'loading') {
      stopAudio();
      return;
    }
    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
    if (!lastModelMessage) return;

    const cleanText = lastModelMessage.text
      .replace(/\[IMAGE:.*?\]/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\*/g, '')
      .replace(/\$/g, '')
      .replace(/\\/g, '')
      .trim();

    if (cleanText.length < 5) return;
    const sentences = cleanText.match(/[^.!?\n]+[.!?\n]/g) || [cleanText];
    
    stopAudio(); 
    for (const s of sentences) {
      audioQueueRef.current.push(generateSpeech(s));
    }
    processAudioQueue();
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    stopAudio();
    lastTriggeredPromptRef.current = null; // Reset for new turn
    
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSuggestions([]);
    setIsStreaming(true);
    
    const modelMsgId = (Date.now() + 1).toString();
    activeMessageIdRef.current = modelMsgId;
    setMessages(prev => [...prev, { id: modelMsgId, role: 'model', text: '', timestamp: new Date(), isStreaming: true }]);

    try {
        let accumulatedText = '';
        const preloadedContent = CHAPTER_CONTENT[text];
        
        if (preloadedContent) {
            // Immediate scan for preloaded
            handleImageScanning(preloadedContent);
            
            for (let i = 0; i < preloadedContent.length; i += 30) {
                if (activeMessageIdRef.current !== modelMsgId) break;
                accumulatedText += preloadedContent.slice(i, i + 30);
                setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: accumulatedText } : m));
                await new Promise(r => setTimeout(r, 15));
            }
        } else {
            const stream = await sendMessageStream(text, messages); 
            for await (const chunk of stream) {
                if (activeMessageIdRef.current !== modelMsgId) break;
                accumulatedText += chunk.text || '';
                setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: accumulatedText } : m));
                handleImageScanning(accumulatedText);
            }
        }
        
        if (activeMessageIdRef.current === modelMsgId) {
            setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, isStreaming: false } : m));
            const completionMatch = accumulatedText.match(/\[CHAPTER_COMPLETED:\s*(\d+)\]/);
            const currentCompleted = completionMatch ? parseInt(completionMatch[1], 10) : completedChapterNum;
            if (completionMatch) setCompletedChapterNum(currentCompleted);
            buildSuggestions(accumulatedText, currentCompleted);
        }
    } catch (e) {
        setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: "Ach, it seems the universe is in a bit of a tangle. Let us try again.", isStreaming: false } : m));
    } finally {
        if (activeMessageIdRef.current === modelMsgId) setIsStreaming(false);
    }
  };

  const handleImageScanning = (fullText: string) => {
    const matches = Array.from(fullText.matchAll(/\[IMAGE:\s*([^\]]+)\]/gi));
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const prompt = lastMatch[1].trim();
      
      if (prompt !== lastTriggeredPromptRef.current) {
        lastTriggeredPromptRef.current = prompt;
        const displayLabel = prompt.split(',')[0].substring(0, 40) + (prompt.length > 40 ? '...' : '');
        setCurrentTopicLabel(displayLabel);
        
        if (imageCacheRef.current.has(prompt)) {
          setCurrentImage(imageCacheRef.current.get(prompt)!);
        } else {
          triggerImageGeneration(prompt);
        }
      }
    }
  };

  const triggerImageGeneration = async (prompt: string) => {
    setIsGeneratingImage(true);
    try {
      const base64 = await generateHistoricalImage(prompt);
      if (base64) {
        imageCacheRef.current.set(prompt, base64);
        setCurrentImage(base64);
      }
    } finally { setIsGeneratingImage(false); }
  };

  const buildSuggestions = (text: string, currentCompleted: number) => {
      const next: Suggestion[] = [];
      const actualNextChapterIdx = currentCompleted + 2; 

      if (actualNextChapterIdx < SECTIONS.length) {
          const nextSec = SECTIONS[actualNextChapterIdx];
          next.push({ label: `Next: ${nextSec.label}`, text: nextSec.prompt });
      }

      next.push({ label: 'Go Deeper', text: "Ach, Professor, could you please go deeper into this specific subject? It is wunderbar!" });
      next.push({ label: 'Topic Visual', text: "Professor, can you show me a new visual representation for this subject? Please include a new [IMAGE: ...] tag." });
      next.push({ label: 'Roadmap', text: "OPEN_CHAPTER_MENU" });
      setSuggestions(next);
  };

  if (!hasStarted) {
      return (
        <div className="h-[100dvh] w-full bg-[#030712] flex flex-col items-center justify-center text-slate-100 relative overflow-hidden font-serif">
           <div className="absolute inset-0 z-0 opacity-40">
               <img src={INITIAL_IMAGE} className="w-full h-full object-cover" alt="Einstein" />
           </div>
           <div className="z-10 text-center max-w-3xl px-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
             <h1 className="text-6xl md:text-9xl font-bold mb-8 tracking-tighter text-white font-['Cinzel'] drop-shadow-2xl">Einstein's Universe</h1>
             <p className="text-xl md:text-3xl mb-12 leading-relaxed italic opacity-90 font-['Playfair_Display']">"Imagination is the poetry of logical ideas."</p>
             <button 
               onClick={() => { setHasStarted(true); handleSendMessage('Start'); }}
               className="px-20 py-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-2xl transition-all transform hover:scale-105 shadow-[0_20px_50px_rgba(79,70,229,0.3)] border-2 border-indigo-400 group"
             >
               Explore the Study
               <span className="inline-block ml-3 transform transition-transform group-hover:translate-x-2">→</span>
             </button>
           </div>
        </div>
      );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-950 text-slate-100 font-serif overflow-hidden">
      <header className="bg-slate-950/90 backdrop-blur-xl p-5 shadow-2xl flex items-center justify-between z-40 border-b border-indigo-500/20">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white border-2 border-indigo-400 shadow-[0_0_20px_rgba(79,70,229,0.6)]">AE</div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight font-['Cinzel'] text-indigo-100 leading-none">Einstein's Mathematical Universe</h1>
            <p className="text-xs text-indigo-400/80 font-sans tracking-widest uppercase mt-1">Interactive Historical Guide</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <button 
            onClick={handleHearSpeak}
            className={`p-3 rounded-xl transition-all ${audioState !== 'idle' ? 'bg-indigo-500 text-white scale-110 shadow-[0_0_25px_rgba(99,102,241,0.5)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'}`}
            title="Listen to the Professor"
          >
            {audioState === 'playing' ? (
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
               </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728" />
              </svg>
            )}
          </button>
          <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-3 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition-all border border-slate-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* ENHANCED IMAGE AREA: NOW 60% WIDTH ON DESKTOP */}
        <div className="w-full md:w-[60%] bg-black flex flex-col items-center justify-center relative shadow-[inset_-20px_0_60px_rgba(0,0,0,0.9)] z-10 transition-all duration-700">
          <div className="absolute inset-0 opacity-20 pointer-events-none overflow-hidden">
            <img src={currentImage} className="w-full h-full object-cover blur-3xl scale-150 animate-pulse-slow" alt="" />
          </div>
          
          <div className="relative w-[94%] h-[90%] border-2 border-indigo-500/30 rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(79,70,229,0.3)] bg-slate-900 group transition-all duration-1000">
             {isGeneratingImage && (
               <div className="absolute inset-0 bg-slate-950/80 z-20 flex items-center justify-center backdrop-blur-xl">
                  <div className="flex flex-col items-center">
                    <div className="w-20 h-20 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="mt-6 text-indigo-300 text-sm font-sans font-bold uppercase tracking-[0.4em] text-center px-10 animate-pulse">Visualizing the Subject...</span>
                  </div>
               </div>
             )}
             <img src={currentImage} alt="Historical Subject" className="w-full h-full object-cover transition-all duration-1000 transform group-hover:scale-110" />
             
             {/* Dynamic Branding Overlay */}
             <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent p-12 pointer-events-none transition-all duration-700 transform translate-y-4 group-hover:translate-y-0">
                <div className="flex items-center space-x-3 mb-3">
                    <span className="h-px w-8 bg-indigo-500/50"></span>
                    <p className="text-indigo-400 text-xs font-sans tracking-[0.5em] uppercase font-bold">Subject Visual</p>
                </div>
                <h3 className="text-white text-3xl md:text-4xl font-serif italic leading-tight drop-shadow-2xl opacity-95">{currentTopicLabel}</h3>
             </div>
          </div>
        </div>

        {/* CHAT AREA: 40% WIDTH */}
        <div className="w-full md:w-[40%] flex flex-col bg-slate-950 relative border-l border-indigo-500/20">
          <ChatInterface messages={messages} isTyping={isStreaming} />
          
          {isMenuOpen && (
            <div className="absolute inset-0 bg-slate-950/98 z-50 p-12 flex flex-col animate-in fade-in zoom-in-95 duration-500 overflow-hidden">
              <div className="flex justify-between items-center mb-12">
                <div>
                  <h2 className="text-4xl font-bold text-white font-['Cinzel'] leading-none">The Roadmap</h2>
                  <p className="text-indigo-400 text-xs uppercase tracking-widest mt-2">Select a milestone in math history</p>
                </div>
                <button onClick={() => setIsMenuOpen(false)} className="p-2 text-slate-500 hover:text-white transition-all transform hover:rotate-90">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                   </svg>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 overflow-y-auto pr-4 custom-scrollbar">
                {SECTIONS.map((sec) => (
                  <button
                    key={sec.id}
                    onClick={() => {
                        if (sec.id === 'stop') stopAudio();
                        else handleSendMessage(sec.prompt);
                        setIsMenuOpen(false);
                    }}
                    className={`text-left p-8 border transition-all rounded-2xl group relative overflow-hidden flex flex-col justify-center ${
                      sec.id === 'stop' 
                        ? 'border-rose-900/40 bg-rose-950/10 text-rose-300 hover:bg-rose-950/30' 
                        : 'border-indigo-500/20 bg-indigo-900/10 text-indigo-100 hover:bg-indigo-900/30 hover:border-indigo-500/60 hover:scale-[1.02]'
                    }`}
                  >
                    <div className="font-bold text-2xl group-hover:text-white transition-colors flex items-center mb-1">
                      {sec.label}
                    </div>
                    <div className="text-xs opacity-40 uppercase tracking-[0.2em] font-sans">{sec.prompt === 'STOP' ? 'End active speech' : 'Explore this era'}</div>
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-6 bg-slate-900 border-t border-indigo-500/20">
            {!isStreaming && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6 items-center">
                {suggestions.map((s, i) => {
                  const isNextChapter = s.label.startsWith('Next:');
                  return (
                    <button
                      key={i}
                      onClick={() => s.text === "OPEN_CHAPTER_MENU" ? setIsMenuOpen(true) : handleSendMessage(s.text)}
                      className={`px-5 py-3 text-xs md:text-sm font-bold rounded-xl transition-all shadow-2xl transform active:scale-95 border ${
                        isNextChapter 
                          ? 'bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500 hover:shadow-indigo-600/50 ring-2 ring-indigo-500/40' 
                          : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex space-x-3">
              <input 
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message the Professor..."
                className="flex-1 bg-slate-950 border-2 border-slate-800 px-6 py-5 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 outline-none font-serif text-lg shadow-inner rounded-2xl text-white placeholder-slate-600 transition-all"
                disabled={isStreaming}
              />
              <button 
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="bg-indigo-600 text-white px-10 py-5 font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 rounded-2xl shadow-xl hover:shadow-indigo-600/50 active:scale-95 flex items-center justify-center min-w-[120px] border-b-4 border-indigo-800"
              >
                {isStreaming ? (
                   <div className="w-7 h-7 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  "Ask"
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
      
      <style>{`
        .animate-pulse-slow { animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(79, 70, 229, 0.3); border-radius: 10px; }
        @keyframes pulse { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.25; } }
      `}</style>
    </div>
  );
};

export default App;
