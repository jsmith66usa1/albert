
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Era, Message, LogEntry } from './types';
import { CHAPTERS } from './constants';
import { 
  generateEinsteinResponse, 
  generateChalkboardImage, 
  generateEinsteinSpeech,
  decode,
  decodeAudioData,
  getPerformanceLogs
} from './services/geminiService';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Error Boundary for UI stability
// Fix: Correctly extending React.Component with Props and State types
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("UI Crash:", error, errorInfo); }
  render() {
    // Fix: Accessing state and props correctly
    if (this.state.hasError) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff', textAlign: 'center', padding: '2rem' }}>
          <h1 className="serif">Ach, ze universe has collapsed!</h1>
          <p>A mathematical error has occurred in the rendering engine.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '2rem', background: '#6366f1', color: '#fff', padding: '1rem 2rem' }}>Re-initialize Laboratory</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const EinsteinApp: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentEra, setCurrentEra] = useState<Era>(Era.Introduction);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isSpeechLoading, setIsSpeechLoading] = useState(false);
  const [lastImage, setLastImage] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<number | null>(null);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSources = useRef<AudioBufferSourceNode[]>([]);
  const speechSessionId = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const faqRef = useRef<HTMLDivElement>(null);

  const eraArchiveItems = useMemo(() => {
    const baseItems = [
      { label: "Visual Analysis: Draw Diagram", prompt: `Professor, please draw a detailed chalkboard diagram explaining the core concept of ${currentEra}.` },
      { label: "Modern Applications", prompt: `Professor, how does ${currentEra} apply to our world today?` },
      { label: "Historical Rivals", prompt: `Who were the other great minds debating these ideas during the era of ${currentEra}?` }
    ];

    switch (currentEra) {
      case Era.Zero:
        return [...baseItems, { label: "Brahmagupta's Wisdom", prompt: "What were the specific rules for the 'void' set by the great Indian mathematician Brahmagupta?" }];
      case Era.Geometry:
        return [...baseItems, { label: "Euclid of Alexandria", prompt: "Tell me about Euclid and why his 'Elements' is the most successful textbook in history." }];
      case Era.Algebra:
        return [...baseItems, { label: "Al-Khwarizmi", prompt: "Tell me about the House of Wisdom in Baghdad and the birth of Algebra." }];
      case Era.Calculus:
        return [...baseItems, { label: "Leibniz & The Notation", prompt: "Tell me about Gottfried Wilhelm Leibniz and his beautiful 'd/dx' notation." }];
      case Era.Quantum:
        return [...baseItems, { label: "Niels Bohr", prompt: "Tell me about my friendly debates with Niels Bohr and the principle of complementarity." }];
      case Era.Unified:
        return [...baseItems, { label: "The Search for Harmony", prompt: "Who are the modern physicists carrying on the search for the Unified Theory?" }];
      default:
        return baseItems;
    }
  }, [currentEra]);

  useEffect(() => {
    const updateLogs = () => setLogs([...getPerformanceLogs()]);
    window.addEventListener('performance_log_updated', updateLogs);
    return () => window.removeEventListener('performance_log_updated', updateLogs);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsDropdownOpen(false);
      if (faqRef.current && !faqRef.current.contains(event.target as Node)) setIsFaqOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isDarkMode) document.body.classList.remove('light-mode');
    else document.body.classList.add('light-mode');
  }, [isDarkMode]);

  useEffect(() => {
    const mathJax = (window as any).MathJax;
    if (mathJax?.typesetPromise && messages.length > 0) {
      const timer = setTimeout(() => {
        try { mathJax.typesetPromise().catch(() => {}); } catch (e) {}
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  const stopAudio = useCallback(() => {
    speechSessionId.current++;
    activeSources.current.forEach(s => { 
      try { s.stop(); s.disconnect(); } catch (e) {} 
    });
    activeSources.current = [];
    setIsAudioPlaying(false);
    setIsSpeechLoading(false);
    setCurrentlySpeakingId(null);
  }, []);

  const playChunkedSpeech = async (text: string, msgId: number) => {
    if (currentlySpeakingId === msgId && (isAudioPlaying || isSpeechLoading)) {
      stopAudio();
      return;
    }

    stopAudio();
    const thisSessionId = speechSessionId.current;
    setIsSpeechLoading(true);
    setCurrentlySpeakingId(msgId);

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

      const cleanText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
      const rawChunks = cleanText.split(/(?<=[.!?])\s+/);
      const chunks: string[] = [];
      let currentBuffer = "";
      
      for (const chunk of rawChunks) {
        if ((currentBuffer.length + chunk.length) < 300) {
          currentBuffer += (currentBuffer ? " " : "") + chunk;
        } else {
          if (currentBuffer) chunks.push(currentBuffer);
          currentBuffer = chunk;
        }
      }
      if (currentBuffer) chunks.push(currentBuffer);

      let nextStartTime = audioContextRef.current.currentTime + 0.1;
      
      for (let i = 0; i < chunks.length; i++) {
        if (thisSessionId !== speechSessionId.current) return;
        const base64 = await generateEinsteinSpeech(chunks[i]);
        if (thisSessionId !== speechSessionId.current || !base64) continue;
        const buffer = await decodeAudioData(decode(base64), audioContextRef.current, 24000, 1);
        if (i === 0) {
          setIsSpeechLoading(false);
          setIsAudioPlaying(true);
        }
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        const startTime = Math.max(nextStartTime, audioContextRef.current.currentTime);
        source.start(startTime);
        nextStartTime = startTime + buffer.duration;
        activeSources.current.push(source);
        source.onended = () => {
          if (thisSessionId !== speechSessionId.current) return;
          activeSources.current = activeSources.current.filter(s => s !== source);
          if (activeSources.current.length === 0 && i === chunks.length - 1) stopAudio();
        };
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 2200)); 
      }
    } catch (e) {
      if (thisSessionId === speechSessionId.current) stopAudio();
    }
  };

  const playLatestSpeech = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    e.preventDefault();
    const lastEinsteinMsg = messages.find(m => m.role === 'einstein');
    if (lastEinsteinMsg) playChunkedSpeech(lastEinsteinMsg.text, messages.indexOf(lastEinsteinMsg));
  };

  const handleAction = async (promptText: string, eraToSet?: Era, isNewEra: boolean = false) => {
    if (isLoading) return; 
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setIsFaqOpen(false);
    setIsDropdownOpen(false);
    stopAudio();

    if (isNewEra) setLastImage(null);
    const history = isNewEra ? [] : [...messages].reverse().map(m => ({
      role: m.role === 'einstein' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }));

    try {
      const responseText = await generateEinsteinResponse(promptText, history);
      if (controller.signal.aborted) return;
      const safeResponse = responseText || "Ach, ze universe is shy today.";
      const imageMatch = safeResponse.match(/\[IMAGE: (.*?)\]/);
      const newMessage: Message = { role: 'einstein', text: safeResponse, timestamp: Date.now() };
      setMessages(prev => isNewEra ? [newMessage] : [newMessage, ...prev]);
      if (eraToSet) setCurrentEra(eraToSet);

      if (imageMatch) {
        setIsImageLoading(true);
        try {
          const imageUrl = await generateChalkboardImage(imageMatch[1]);
          if (!controller.signal.aborted && imageUrl) setLastImage(imageUrl);
        } catch (e) {} finally {
          if (!controller.signal.aborted) setIsImageLoading(false);
        }
      }
    } catch (err) {
      console.error("Action error:", err);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  const startEra = (era: Era) => {
    if (isLoading) return;
    setIsDropdownOpen(false);
    setMessages([]);
    setLastImage(null);
    const chapter = CHAPTERS.find(c => c.id === era);
    if (chapter) handleAction(chapter.prompt, era, true);
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userInput.trim() && !isLoading) {
      const text = userInput;
      setUserInput('');
      if (inputRef.current) inputRef.current.blur();
      handleAction(text);
    }
  };

  return (
    <div className="flex flex-col h-full bg-theme text-theme" style={{ height: '100vh', width: '100vw' }}>
      {!hasStarted && (
        <div className="welcome-screen">
          <button type="button" className="welcome-btn" onClick={() => { setHasStarted(true); startEra(Era.Introduction); }}>
            <div style={{ marginBottom: '2rem', width: '240px', height: '240px', borderRadius: '50%', overflow: 'hidden', border: '4px solid rgba(255,255,255,0.2)', boxShadow: '0 0 50px rgba(99, 102, 241, 0.3)' }}>
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/480px-Albert_Einstein_Head.jpg" 
                alt="Albert Einstein"
                style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'sepia(0.3) contrast(1.1)' }}
              />
            </div>
            <h1 className="serif">Einstein's Universe</h1>
            <p className="serif">"Imagination is more important than knowledge. For knowledge is limited, whereas imagination embraces the entire world."</p>
            <div className="cta">Enter Laboratory</div>
          </button>
        </div>
      )}

      <header className="header flex items-center justify-between z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center justify-center" style={{ width: '48px', height: '48px', borderRadius: '14px', backgroundColor: 'var(--accent)', fontWeight: 900, color: '#fff', fontSize: '1.2rem' }}>AE</div>
          <h1 className="serif lg-block hidden" style={{ fontSize: '1.6rem', fontWeight: 900 }}>Einstein's Universe</h1>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setIsLogOpen(true)} style={{ fontSize: '0.9rem' }}>LOGS</button>
          <button 
            type="button" 
            onPointerDown={playLatestSpeech} 
            disabled={isLoading || messages.length === 0} 
            style={{ minWidth: '130px', backgroundColor: (isAudioPlaying || isSpeechLoading) ? '#ef4444' : 'var(--accent)', color: '#fff', border: 'none', opacity: (isLoading || messages.length === 0) ? 0.5 : 1 }}
          >
            {isSpeechLoading ? 'LOADING...' : isAudioPlaying ? 'STOP' : 'LISTEN'}
          </button>
          <div className="relative" ref={dropdownRef}>
            <button type="button" onClick={() => !isLoading && setIsDropdownOpen(!isDropdownOpen)} disabled={isLoading} style={{ color: 'var(--accent)', minWidth: '180px', opacity: isLoading ? 0.6 : 1 }}>
              {currentEra} ▾
            </button>
            {isDropdownOpen && (
              <div className="absolute z-50" style={{ top: '100%', right: 0, marginTop: '0.75rem', width: '280px', borderRadius: '1.5rem', padding: '0.75rem 0', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(30px)', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
                {CHAPTERS.map(ch => (
                  <button key={ch.id} type="button" onClick={() => startEra(ch.id)} disabled={isLoading} style={{ width: '100%', textAlign: 'left', padding: '1rem 1.5rem', fontSize: '1.1rem', fontWeight: 800, color: currentEra === ch.id ? 'var(--accent)' : 'inherit', border: 'none', background: 'transparent', opacity: isLoading ? 0.5 : 1 }}>
                    {ch.id}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setIsDarkMode(!isDarkMode)} style={{ width: '48px', height: '48px', padding: 0, fontSize: '1.4rem' }}>{isDarkMode ? '☀️' : '🌙'}</button>
        </div>
      </header>

      <div className="main-content">
        <section className="chat-sidebar no-scrollbar">
          <div className="flex-1 overflow-y-auto no-scrollbar" style={{ padding: '2rem' }}>
            {isLoading && <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '1rem', fontWeight: 900, padding: '1.5rem' }}>CONSULTING RELATIVITY...</div>}
            {messages.map((msg, idx) => (
              <div key={idx} className="flex" style={{ justifyContent: msg.role === 'einstein' ? 'flex-start' : 'flex-end' }}>
                <div className={`msg-container ${msg.role === 'einstein' ? 'bg-einstein' : 'bg-user'} cursor-pointer`} onClick={() => msg.role === 'einstein' && playChunkedSpeech(msg.text, idx)}>
                  <div className="serif" style={{ fontSize: '1.25rem' }}>{msg.text}</div>
                  {msg.role === 'einstein' && (
                    <div style={{ marginTop: '0.8rem', opacity: 0.5, fontSize: '0.85rem', fontWeight: 900, letterSpacing: '0.05em' }}>
                      {currentlySpeakingId === idx && isSpeechLoading ? 'LOADING...' : currentlySpeakingId === idx && isAudioPlaying ? 'SPEAKING...' : 'TAP TO LISTEN'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="chalkboard-area">
          <div className="flex flex-col items-center justify-center w-full h-full relative">
            {isImageLoading && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 rounded-[2.5rem] animate-pulse"><p style={{ fontWeight: 900, fontSize: '1.2rem', color: '#fff' }}>SKETCHING...</p></div>}
            {lastImage ? <img src={lastImage} className="chalkboard-filter" alt="Theory" /> : <div style={{ opacity: 0.15, fontWeight: 900, fontSize: '1.3rem', letterSpacing: '0.2em' }}>AWAITING OBSERVATION</div>}
          </div>
        </section>
      </div>

      <footer className="footer z-50">
        <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="flex gap-4" style={{ marginBottom: '1rem' }}>
             <button type="button" onClick={() => handleAction(`Professor, show me more math for ${currentEra}.`)} disabled={isLoading} style={{ opacity: isLoading ? 0.6 : 1 }}>
               DEEPER MATHEMATICS
             </button>
             <div className="relative" ref={faqRef}>
                <button type="button" onClick={() => !isLoading && setIsFaqOpen(!isFaqOpen)} disabled={isLoading} style={{ color: 'var(--accent)', opacity: isLoading ? 0.6 : 1, minWidth: '150px' }}>
                  ARCHIVE ▾
                </button>
                {isFaqOpen && (
                  <div className="absolute z-50" style={{ bottom: '100%', left: 0, marginBottom: '0.75rem', width: '350px', borderRadius: '1.5rem', padding: '0.75rem 0', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(30px)', boxShadow: '0 -20px 50px rgba(0,0,0,0.3)' }}>
                    <div style={{ padding: '0.5rem 1.5rem', fontSize: '0.75rem', fontWeight: 900, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.15em', borderBottom: '1px solid var(--border-color)', marginBottom: '0.5rem' }}>Archive: {currentEra}</div>
                    {eraArchiveItems.map((item, i) => (
                      <button key={i} type="button" onClick={() => handleAction(item.prompt)} disabled={isLoading} style={{ width: '100%', textAlign: 'left', padding: '0.8rem 1.5rem', fontSize: '0.95rem', fontWeight: 800, border: 'none', background: 'transparent', transition: 'all 0.2s', opacity: isLoading ? 0.5 : 1 }} className="hover:bg-accent hover:text-white">
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
             </div>
             <button type="button" onClick={() => { const currentIndex = CHAPTERS.findIndex(c => c.id === currentEra); if (currentIndex < CHAPTERS.length - 1) startEra(CHAPTERS[currentIndex+1].id); }} disabled={currentEra === Era.Unified || isLoading} style={{ opacity: (currentEra === Era.Unified || isLoading) ? 0.5 : 1 }}>
               NEXT ERA
             </button>
          </div>
          <form onSubmit={onFormSubmit} className="relative flex w-full">
            <input 
              ref={inputRef}
              type="text" 
              value={userInput} 
              onChange={(e) => setUserInput(e.target.value)} 
              disabled={isLoading} 
              placeholder={isLoading ? "The Professor is deep in thought..." : "Ask the Professor anything..." } 
              style={{ paddingRight: '120px' }} 
            />
            <button 
              type="submit" 
              disabled={isLoading || !userInput.trim()} 
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', backgroundColor: 'var(--accent)', color: '#fff', borderRadius: '1.2rem', fontWeight: 900, border: 'none', padding: '0.75rem 1.5rem', opacity: (isLoading || !userInput.trim()) ? 0.6 : 1 }}
            >
              SEND
            </button>
          </form>
        </div>
      </footer>

      {isLogOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
          <div className="bg-theme w-full max-w-4xl h-3/4 rounded-[2rem] flex flex-col overflow-hidden border border-white/10" style={{ background: 'var(--glass-bg)' }}>
            <div className="p-8 flex justify-between items-center border-b border-white/5">
              <h2 className="serif" style={{ fontSize: '1.8rem', fontWeight: 900 }}>Telemetry</h2>
              <div className="flex gap-4">
                <button type="button" onClick={() => window.location.reload()} style={{ color: '#ef4444', borderColor: '#ef4444' }}>RESET SYSTEM</button>
                <button type="button" onClick={() => setIsLogOpen(false)} style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0 }}>✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 font-mono text-[0.9rem] space-y-6 no-scrollbar">
              {logs.length === 0 && <div className="text-center opacity-30 mt-20">NO SYSTEM DATA RECORDED</div>}
              {logs.map(log => (
                <div key={log.id} className={`p-5 rounded-xl border-l-8 ${log.status === 'ERROR' ? 'border-red-500 bg-red-500/10' : 'border-accent bg-white/5'}`}>
                  <div className="flex justify-between font-black uppercase text-[0.75rem] opacity-60 mb-2">
                    <span>{log.type}</span>
                    <span>{Math.round(log.duration)}MS</span>
                  </div>
                  <div className="font-bold text-lg mb-1">{log.label}</div>
                  <div className="opacity-70 leading-relaxed font-mono whitespace-pre-wrap">{log.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => (
  // Fix: Providing children prop to ErrorBoundary
  <ErrorBoundary>
    <EinsteinApp />
  </ErrorBoundary>
);

export default App;
