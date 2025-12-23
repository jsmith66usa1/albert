
import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, Suggestion } from './types';
import { sendMessageStream, generateScientificImage, generateSpeech, playAudioBuffer, warmupAudioContext, cancelAllPendingTTS } from './services/geminiService';
import { getCachedChapter, saveChapterToCache, getCachedImage, saveCachedImage } from './services/firebaseService';
import { INITIAL_IMAGE } from './constants';
import { CHAPTER_CONTENT } from './data/chapters';
import ChatInterface from './components/ChatInterface';

const FAQ_OPTIONS = [
  { id: 'details', label: 'More Details?', prompt: 'Can you provide more technical details about this specific topic?' },
  { id: 'figures', label: 'Historical Figures?', prompt: "Are there other historical figures involved in this development that we haven't discussed?" },
  { id: 'innovations', label: 'Derived Innovations?', prompt: 'What modern innovations or technologies were derived from this mathematical discovery?' },
  { id: 'stop', label: '■ Silence Professor', prompt: 'STOP' },
];

const SECTIONS = [
  { id: 'start', label: 'Introduction', prompt: 'Start', chapterNum: 0 },
  { id: 'ch1', label: 'Chapter 1: Foundations', prompt: 'Start at Chapter 1: Foundations', chapterNum: 1 },
  { id: 'ch2', label: 'Chapter 2: Origins of Zero', prompt: 'Start at Chapter 2: The Origins of Zero', chapterNum: 2 },
  { id: 'ch3', label: 'Chapter 3: Birth of Algebra', prompt: 'Start at Chapter 3: The Birth of Algebra', chapterNum: 3 },
  { id: 'ch4', label: 'Chapter 4: Calculus Revolution', prompt: 'Start at Chapter 4: The Calculus Revolution', chapterNum: 4 },
  { id: 'ch5', label: 'Chapter 5: Age of Analysis', prompt: 'Start at Chapter 5: The Age of Analysis', chapterNum: 5 },
  { id: 'ch6', label: 'Chapter 6: The Quantum Leap', prompt: 'Start at Chapter 6: The Quantum Leap', chapterNum: 6 },
  { id: 'ch7', label: 'Chapter 7: The Unified Theory', prompt: 'Start at Chapter 7: The Unified Theory', chapterNum: 7 },
];

type AudioState = 'idle' | 'loading' | 'playing' | 'error_quota';
type MenuType = 'timeline' | 'faqs';

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentImage, setCurrentImage] = useState<string>(INITIAL_IMAGE);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeMenuType, setActiveMenuType] = useState<MenuType>('timeline');
  const [hasStarted, setHasStarted] = useState(false);
  const [completedChapterNum, setCompletedChapterNum] = useState<number>(-1);
  const [currentTopicLabel, setCurrentTopicLabel] = useState<string>("Professor Einstein");
  
  const audioQueueRef = useRef<Promise<AudioBuffer | null>[]>([]);
  const isPlayingQueueRef = useRef(false);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sessionIDRef = useRef(0);
  const imageCacheRef = useRef<Map<string, string>>(new Map());
  const blobUrlCacheRef = useRef<Map<string, string>>(new Map());
  const lastTriggeredPromptRef = useRef<string | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unlock = () => warmupAudioContext();
    window.addEventListener('click', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      blobUrlCacheRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const getBlobUrlFromBase64 = (base64: string): string => {
    if (!base64 || base64.startsWith('blob:') || base64.startsWith('http')) return base64;
    if (blobUrlCacheRef.current.has(base64)) return blobUrlCacheRef.current.get(base64)!;
    
    try {
      const parts = base64.split(';base64,');
      const b64Data = parts[1] || base64;
      const raw = window.atob(b64Data);
      const uInt8Array = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }
      const blob = new Blob([uInt8Array], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      blobUrlCacheRef.current.set(base64, url);
      return url;
    } catch (e) {
      return base64;
    }
  };

  const stopAudio = () => {
    sessionIDRef.current++;
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
        
        try {
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
        } catch (err: any) {
          if (err.message === "QUOTA_EXCEEDED") {
            setAudioState('error_quota');
            setTimeout(() => {
              if (sessionIDRef.current === currentSession) setAudioState('idle');
            }, 5000);
            break;
          }
        }
      }
    } finally {
      if (sessionIDRef.current === currentSession) {
        isPlayingQueueRef.current = false;
        if (audioQueueRef.current.length === 0 && audioState !== 'error_quota') setAudioState('idle');
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
      .trim();

    if (cleanText.length < 5) return;
    const sentences = cleanText.match(/[^.!?\n]+[.!?\n]/g) || [cleanText];
    
    stopAudio(); 
    for (const s of sentences) {
      audioQueueRef.current.push(generateSpeech(s));
    }
    processAudioQueue();
  };

  const handleSendMessage = async (text: string, cacheLabel?: string, shouldClear: boolean = true) => {
    if (!text.trim() || isStreaming) return;
    stopAudio();
    lastTriggeredPromptRef.current = null;
    
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: text, timestamp: new Date() };
    const currentHistory = shouldClear ? [] : messages;
    
    if (shouldClear) {
      setMessages([userMsg]);
    } else {
      setMessages(prev => [...prev, userMsg]);
    }
    
    setInput('');
    setSuggestions([]);
    setIsStreaming(true);
    
    const modelMsgId = (Date.now() + 1).toString();
    activeMessageIdRef.current = modelMsgId;
    setMessages(prev => [...prev, { id: modelMsgId, role: 'model', text: '', timestamp: new Date(), isStreaming: true }]);

    try {
        let accumulatedText = '';
        const preloadedContent = CHAPTER_CONTENT[text];
        
        let cachedData = null;
        if (!preloadedContent && cacheLabel) {
            cachedData = await getCachedChapter(cacheLabel);
        }

        if (preloadedContent || cachedData) {
            const contentToUse = preloadedContent || cachedData!.text;
            if (cachedData) {
              const b64 = cachedData.image;
              imageCacheRef.current.set(cacheLabel!, b64);
              setCurrentImage(getBlobUrlFromBase64(b64));
            }
            
            handleImageScanning(contentToUse);
            
            for (let i = 0; i < contentToUse.length; i += 30) {
                if (activeMessageIdRef.current !== modelMsgId) break;
                accumulatedText += contentToUse.slice(i, i + 30);
                setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: accumulatedText } : m));
                await new Promise(r => setTimeout(r, 10));
            }
        } else {
            const stream = await sendMessageStream(text, currentHistory); 
            for await (const chunk of stream) {
                if (activeMessageIdRef.current !== modelMsgId) break;
                const chunkText = chunk.text || '';
                accumulatedText += chunkText;
                setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: accumulatedText } : m));
                handleImageScanning(accumulatedText);
            }

            if (cacheLabel && activeMessageIdRef.current === modelMsgId) {
                const currentRaw = [...imageCacheRef.current.values()].pop() || currentImage;
                saveChapterToCache(cacheLabel, accumulatedText, currentRaw);
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
        setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: "The fabric of mathematical reality seems distorted. Let us recalibrate our observations.", isStreaming: false } : m));
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
          setCurrentImage(getBlobUrlFromBase64(imageCacheRef.current.get(prompt)!));
        } else {
          triggerImageGeneration(prompt);
        }
      }
    }
  };

  const triggerImageGeneration = async (prompt: string) => {
    setIsGeneratingImage(true);
    try {
      const globalCachedB64 = await getCachedImage(prompt);
      if (globalCachedB64) {
        imageCacheRef.current.set(prompt, globalCachedB64);
        setCurrentImage(getBlobUrlFromBase64(globalCachedB64));
        return;
      }

      const newB64 = await generateScientificImage(prompt);
      if (newB64) {
        imageCacheRef.current.set(prompt, newB64);
        setCurrentImage(getBlobUrlFromBase64(newB64));
        saveCachedImage(prompt, newB64);
      }
    } finally { setIsGeneratingImage(false); }
  };

  const buildSuggestions = (text: string, currentCompleted: number) => {
      const next: Suggestion[] = [];
      const actualNextChapterIdx = currentCompleted + 1;

      if (actualNextChapterIdx < SECTIONS.length) {
          const nextSec = SECTIONS[actualNextChapterIdx];
          next.push({ label: `Next: ${nextSec.label}`, text: nextSec.prompt });
      }

      let mathPrompt = "Professor, can you explain the mathematical logic behind this?";
      if (currentCompleted === 1) mathPrompt = "Professor, explain the mathematical logic behind Euclidean geometry.";
      else if (currentCompleted === 2) mathPrompt = "Professor, explain the revolutionary concept of Zero as a number.";
      else if (currentCompleted === 3) mathPrompt = "Professor, explain the logic of balancing equations in Algebra.";
      else if (currentCompleted === 4) mathPrompt = "Professor, explain the fundamental logic of Calculus.";
      else if (currentCompleted === 5) mathPrompt = "Professor, explain the mathematical logic of probability theory.";
      else if (currentCompleted === 6) mathPrompt = "Professor, explain the complex math of curved spacetime.";
      else if (currentCompleted === 7) mathPrompt = "Professor, what mathematical logic drives the search for a Unified Theory?";

      next.push({ label: 'Topic Diagram', text: mathPrompt });
      next.push({ label: 'FAQs', text: "OPEN_FAQ_MENU" });
      setSuggestions(next);
  };

  const openMenu = (type: MenuType) => {
    setActiveMenuType(type);
    setIsMenuOpen(true);
  };

  if (!hasStarted) {
      return (
        <div className="h-[100dvh] w-full bg-black flex flex-col items-center justify-center text-slate-100 relative overflow-hidden font-sans">
           <div className="absolute inset-0 z-0 opacity-40">
               <img src={INITIAL_IMAGE} className="w-full h-full object-cover opacity-50 blur-sm" alt="Einstein" />
           </div>
           <div className="z-10 text-center max-w-3xl px-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
             <h1 className="text-6xl md:text-8xl font-bold mb-8 tracking-tighter text-white font-['Playfair_Display'] drop-shadow-2xl">Einstein's Universe</h1>
             <p className="text-xl md:text-3xl mb-12 leading-relaxed italic opacity-90 font-['Fira_Code']">"Imagination is more important than knowledge."</p>
             <button 
               onClick={() => { setHasStarted(true); handleSendMessage('Start', 'Introduction', true); }}
               className="px-20 py-6 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-2xl text-2xl transition-all transform hover:scale-105 shadow-[0_20px_50px_rgba(49,46,129,0.3)] border border-indigo-500/50 group"
             >
               Enter the Lab
               <span className="inline-block ml-3 transform transition-transform group-hover:translate-x-2">→</span>
             </button>
           </div>
        </div>
      );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      <header className="bg-zinc-900/90 backdrop-blur-xl p-4 shadow-2xl flex items-center justify-between z-40 border-b border-zinc-800">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white border border-indigo-400 shadow-[0_0_15px_rgba(79,70,229,0.4)]">E=mc²</div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight font-['Playfair_Display'] text-white leading-none">Einstein's Universe</h1>
            <p className="text-[10px] text-indigo-400 font-mono tracking-[0.3em] uppercase mt-1">History of Mathematics</p>
          </div>
        </div>
        
        <div className="flex items-center bg-zinc-800/50 rounded-xl p-1 border border-zinc-700/50 space-x-1 shadow-inner relative">
          {audioState === 'error_quota' && (
            <div className="absolute -top-10 right-0 bg-amber-900/90 border border-amber-600 text-amber-100 text-[10px] px-3 py-1 rounded-lg animate-bounce shadow-lg whitespace-nowrap">
              The Professor is currently resting his voice (Quota Exceeded)
            </div>
          )}
          <button 
            onClick={handleHearSpeak}
            className={`p-2.5 rounded-lg transition-all flex items-center space-x-2 ${audioState === 'playing' || audioState === 'loading' ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]' : audioState === 'error_quota' ? 'bg-amber-900 text-amber-200' : 'text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
            title="Professor Speak"
          >
            {audioState === 'playing' ? (
               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
               </svg>
            ) : audioState === 'loading' ? (
               <div className="w-5 h-5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728" />
              </svg>
            )}
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest px-1">Speak</span>
          </button>
          
          <div className="w-px h-6 bg-zinc-700/50"></div>
          
          <button 
            onClick={() => openMenu('timeline')} 
            className="p-2.5 text-zinc-400 rounded-lg hover:bg-zinc-700 hover:text-white transition-all flex items-center space-x-2"
            title="Mathematical Timeline"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest px-1">Timeline</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        <div className="w-full md:w-[55%] bg-black flex flex-col items-center justify-center relative shadow-[inset_-20px_0_60px_rgba(0,0,0,0.9)] z-10">
          <div className="absolute inset-0 opacity-10 pointer-events-none overflow-hidden chalkboard-bg"></div>
          <div className="relative w-[92%] h-[85%] border border-zinc-800/50 rounded-xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] bg-zinc-900 group">
             {isGeneratingImage && (
               <div className="absolute inset-0 bg-zinc-950/80 z-20 flex items-center justify-center backdrop-blur-md">
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="mt-4 text-indigo-400 text-[10px] font-mono uppercase tracking-[0.4em] text-center px-6 animate-pulse">Calculating Visual Geometry...</span>
                  </div>
               </div>
             )}
             <img src={currentImage} alt="Mathematical Visualization" className="w-full h-full object-cover transition-all duration-1000 transform group-hover:scale-105" />
             <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent p-10 pointer-events-none">
                <div className="flex items-center space-x-2 mb-2">
                    <span className="h-px w-6 bg-indigo-500"></span>
                    <p className="text-indigo-400 text-[10px] font-mono tracking-[0.3em] uppercase font-bold">Scientific Insight</p>
                </div>
                <h3 className="text-white text-2xl md:text-3xl font-serif italic leading-tight drop-shadow-xl">{currentTopicLabel}</h3>
             </div>
          </div>
        </div>

        <div className="w-full md:w-[45%] flex flex-col bg-zinc-900 relative border-l border-zinc-800">
          <ChatInterface messages={messages} isTyping={isStreaming} />
          
          {isMenuOpen && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300" onClick={() => setIsMenuOpen(false)}>
              <div 
                className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl max-h-[85vh] rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-500 relative"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-8 border-b border-zinc-800 flex justify-between items-start">
                  <div>
                    <h2 className="text-3xl font-bold text-white font-['Playfair_Display']">
                      {activeMenuType === 'timeline' ? 'Mathematical Timeline' : "Professor's FAQs"}
                    </h2>
                    <p className="text-zinc-500 text-xs uppercase tracking-[0.3em] mt-3 font-mono">
                      {activeMenuType === 'timeline' ? 'The evolution of logic' : 'Inquire further into history'}
                    </p>
                  </div>
                  <button onClick={() => setIsMenuOpen(false)} className="p-2 text-zinc-500 hover:text-white transition-all transform hover:rotate-90">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                     </svg>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-4 custom-scrollbar">
                  {(activeMenuType === 'timeline' ? SECTIONS : FAQ_OPTIONS).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                          if (opt.id === 'stop') stopAudio();
                          else handleSendMessage(opt.prompt, (opt as any).label, activeMenuType === 'timeline');
                          setIsMenuOpen(false);
                      }}
                      className={`w-full text-left p-6 border transition-all rounded-2xl group relative overflow-hidden flex flex-col justify-center ${
                        opt.id === 'stop' 
                          ? 'border-rose-900/30 bg-rose-950/5 text-rose-300 hover:bg-rose-950/20' 
                          : 'border-zinc-800 bg-zinc-800/40 text-zinc-100 hover:bg-indigo-950/30 hover:border-indigo-500/50 hover:scale-[1.01]'
                      }`}
                    >
                      <div className="font-bold text-xl group-hover:text-white">
                        {opt.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="p-5 bg-zinc-950 border-t border-zinc-800">
            {!isStreaming && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (s.text === "OPEN_FAQ_MENU") openMenu('faqs');
                        else handleSendMessage(s.text, s.label, s.label.startsWith('Next:'));
                      }}
                      className={`px-4 py-2 text-[11px] font-bold rounded-lg transition-all border font-mono tracking-tight ${
                        s.label.startsWith('Next:') 
                          ? 'bg-indigo-900 border-indigo-400 text-white hover:bg-indigo-800' 
                          : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-400'
                      }`}
                    >
                      {s.label}
                    </button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input, undefined, false); }} className="flex space-x-2">
              <input 
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the Professor about the universe..."
                className="flex-1 bg-zinc-900 border border-zinc-800 px-5 py-4 outline-none font-sans text-sm rounded-xl text-white placeholder-zinc-600 transition-all focus:ring-1 focus:ring-indigo-500"
                disabled={isStreaming}
              />
              <button 
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="bg-indigo-600 text-white px-8 py-4 font-bold hover:bg-indigo-500 transition-all disabled:opacity-50 rounded-xl flex items-center justify-center min-w-[120px]"
              >
                {isStreaming ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : "Investigate"}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
