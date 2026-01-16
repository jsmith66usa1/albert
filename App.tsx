import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Era, Message, Chapter, LogEntry } from './types';
import { CHAPTERS } from './constants';
import { 
  generateEinsteinResponse, 
  generateChalkboardImage, 
  generateEinsteinSpeech,
  decode,
  decodeAudioData,
  getPerformanceLogs,
  clearPerformanceLogs
} from './services/geminiService';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentEra, setCurrentEra] = useState<Era>(Era.Introduction);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [lastImage, setLastImage] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<number | null>(null);
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const faqDropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentChapter = useMemo(() => CHAPTERS.find(c => c.id === currentEra), [currentEra]);

  const addSystemLog = (label: string, message: string, status: 'SUCCESS' | 'ERROR' | 'CACHE_HIT' = 'SUCCESS', metadata?: any) => {
    window.dispatchEvent(new CustomEvent('performance_log_updated', {
      detail: { type: 'SYSTEM', label, message, status, duration: 0, metadata }
    }));
  };

  // CLEANUP: Close AudioContext on unmount to prevent browser memory leaks
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  useEffect(() => {
    const updateLogs = () => setLogs([...getPerformanceLogs()]);
    window.addEventListener('performance_log_updated', updateLogs);
    updateLogs();
    return () => window.removeEventListener('performance_log_updated', updateLogs);
  }, []);

  useEffect(() => {
    if (isDarkMode) document.body.classList.remove('light-mode');
    else document.body.classList.add('light-mode');
  }, [isDarkMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsDropdownOpen(false);
      if (faqDropdownRef.current && !faqDropdownRef.current.contains(event.target as Node)) setIsFaqOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (messages.length > 0 && chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    const mathJax = (window as any).MathJax;
    if (mathJax && mathJax.typesetPromise) {
      mathJax.typesetPromise().catch((err: any) => console.debug('MathJax error:', err));
    }
  }, [messages]);

  const stopAudio = useCallback((silent: boolean = false) => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.onended = null;
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
        if (!silent) addSystemLog('Vocal Interruption', 'Playback halted.', 'SUCCESS');
      } catch (e) {
        console.debug('Audio stop failed:', e);
      }
      audioSourceRef.current = null;
    }
    setIsAudioPlaying(false);
    setCurrentlySpeakingId(null);
  }, []);

  const playSpeech = async (text: string, msgId: number) => {
    if (isLoading || !text) return; 
    if (currentlySpeakingId === msgId && isAudioPlaying) {
      stopAudio();
      return;
    }

    try {
      stopAudio(true); 
      setIsAudioPlaying(true);
      setCurrentlySpeakingId(msgId);
      
      const base64 = await generateEinsteinSpeech(text);
      if (!base64) throw new Error("No audio data generated.");

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const audioBuffer = await decodeAudioData(decode(base64), audioContextRef.current, 24000, 1);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => {
        setCurrentlySpeakingId(prev => {
           if (prev === msgId) {
             setIsAudioPlaying(false);
             return null;
           }
           return prev;
        });
        audioSourceRef.current = null;
        source.disconnect();
      };
      
      audioSourceRef.current = source;
      source.start();
    } catch (err: any) {
      setIsAudioPlaying(false);
      setCurrentlySpeakingId(null);
      addSystemLog('Audio Fault', `Synthesizer error: ${err.message}`, 'ERROR');
    }
  };

  const playLatestSpeech = () => {
    if (isLoading) return;
    const lastEinsteinMsg = messages.find(m => m.role === 'einstein');
    if (lastEinsteinMsg) {
      const idx = messages.indexOf(lastEinsteinMsg);
      playSpeech(lastEinsteinMsg.text, idx);
    }
  };

  const handleAction = async (promptText: string, eraToSet?: Era, isNewEra: boolean = false) => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    if (isNewEra) {
      stopAudio(true);
      setLastImage(null);
    }

    const history = isNewEra ? [] : [...messages].reverse().map(m => ({
      role: m.role === 'einstein' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }));

    try {
      const responseText = await generateEinsteinResponse(promptText, history);
      
      if (controller.signal.aborted) return;
      
      const safeResponse = responseText || "Ach, ze field equations... zey are not converging.";
      const imageMatch = safeResponse.match(/\[IMAGE: (.*?)\]/);
      const newMessage: Message = { role: 'einstein', text: safeResponse, timestamp: Date.now() };
      
      if (isNewEra) {
        setMessages([newMessage]);
      } else {
        setMessages(prev => [newMessage, ...prev]);
      }
      
      if (eraToSet) setCurrentEra(eraToSet);

      if (imageMatch) {
        const imagePrompt = imageMatch[1];
        setIsImageLoading(true);
        try {
          const imageUrl = await generateChalkboardImage(imagePrompt);
          if (!controller.signal.aborted && imageUrl) {
            setLastImage(imageUrl);
          }
        } catch (e: any) {
          if (!controller.signal.aborted) {
            addSystemLog('Visual Fault', `Diagram failed: ${e.message}`, 'ERROR');
          }
        } finally {
          if (!controller.signal.aborted) setIsImageLoading(false);
        }
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        addSystemLog('Critical Failure', `Synthesis loop crashed: ${err.message}`, 'ERROR');
        const fallbackMsg: Message = { role: 'einstein', text: "Forgive me, my friend. Let us try again.", timestamp: Date.now() };
        setMessages(prev => [fallbackMsg, ...prev]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  const startEra = (era: Era) => {
    setIsDropdownOpen(false);
    stopAudio(true);
    
    setMessages([]);
    setLastImage(null);
    setIsLoading(true);

    const chapter = CHAPTERS.find(c => c.id === era);
    if (chapter) {
      handleAction(chapter.prompt, era, true);
    } else {
      setIsLoading(false);
    }
  };

  const handleFaqInquiry = (type: 'detail' | 'applications' | 'figures') => {
    if (isLoading) return;
    setIsFaqOpen(false);
    let inquiry = "";
    switch(type) {
      case 'detail': inquiry = `Professor, explain the mathematics of ${currentEra} in deeper detail.`; break;
      case 'applications': inquiry = `Professor, how is the math from ${currentEra} used in modern science?`; break;
      case 'figures': inquiry = `Professor, who were the influential figures during the era of ${currentEra}?`; break;
    }
    const userMsg: Message = { role: 'user', text: inquiry, timestamp: Date.now() };
    setMessages(prev => [userMsg, ...prev]);
    handleAction(inquiry);
  };

  const handleNextChapter = () => {
    if (isLoading) return;
    const currentIndex = CHAPTERS.findIndex(c => c.id === currentEra);
    if (currentIndex !== -1 && currentIndex < CHAPTERS.length - 1) {
      startEra(CHAPTERS[currentIndex + 1].id);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', text: userInput, timestamp: Date.now() };
    setMessages(prev => [userMsg, ...prev]);
    const input = userInput;
    setUserInput('');
    handleAction(input);
  };

  const stars = useMemo(() => Array.from({ length: 100 }).map((_, i) => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: `${Math.random() * 2 + 0.5}px`,
    duration: `${Math.random() * 5 + 3}s`,
    delay: `${Math.random() * 5}s`
  })), []);

  return (
    <div className="flex flex-col h-full bg-theme text-theme">
      {!hasStarted && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative" style={{ backgroundColor: '#09090b', color: '#fff', position: 'fixed', inset: 0, zIndex: 1000 }}>
          <div className="absolute" style={{ inset: 0, overflow: 'hidden' }}>
            {stars.map((star, i) => (
              <div key={i} className="star" style={{ top: star.top, left: star.left, width: star.size, height: star.size, '--duration': star.duration, animationDelay: star.delay } as any} />
            ))}
          </div>
          <div className="glass p-6 flex flex-col items-center text-center relative z-50 shadow-2xl" style={{ maxWidth: '500px', borderRadius: '4rem', padding: '3.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ marginBottom: '2.5rem', borderRadius: '2.5rem', overflow: 'hidden', border: '2px solid rgba(99, 102, 241, 0.4)', width: '180px', height: '180px' }}>
              <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/480px-Albert_Einstein_Head.jpg" alt="Einstein" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <h1 className="serif" style={{ fontSize: '2.8rem', fontWeight: 900, marginBottom: '0.75rem', color: 'white' }}>Einstein's Universe</h1>
            <p className="serif" style={{ color: '#d1d1d6', fontStyle: 'italic', marginBottom: '3rem', fontSize: '1.1rem' }}>"Knowledge is limited, imagination encircles the world."</p>
            <button onClick={() => { setHasStarted(true); startEra(Era.Introduction); }} style={{ width: '100%', padding: '1.25rem', backgroundColor: '#6366f1', color: '#fff', borderRadius: '1.5rem', fontWeight: 900 }}>ENTER LABORATORY</button>
          </div>
        </div>
      )}

      <header className="header flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--accent)', fontWeight: 900, color: '#fff' }}>AE</div>
          <h1 className="serif lg-block hidden" style={{ fontSize: '1.3rem', fontWeight: 900 }}>Einstein's Universe</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsLogOpen(true)} style={{ padding: '0.6rem 1rem', borderRadius: '0.75rem', fontSize: '10px', fontWeight: 900 }}>LOG</button>
          <button 
            onClick={playLatestSpeech} 
            disabled={isLoading || messages.length === 0}
            style={{ 
              padding: '0.6rem 1.25rem', 
              borderRadius: '0.75rem', 
              fontSize: '10px', 
              fontWeight: 900, 
              backgroundColor: isAudioPlaying ? '#ef4444' : 'var(--accent)', 
              color: '#fff', 
              opacity: (isLoading || messages.length === 0) ? 0.5 : 1,
              border: 'none' 
            }}
          >
            {isAudioPlaying ? 'MUTE' : 'LISTEN'}
          </button>
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => !isLoading && setIsDropdownOpen(!isDropdownOpen)} disabled={isLoading} style={{ padding: '0.6rem 1rem', borderRadius: '0.75rem', fontSize: '11px', fontWeight: 800, color: 'var(--accent)', minWidth: '160px', opacity: isLoading ? 0.7 : 1 }}>
              {currentChapter?.id}
            </button>
            {isDropdownOpen && (
              <div className="absolute z-50" style={{ top: '100%', right: 0, marginTop: '0.5rem', width: '280px', borderRadius: '1.25rem', padding: '0.75rem 0', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(20px)' }}>
                {CHAPTERS.map(ch => (
                  <button key={ch.id} onClick={() => startEra(ch.id)} style={{ width: '100%', textAlign: 'left', padding: '0.6rem 1.5rem', fontSize: '10px', fontWeight: 800, color: currentEra === ch.id ? 'var(--accent)' : 'inherit', border: 'none', background: 'transparent' }}>
                    {ch.id}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setIsDarkMode(!isDarkMode)} style={{ width: '42px', height: '42px', borderRadius: '0.75rem' }}>
            {isDarkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <div className="main-content">
        <section className="chat-sidebar no-scrollbar">
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto no-scrollbar scroll-smooth" style={{ padding: '2rem' }}>
            {isLoading && <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '10px', fontWeight: 900, padding: '1rem', letterSpacing: '0.1em' }}>CONSULTING WORLD BRAIN...</div>}
            {messages.length === 0 && !isLoading && (
               <div style={{ textAlign: 'center', opacity: 0.3, marginTop: '4rem', fontSize: '12px', fontWeight: 800 }}>AWAITING OBSERVATION</div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className="flex" style={{ justifyContent: msg.role === 'einstein' ? 'flex-start' : 'flex-end' }}>
                <div 
                  className={`msg-container ${msg.role === 'einstein' ? 'bg-einstein' : 'bg-user'} ${isLoading ? '' : 'cursor-pointer'}`}
                  onClick={() => !isLoading && msg.role === 'einstein' && playSpeech(msg.text, idx)}
                >
                  <div className="serif" style={{ fontSize: '1.15rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                  {msg.role === 'einstein' && (
                    <div style={{ marginTop: '0.5rem', opacity: 0.4, fontSize: '9px', fontWeight: 900 }}>
                      {currentlySpeakingId === idx && isAudioPlaying ? 'SPEAKING...' : isLoading ? 'THINKING...' : 'CLICK TO HEAR'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="chalkboard-area">
          <div className="flex flex-col items-center justify-center w-full h-full relative">
            {isImageLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm rounded-3xl animate-pulse">
                <span style={{ fontSize: '24px', marginBottom: '1rem' }}>✍️</span>
                <p style={{ fontWeight: 900, fontSize: '11px', letterSpacing: '0.2em', color: '#fff' }}>MANIFESTING THEORY...</p>
              </div>
            )}
            {lastImage ? (
              <img 
                src={lastImage} 
                className={`chalkboard-filter transition-opacity duration-700 ${isImageLoading ? 'opacity-30' : 'opacity-100'}`} 
                alt="Manifested Theory" 
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ opacity: 0.2, fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5em', textAlign: 'center' }}>
                {isImageLoading ? 'Active Observation...' : 'Awaiting Theory'}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="footer z-50">
        <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="flex gap-3" style={{ marginBottom: '1.25rem' }}>
             <button onClick={() => handleAction(`Professor, manifest a diagram for: ${currentEra}.`)} disabled={isLoading} style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900, opacity: isLoading ? 0.5 : 1 }}>SHOW DIAGRAM</button>
             <div className="relative" ref={faqDropdownRef}>
                <button onClick={() => !isLoading && setIsFaqOpen(!isFaqOpen)} disabled={isLoading} style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900, opacity: isLoading ? 0.5 : 1 }}>ARCHIVE {isFaqOpen ? '▴' : '▾'}</button>
                {isFaqOpen && (
                  <div className="absolute z-[100]" style={{ bottom: '100%', left: 0, marginBottom: '0.6rem', width: '220px', borderRadius: '1.25rem', padding: '0.5rem', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(20px)' }}>
                    {['detail', 'applications', 'figures'].map(type => (
                      <button key={type} onClick={() => handleFaqInquiry(type as any)} style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', fontSize: '9px', fontWeight: 800, border: 'none', background: 'transparent' }}>Archive: {type}</button>
                    ))}
                  </div>
                )}
             </div>
             <button onClick={handleNextChapter} disabled={currentEra === Era.Unified || isLoading} style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900, opacity: (currentEra === Era.Unified || isLoading) ? 0.5 : 1 }}>NEXT CHAPTER</button>
          </div>
          <form onSubmit={handleSendMessage} className="relative">
            <input type="text" data-gramm-false="true" value={userInput} onChange={(e) => setUserInput(e.target.value)} disabled={isLoading} placeholder={isLoading ? "The Professor is deep in thought..." : "Query the Professor..."} />
            <button type="submit" disabled={isLoading || !userInput.trim()} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', backgroundColor: 'var(--accent)', color: '#fff', padding: '0.6rem 1.2rem', borderRadius: '1rem', fontWeight: 900, border: 'none', opacity: (isLoading || !userInput.trim()) ? 0.5 : 1 }}>ANALYZE</button>
          </form>
        </div>
      </footer>

      {isLogOpen && (
        <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-start p-4 md:p-12 overflow-hidden" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="bg-theme border-theme flex flex-col shadow-2xl w-full h-full max-w-6xl animate-modal-in" style={{ borderRadius: '2.5rem', overflow: 'hidden', background: 'var(--glass-bg)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between p-8 border-b border-theme bg-opacity-50" style={{ background: 'rgba(0,0,0,0.1)' }}>
              <div className="flex flex-col"><h2 className="serif" style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.02em' }}>Observer's Telemetry</h2><span style={{ fontSize: '12px', opacity: 0.5, fontWeight: 500, marginTop: '4px' }}>Technical and registry synchronization data.</span></div>
              <button onClick={() => setIsLogOpen(false)} style={{ width: '48px', height: '48px', borderRadius: '50%', fontSize: '18px', fontWeight: 900, border: 'none', background: 'var(--accent)', color: '#fff' }}>✕</button>
            </div>
            <div ref={logScrollRef} className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 font-mono no-scrollbar" style={{ scrollBehavior: 'smooth' }}>
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 opacity-20"><span style={{ fontSize: '64px', marginBottom: '2rem' }}>📡</span><p style={{ fontWeight: 900, fontSize: '14px', letterSpacing: '0.2em' }}>NO TELEMETRY RECORDED</p></div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-6 border-theme rounded-2xl transition-all hover:translate-x-1" style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderLeft: `6px solid ${log.status === 'ERROR' ? '#ef4444' : log.status === 'CACHE_HIT' ? '#10b981' : 'var(--accent)'}` }}>
                    <div className="flex justify-between items-start mb-3"><div className="flex items-center gap-3"><span style={{ fontSize: '11px', fontWeight: 900, color: 'var(--accent)', background: 'rgba(99, 102, 241, 0.1)', padding: '4px 10px', borderRadius: '6px' }}>{log.type}</span><span style={{ fontSize: '11px', opacity: 0.4, fontWeight: 800 }}>{new Date(log.timestamp).toLocaleTimeString()}</span></div><span style={{ fontSize: '11px', opacity: 0.6, fontWeight: 900 }}>{Math.round(log.duration)}MS</span></div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '6px', color: 'var(--text-color)' }}>{log.label}</div>
                    <div style={{ fontSize: '13px', opacity: 0.7, lineHeight: 1.5 }}>{log.message}</div>
                    {log.metadata && (
                      <div className="mt-4 p-4 rounded-lg bg-black bg-opacity-30 text-xs overflow-x-auto">
                        <pre style={{ color: '#fff' }}>{JSON.stringify(log.metadata, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: translateY(-40px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-modal-in { animation: modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>
    </div>
  );
};

export default App;