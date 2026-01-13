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
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const faqDropdownRef = useRef<HTMLDivElement>(null);

  const currentChapter = useMemo(() => CHAPTERS.find(c => c.id === currentEra), [currentEra]);

  useEffect(() => {
    const updateLogs = () => setLogs([...getPerformanceLogs()]);
    window.addEventListener('performance_log_updated', updateLogs);
    updateLogs();
    return () => window.removeEventListener('performance_log_updated', updateLogs);
  }, []);

  useEffect(() => {
    if (isLogOpen && logScrollRef.current) {
      logScrollRef.current.scrollTop = 0;
    }
  }, [isLogOpen]);

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
    if (messages.length > 0) {
      if (messages.length === 1 && chatContainerRef.current) {
        chatContainerRef.current.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    if ((window as any).MathJax) {
      (window as any).MathJax.typesetPromise?.().catch(() => null);
    }
  }, [messages]);

  const stopAudio = useCallback(() => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch (e) {}
      audioSourceRef.current = null;
    }
    setIsAudioPlaying(false);
    setCurrentlySpeakingId(null);
  }, []);

  const playSpeech = async (text: string, msgId: number) => {
    if (currentlySpeakingId === msgId && isAudioPlaying) {
      stopAudio();
      return;
    }
    try {
      stopAudio();
      setIsAudioPlaying(true);
      setCurrentlySpeakingId(msgId);
      const base64 = await generateEinsteinSpeech(text);
      if (!base64) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const audioBuffer = await decodeAudioData(decode(base64), audioContextRef.current, 24000, 1);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => {
        setIsAudioPlaying(false);
        setCurrentlySpeakingId(null);
      };
      audioSourceRef.current = source;
      source.start();
    } catch (err: any) {
      if (err.name !== 'Canceled') {
        setIsAudioPlaying(false);
        setCurrentlySpeakingId(null);
      }
    }
  };

  const playLatestSpeech = () => {
    let lastIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'einstein') {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx !== -1) playSpeech(messages[lastIdx].text, lastIdx);
  };

  const handleAction = async (promptText: string, eraToSet?: Era, isNewEra: boolean = false) => {
    setIsLoading(true);
    const history = isNewEra ? [] : messages.map(m => ({
      role: m.role === 'einstein' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }));

    try {
      const responseText = await generateEinsteinResponse(promptText, history);
      if (!responseText) return;

      const imageMatch = responseText.match(/\[IMAGE: (.*?)\]/);
      let cleanedText = responseText;
      const newMessage: Message = { role: 'einstein', text: cleanedText, timestamp: Date.now() };
      
      if (isNewEra) {
        setMessages([newMessage]);
        if (chatContainerRef.current) {
           chatContainerRef.current.scrollTo({ top: 0, behavior: 'auto' });
        }
      } else {
        setMessages(prev => [...prev, newMessage]);
      }
      
      if (eraToSet) setCurrentEra(eraToSet);

      if (imageMatch) {
        const imagePrompt = imageMatch[1];
        cleanedText = responseText.replace(imageMatch[0], '').trim();
        try {
          const imageUrl = await generateChalkboardImage(imagePrompt);
          if (imageUrl) setLastImage(imageUrl);
        } catch (e: any) {
          if (e.name !== 'Canceled') console.error("Image Manifestation Failed", e);
        }
      }
    } catch (err: any) {
      if (err.name !== 'Canceled') console.error("Synthesis failed", err);
    } finally {
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
      case 'figures': inquiry = `Professor, who were the influential figures or pioneers during the era of ${currentEra}?`; break;
    }
    const userMsg: Message = { role: 'user', text: inquiry, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    handleAction(inquiry);
  };

  const startEra = (era: Era) => {
    if (isLoading) return;
    setIsDropdownOpen(false);
    const chapter = CHAPTERS.find(c => c.id === era);
    if (chapter) {
      if (chatContainerRef.current) chatContainerRef.current.scrollTo({ top: 0 });
      setMessages([]);
      handleAction(chapter.prompt, era, true);
    }
  };

  const handleNextChapter = () => {
    if (isLoading) return;
    const currentIndex = CHAPTERS.findIndex(c => c.id === currentEra);
    if (currentIndex !== -1 && currentIndex < CHAPTERS.length - 1) {
      startEra(CHAPTERS[currentIndex + 1].id);
    }
  };

  const handleStartExperience = () => {
    setHasStarted(true);
    startEra(Era.Introduction);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', text: userInput, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    const input = userInput;
    setUserInput('');
    handleAction(input);
  };

  const handleExportForStudio = () => {
    const diagnosticBundle = {
      session: {
        timestamp: new Date().toISOString(),
        currentEra,
        messageCount: messages.length,
      },
      telemetry: logs.map(log => ({
        ...log,
        studio_formatted_time: new Date(log.timestamp).toISOString(),
      })),
      context: messages.slice(-5) // Send last few messages for context
    };
    const blob = new Blob([JSON.stringify(diagnosticBundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `einstein-studio-telemetry-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
            <button onClick={handleStartExperience} style={{ width: '100%', padding: '1.25rem', backgroundColor: '#6366f1', color: '#fff', borderRadius: '1.5rem', fontWeight: 900 }}>ENTER LABORATORY</button>
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
          <button onClick={playLatestSpeech} style={{ padding: '0.6rem 1.25rem', borderRadius: '0.75rem', fontSize: '10px', fontWeight: 900, backgroundColor: isAudioPlaying ? '#ef4444' : 'var(--accent)', color: '#fff', border: 'none' }}>
            {isAudioPlaying ? 'MUTE' : 'LISTEN'}
          </button>
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => !isLoading && setIsDropdownOpen(!isDropdownOpen)} disabled={isLoading} style={{ padding: '0.6rem 1rem', borderRadius: '0.75rem', fontSize: '11px', fontWeight: 800, color: 'var(--accent)', minWidth: '160px' }}>
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
        <section className="chat-sidebar">
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto no-scrollbar scroll-smooth" style={{ padding: '2rem' }}>
            {messages.map((msg, idx) => (
              <div key={idx} className="flex" style={{ justifyContent: msg.role === 'einstein' ? 'flex-start' : 'flex-end' }}>
                <div className={`msg-container ${msg.role === 'einstein' ? 'bg-einstein' : 'bg-user'}`}>
                  <div className="serif" style={{ fontSize: '1.15rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                </div>
              </div>
            ))}
            {isLoading && <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '10px', fontWeight: 900, padding: '1rem' }}>SOLVING FIELD EQUATIONS...</div>}
            <div ref={chatEndRef} style={{ height: '1px' }} />
          </div>
        </section>

        <section className="chalkboard-area">
          <div className="flex items-center justify-center w-full h-full">
            {lastImage ? (
              <img src={lastImage} className="chalkboard-filter" alt="Manifested Theory" />
            ) : (
              <div style={{ opacity: 0.2, fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5em' }}>
                Awaiting Observation
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="footer z-50">
        <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="flex gap-3" style={{ marginBottom: '1.25rem' }}>
             <button 
                onClick={() => handleAction(`Professor, manifest a diagram for: ${currentEra}.`)} 
                disabled={isLoading}
                style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900 }}
              >
                SHOW DIAGRAM
              </button>
             
             <div className="relative" ref={faqDropdownRef}>
                <button 
                  onClick={() => !isLoading && setIsFaqOpen(!isFaqOpen)} 
                  disabled={isLoading}
                  style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900 }}
                >
                  ARCHIVE {isFaqOpen ? '▴' : '▾'}
                </button>
                {isFaqOpen && (
                  <div className="absolute z-[100]" style={{ bottom: '100%', left: 0, marginBottom: '0.6rem', width: '220px', borderRadius: '1.25rem', padding: '0.5rem', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(20px)' }}>
                    {['detail', 'applications', 'figures'].map(type => (
                      <button key={type} onClick={() => handleFaqInquiry(type as any)} style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', fontSize: '9px', fontWeight: 800, border: 'none', background: 'transparent' }}>
                        Archive: {type}
                      </button>
                    ))}
                  </div>
                )}
             </div>

             <button 
                onClick={handleNextChapter} 
                disabled={currentEra === Era.Unified || isLoading} 
                style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900 }}
              >
                NEXT CHAPTER
              </button>
          </div>
          
          <form onSubmit={handleSendMessage} className="relative">
            <input 
              type="text" 
              data-gramm-false="true"
              value={userInput} 
              onChange={(e) => setUserInput(e.target.value)} 
              disabled={isLoading}
              placeholder={isLoading ? "The Professor is thinking..." : "Query the Professor..."} 
            />
            <button type="submit" disabled={isLoading || !userInput.trim()} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', backgroundColor: 'var(--accent)', color: '#fff', padding: '0.6rem 1.2rem', borderRadius: '1rem', fontWeight: 900, border: 'none' }}>
              ANALYZE
            </button>
          </form>
        </div>
      </footer>

      {isLogOpen && (
        <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-start p-4 md:p-12 overflow-hidden" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="bg-theme border-theme flex flex-col shadow-2xl w-full h-full max-w-6xl animate-modal-in" style={{ borderRadius: '2.5rem', overflow: 'hidden', background: 'var(--glass-bg)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between p-8 border-b border-theme bg-opacity-50" style={{ background: 'rgba(0,0,0,0.1)' }}>
              <div className="flex flex-col">
                <h2 className="serif" style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.02em' }}>Observer's Telemetry</h2>
                <span style={{ fontSize: '12px', opacity: 0.5, fontWeight: 500, marginTop: '4px' }}>Technical execution and registry synchronization data.</span>
              </div>
              <div className="flex gap-4 items-center">
                <button 
                  onClick={handleExportForStudio} 
                  style={{ padding: '0.7rem 1.2rem', borderRadius: '1rem', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', background: '#10b981', color: '#fff', border: 'none' }}
                >
                  EXPORT FOR STUDIO
                </button>
                <button 
                  onClick={() => { clearPerformanceLogs(); setLogs([]); }} 
                  style={{ padding: '0.7rem 1.2rem', borderRadius: '1rem', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' }}
                >
                  RESET REGISTRY
                </button>
                <button 
                  onClick={() => setIsLogOpen(false)} 
                  style={{ width: '48px', height: '48px', borderRadius: '50%', fontSize: '18px', fontWeight: 900, border: 'none', background: 'var(--accent)', color: '#fff' }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div 
              ref={logScrollRef}
              className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 font-mono no-scrollbar" 
              style={{ scrollBehavior: 'smooth' }}
            >
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 opacity-20">
                  <span style={{ fontSize: '64px', marginBottom: '2rem' }}>📡</span>
                  <p style={{ fontWeight: 900, fontSize: '14px', letterSpacing: '0.2em' }}>NO TELEMETRY RECORDED</p>
                </div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-6 border-theme rounded-2xl transition-all hover:translate-x-1" style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderLeft: `6px solid ${log.status === 'ERROR' ? '#ef4444' : log.status === 'CACHE_HIT' ? '#10b981' : 'var(--accent)'}` }}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                         <span style={{ fontSize: '11px', fontWeight: 900, color: 'var(--accent)', background: 'rgba(99, 102, 241, 0.1)', padding: '4px 10px', borderRadius: '6px' }}>{log.type}</span>
                         <span style={{ fontSize: '11px', opacity: 0.4, fontWeight: 800 }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <span style={{ fontSize: '11px', opacity: 0.6, fontWeight: 900 }}>{Math.round(log.duration)}MS</span>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '6px', color: 'var(--text-color)' }}>{log.label}</div>
                    <div style={{ fontSize: '13px', opacity: 0.7, lineHeight: 1.5 }}>{log.message}</div>
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