
import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, Suggestion } from './types';
import { sendMessageStream, generateScientificImage, generateSpeech, playAudioBuffer, warmupAudioContext, cancelAllPendingTTS } from './services/geminiService';
import { INITIAL_IMAGE } from './constants';
import { CHAPTER_CONTENT } from './data/chapters';
import ChatInterface from './components/ChatInterface';

const SECTIONS = [
  { id: 'stop', label: '■ Silence', prompt: 'STOP', chapterNum: -1 },
  { id: 'start', label: 'Introduction', prompt: 'Start', chapterNum: 0 },
  { id: 'ch1', label: 'Chapter 1: Foundations', prompt: 'Start at Chapter 1: Foundations', chapterNum: 1 },
  { id: 'ch2', label: 'Chapter 2: Calculus Revolution', prompt: 'Start at Chapter 2: The Calculus Revolution', chapterNum: 2 },
  { id: 'ch3', label: 'Chapter 3: Age of Analysis', prompt: 'Start at Chapter 3: The Age of Analysis', chapterNum: 3 },
  { id: 'ch4', label: 'Chapter 4: The Quantum Leap', prompt: 'Start at Chapter 4: The Quantum Leap', chapterNum: 4 },
  { id: 'ch5', label: 'Chapter 5: The Unified Theory', prompt: 'Start at Chapter 5: The Unified Theory', chapterNum: 5 },
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
    lastTriggeredPromptRef.current = null;
    
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
        setMessages(prev => prev.map(m => m.id === modelMsgId ? { ...m, text: "I believe there has been a glitch in the cosmic transmission. Let us try once more.", isStreaming: false } : m));
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
      const base64 = await generateScientificImage(prompt);
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

      next.push({ label: 'Explain the Math', text: "Professor, could you please explain the mathematical logic behind this?" });
      next.push({ label: 'New Visualization', text: "Can you provide a new scientific visualization of this concept? Please include a new [IMAGE: ...] tag." });
      next.push({ label: 'Timeline', text: "OPEN_CHAPTER_MENU" });
      setSuggestions(next);
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
               onClick={() => { setHasStarted(true); handleSendMessage('Start'); }}
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
            <p className="text-[10px] text-indigo-400 font-mono tracking-[0.3em] uppercase mt-1">Mathematical History</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={handleHearSpeak}
            className={`p-2.5 rounded-lg transition-all ${audioState !== 'idle' ? 'bg-indigo-600 text-white scale-110 shadow-[0_0_20px_rgba(79,70,229,0.5)]' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'}`}
            title="Listen to the Professor"
          >
            {audioState === 'playing' ? (
               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
               </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728" />
              </svg>
            )}
          </button>
          <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-2.5 bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 transition-all border border-zinc-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        <div className="w-full md:w-[55%] bg-black flex flex-col items-center justify-center relative shadow-[inset_-20px_0_60px_rgba(0,0,0,0.9)] z-10 transition-all duration-700">
          <div className="absolute inset-0 opacity-10 pointer-events-none overflow-hidden chalkboard-bg"></div>
          
          <div className="relative w-[92%] h-[85%] border border-zinc-800/50 rounded-xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] bg-zinc-900 group">
             {isGeneratingImage && (
               <div className="absolute inset-0 bg-zinc-950/80 z-20 flex items-center justify-center backdrop-blur-md">
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="mt-4 text-indigo-400 text-[10px] font-mono uppercase tracking-[0.4em] text-center px-6 animate-pulse">Calculating Visuals...</span>
                  </div>
               </div>
             )}
             <img src={currentImage} alt="Scientific Visualization" className="w-full h-full object-cover transition-all duration-1000 transform group-hover:scale-105" />
             
             <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent p-10 pointer-events-none">
                <div className="flex items-center space-x-2 mb-2">
                    <span className="h-px w-6 bg-indigo-500"></span>
                    <p className="text-indigo-400 text-[10px] font-mono tracking-[0.3em] uppercase font-bold">Concept Insight</p>
                </div>
                <h3 className="text-white text-2xl md:text-3xl font-serif italic leading-tight drop-shadow-xl">{currentTopicLabel}</h3>
             </div>
          </div>
        </div>

        <div className="w-full md:w-[45%] flex flex-col bg-zinc-900 relative border-l border-zinc-800">
          <ChatInterface messages={messages} isTyping={isStreaming} />
          
          {isMenuOpen && (
            <div className="absolute inset-0 bg-zinc-950/98 z-50 p-10 flex flex-col animate-in fade-in zoom-in-95 duration-500 overflow-hidden">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h2 className="text-3xl font-bold text-white font-['Playfair_Display'] leading-none">The Mathematical Journey</h2>
                  <p className="text-zinc-500 text-[10px] uppercase tracking-widest mt-2 font-mono">Navigate the evolution of logic</p>
                </div>
                <button onClick={() => setIsMenuOpen(false)} className="p-2 text-zinc-600 hover:text-white transition-all transform hover:rotate-90">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                   </svg>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar">
                {SECTIONS.map((sec) => (
                  <button
                    key={sec.id}
                    onClick={() => {
                        if (sec.id === 'stop') stopAudio();
                        else handleSendMessage(sec.prompt);
                        setIsMenuOpen(false);
                    }}
                    className={`text-left p-6 border transition-all rounded-xl group relative overflow-hidden flex flex-col justify-center ${
                      sec.id === 'stop' 
                        ? 'border-rose-900/40 bg-rose-950/10 text-rose-300 hover:bg-rose-950/20' 
                        : 'border-zinc-800 bg-zinc-900/40 text-zinc-100 hover:bg-indigo-950/20 hover:border-indigo-500/40'
                    }`}
                  >
                    <div className="font-bold text-xl group-hover:text-white transition-colors">
                      {sec.label}
                    </div>
                    <div className="text-[10px] opacity-40 uppercase tracking-[0.2em] font-mono mt-1">{sec.prompt === 'STOP' ? 'End Transmission' : 'Travel through time'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-5 bg-zinc-950 border-t border-zinc-800">
            {!isStreaming && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                {suggestions.map((s, i) => {
                  const isNextChapter = s.label.startsWith('Next:');
                  return (
                    <button
                      key={i}
                      onClick={() => s.text === "OPEN_CHAPTER_MENU" ? setIsMenuOpen(true) : handleSendMessage(s.text)}
                      className={`px-4 py-2 text-[11px] font-bold rounded-lg transition-all border font-mono tracking-tight ${
                        isNextChapter 
                          ? 'bg-indigo-900 border-indigo-400 text-white hover:bg-indigo-800' 
                          : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-400'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex space-x-2">
              <input 
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the Professor..."
                className="flex-1 bg-zinc-900 border border-zinc-800 px-5 py-4 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-sans text-sm rounded-xl text-white placeholder-zinc-600 transition-all shadow-inner"
                disabled={isStreaming}
              />
              <button 
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="bg-indigo-600 text-white px-8 py-4 font-bold hover:bg-indigo-500 transition-all disabled:opacity-50 rounded-xl shadow-lg active:scale-95 flex items-center justify-center min-w-[100px]"
              >
                {isStreaming ? (
                   <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  "Inquire"
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(79, 70, 229, 0.2); border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
