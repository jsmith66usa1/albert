import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Era, Message, Chapter } from './types';
import { CHAPTERS } from './constants';
import { 
  generateEinsteinResponse, 
  generateChalkboardImage, 
  generateEinsteinSpeech,
  decode,
  decodeAudioData 
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
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const faqDropdownRef = useRef<HTMLDivElement>(null);

  const currentChapter = useMemo(() => CHAPTERS.find(c => c.id === currentEra), [currentEra]);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (faqDropdownRef.current && !faqDropdownRef.current.contains(event.target as Node)) {
        setIsFaqOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    if ((window as any).MathJax) {
      (window as any).MathJax.typesetPromise?.().catch((e:any)=>console.warn(e));
    }
  }, [messages]);

  const stopAudio = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {}
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
    } catch (err) {
      console.error("Speech synthesis failed", err);
      setIsAudioPlaying(false);
      setCurrentlySpeakingId(null);
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
      const imageMatch = responseText.match(/\[IMAGE: (.*?)\]/);
      let imageUrl = undefined;
      let cleanedText = responseText;
      
      if (imageMatch) {
        const imagePrompt = imageMatch[1];
        cleanedText = responseText.replace(imageMatch[0], '').trim();
        try {
          imageUrl = await generateChalkboardImage(imagePrompt);
          setLastImage(imageUrl);
        } catch (e) {
          console.error("Image generation failed:", e);
        }
      }

      const newMessage: Message = {
        role: 'einstein',
        text: cleanedText,
        imageUrl,
        timestamp: Date.now()
      };

      if (isNewEra) {
        setMessages([newMessage]);
        if (chatContainerRef.current) chatContainerRef.current.scrollTop = 0;
      } else {
        setMessages(prev => [...prev, newMessage]);
      }
      if (eraToSet) setCurrentEra(eraToSet);
    } catch (err) {
      console.error("Einstein failed us", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFaqInquiry = (type: 'detail' | 'applications' | 'figures') => {
    setIsFaqOpen(false);
    let inquiry = "";
    switch(type) {
      case 'detail': inquiry = `My dear friend, please explain the mathematical and theoretical details of ${currentEra} in more depth.`; break;
      case 'applications': inquiry = `Professor, what are the modern scientific applications of the concepts from the ${currentEra}?`; break;
      case 'figures': inquiry = `Who were the most pivotal historical figures that shaped the ${currentEra}?`; break;
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
      setMessages([]);
      handleAction(chapter.prompt, era, true);
    }
  };

  const handleNextChapter = () => {
    const currentIndex = CHAPTERS.findIndex(c => c.id === currentEra);
    if (currentIndex !== -1 && currentIndex < CHAPTERS.length - 1) {
      startEra(CHAPTERS[currentIndex + 1].id);
    }
  };

  const initializeApp = () => {
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

  const stars = useMemo(() => Array.from({ length: 100 }).map((_, i) => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: `${Math.random() * 2 + 0.5}px`,
    duration: `${Math.random() * 5 + 3}s`,
    delay: `${Math.random() * 5}s`
  })), []);

  if (!hasStarted) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative" style={{ backgroundColor: '#09090b', color: '#fff' }}>
        <div className="absolute" style={{ inset: 0, overflow: 'hidden' }}>
          {stars.map((star, i) => (
            <div key={i} className="star" style={{ top: star.top, left: star.left, width: star.size, height: star.size, '--duration': star.duration, animationDelay: star.delay } as any} />
          ))}
        </div>
        <div className="glass p-6 flex flex-col items-center text-center relative z-50 shadow-2xl" style={{ maxWidth: '500px', borderRadius: '4rem', padding: '3.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ marginBottom: '2.5rem', transform: 'rotate(-2deg)', borderRadius: '2.5rem', overflow: 'hidden', border: '2px solid rgba(99, 102, 241, 0.4)', width: '180px', height: '180px' }}>
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/480px-Albert_Einstein_Head.jpg" alt="Einstein" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.8) contrast(1.2)' }} />
          </div>
          <h1 className="serif" style={{ fontSize: '2.8rem', fontWeight: 900, marginBottom: '0.75rem', letterSpacing: '-0.02em', color: 'white' }}>Einstein's Universe</h1>
          <p className="serif" style={{ color: '#d1d1d6', fontStyle: 'italic', marginBottom: '3rem', fontSize: '1.1rem', lineHeight: 1.5 }}>"Imagination is more important than knowledge..."</p>
          <button onClick={initializeApp} style={{ width: '100%', padding: '1.25rem', backgroundColor: '#6366f1', color: '#fff', borderRadius: '1.5rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '13px', border: 'none' }}>Enter Laboratory</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-theme text-theme">
      <header className="header flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--accent)', fontWeight: 900, fontStyle: 'italic', color: '#fff', fontSize: '13px', border: 'none' }}>AE</div>
          <h1 className="serif lg-block hidden" style={{ fontSize: '1.3rem', fontWeight: 900 }}>Einstein's Universe</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={playLatestSpeech} style={{ padding: '0.6rem 1.25rem', borderRadius: '0.75rem', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: isAudioPlaying ? 'rgba(239, 68, 68, 0.2)' : 'var(--accent)', color: isAudioPlaying ? '#ef4444' : '#fff', border: isAudioPlaying ? '1px solid #ef4444' : 'none' }}>
            {isAudioPlaying ? 'Mute' : 'Listen'}
          </button>
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} style={{ padding: '0.6rem 1rem', borderRadius: '0.75rem', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent)', minWidth: '160px' }}>
              {currentChapter?.id}
            </button>
            {isDropdownOpen && (
              <div className="absolute z-50" style={{ top: '100%', right: 0, marginTop: '0.5rem', width: '280px', borderRadius: '1.25rem', padding: '0.75rem 0', boxShadow: 'var(--card-shadow)', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(20px)' }}>
                {CHAPTERS.map(ch => (
                  <button key={ch.id} onClick={() => startEra(ch.id)} style={{ width: '100%', textAlign: 'left', padding: '0.6rem 1.5rem', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: currentEra === ch.id ? 'var(--accent)' : 'inherit', border: 'none', background: 'transparent' }}>
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
            {isLoading && <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', padding: '1rem' }}>Solving Field Equations...</div>}
            <div ref={chatEndRef} style={{ height: '1px' }} />
          </div>
        </section>

        <section className="chalkboard-area">
          <div className="flex items-center justify-center w-full h-full">
            {lastImage ? (
              <img src={lastImage} className="chalkboard-filter" alt="Manifested Theory" />
            ) : (
              <div style={{ opacity: 0.2, fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5em', textAlign: 'center' }}>
                Dimension Awaiting Observation
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="footer z-50">
        <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: '1.25rem' }}>
             <button onClick={() => handleAction(`Professor, please manifest a new detailed chalkboard diagram for: ${currentEra}. Focus on its visual geometry.`)} style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Show Diagram</button>
             
             <div className="relative" ref={faqDropdownRef}>
                <button onClick={() => setIsFaqOpen(!isFaqOpen)} style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Scientific Archive {isFaqOpen ? '▴' : '▾'}
                </button>
                {isFaqOpen && (
                  <div className="absolute z-[100]" style={{ bottom: '100%', left: 0, marginBottom: '0.6rem', width: '220px', borderRadius: '1.25rem', padding: '0.5rem', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', backdropFilter: 'blur(20px)' }}>
                    {['detail', 'applications', 'figures'].map(type => (
                      <button key={type} onClick={() => handleFaqInquiry(type as any)} style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', borderRadius: '0.75rem', border: 'none', background: 'transparent' }}>
                        Archive: {type}
                      </button>
                    ))}
                  </div>
                )}
             </div>

             <button onClick={handleNextChapter} disabled={currentEra === Era.Unified} style={{ padding: '0.6rem 1.4rem', borderRadius: '0.8rem', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Next Chapter</button>
          </div>
          
          <form onSubmit={handleSendMessage} className="relative">
            <input 
              type="text" 
              value={userInput} 
              onChange={(e) => setUserInput(e.target.value)} 
              placeholder="Query the Professor..." 
            />
            <button 
              type="submit" 
              style={{ 
                position: 'absolute', 
                right: '8px', 
                top: '50%', 
                transform: 'translateY(-50%)', 
                backgroundColor: 'var(--accent)', 
                color: '#fff', 
                padding: '0.6rem 1.2rem', 
                borderRadius: '1rem', 
                fontWeight: 900, 
                fontSize: '10px', 
                textTransform: 'uppercase',
                border: 'none',
                minWidth: '100px'
              }}
            >
              Analyze
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
};

export default App;