
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
    if (messages.length > 1) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    if ((window as any).MathJax) {
      (window as any).MathJax.typeset();
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
        window.scrollTo(0, 0);
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

  const stars = useMemo(() => Array.from({ length: 80 }).map((_, i) => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: `${Math.random() * 2 + 0.5}px`,
    duration: `${Math.random() * 4 + 2}s`,
    delay: `${Math.random() * 5}s`
  })), []);

  if (!hasStarted) {
    return (
      <div className="h-screen w-screen bg-[#09090b] flex flex-col items-center justify-center p-6 relative overflow-hidden text-white">
        <div className="absolute inset-0 pointer-events-none">
          {stars.map((star, i) => (
            <div key={i} className="star bg-indigo-300" style={{ top: star.top, left: star.left, width: star.size, height: star.size, '--duration': star.duration, animationDelay: star.delay } as any} />
          ))}
        </div>
        <div className="max-w-lg w-full glass p-12 rounded-[4rem] border border-white/10 flex flex-col items-center text-center shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-1000">
          <div className="relative group mb-10">
            <div className="w-56 h-56 rounded-[3rem] border-2 border-indigo-500/40 overflow-hidden bg-zinc-900 rotate-3 transition-transform group-hover:rotate-0 duration-700">
              <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/480px-Albert_Einstein_Head.jpg" alt="Einstein" className="w-full h-full object-cover grayscale brightness-110 contrast-110" />
            </div>
          </div>
          <h1 className="serif text-5xl font-black mb-4 tracking-tight">Einstein's Universe</h1>
          <p className="text-zinc-400 text-base italic serif leading-relaxed mb-12 px-4">"Imagination is more important than knowledge..."</p>
          <button onClick={initializeApp} className="group relative w-full py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-[11px] transition-all shadow-lg active:scale-95">Initiate Journey</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-screen overflow-hidden relative transition-colors duration-500 text-theme bg-theme`}>
      <header className="h-20 flex-shrink-0 flex items-center justify-between px-8 glass z-40 border-b border-theme shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center ring-4 ring-indigo-500/10 shadow-lg">
            <span className="text-white text-[14px] font-black italic">AE</span>
          </div>
          <h1 className="serif text-2xl font-black tracking-tight hidden lg:block">Einstein's Universe</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={playLatestSpeech} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border ${isAudioPlaying ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-indigo-600 text-white'}`}>
            {isAudioPlaying ? 'Mute' : 'Listen'}
          </button>
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="px-4 py-3 rounded-2xl bg-input border border-theme text-xs font-black uppercase tracking-widest text-indigo-500">
              {currentChapter?.id}
            </button>
            {isDropdownOpen && (
              <div className="absolute top-full mt-3 right-0 w-80 glass rounded-3xl border border-theme shadow-2xl py-4 z-50 overflow-hidden">
                {CHAPTERS.map(ch => (
                  <button key={ch.id} onClick={() => startEra(ch.id)} className={`w-full px-5 py-3 text-left text-[11px] font-black uppercase tracking-wider hover:bg-indigo-600/10 ${currentEra === ch.id ? 'text-indigo-500' : ''}`}>
                    {ch.id}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-input border border-theme">
            {isDarkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        <section className="lg:w-[500px] flex-shrink-0 flex flex-col border-r border-theme bg-aside">
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-6 md:px-10 py-10 space-y-8 no-scrollbar scroll-smooth">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'einstein' ? 'justify-start' : 'justify-end'}`}>
                <div className={`rounded-3xl p-6 md:p-8 shadow-sm ${msg.role === 'einstein' ? 'bg-einstein border border-theme text-theme max-w-[95%]' : 'bg-indigo-600 text-white max-w-[85%] ml-10'}`}>
                  <div className="leading-relaxed whitespace-pre-wrap serif text-lg md:text-xl">{msg.text}</div>
                </div>
              </div>
            ))}
            {isLoading && <div className="text-center opacity-40 uppercase text-[9px] font-black tracking-widest">Calculations in progress...</div>}
            <div ref={chatEndRef} />
          </div>
        </section>

        <aside className="flex-1 flex flex-col bg-aside overflow-hidden">
          <div className="p-4 md:p-12 h-full flex flex-col items-center justify-center">
            <div className="w-full h-full glass rounded-[3rem] overflow-hidden flex items-center justify-center border border-theme shadow-inner">
              {lastImage ? (
                <img src={lastImage} className="max-w-full max-h-full w-auto h-auto object-contain chalkboard-filter" alt="Theory" />
              ) : (
                <div className="opacity-10 text-[10px] tracking-[0.5em] font-black uppercase">Awaiting Observation</div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <div className="w-full p-6 border-t border-theme glass bg-inherit z-50">
        <div className="max-w-6xl mx-auto w-full">
          <div className="flex flex-wrap items-center gap-4 mb-4">
             <button onClick={() => handleAction(`Please manifest a new detailed scientific chalkboard diagram for: ${currentEra}`)} className="px-6 py-3 rounded-2xl bg-input border border-theme text-[10px] font-black uppercase tracking-[0.2em]">Show Diagram</button>
             
             <div className="relative" ref={faqDropdownRef}>
                <button onClick={() => setIsFaqOpen(!isFaqOpen)} className="px-6 py-3 rounded-2xl bg-input border border-theme text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                  Scientific Archive {isFaqOpen ? '▴' : '▾'}
                </button>
                {isFaqOpen && (
                  <div className="absolute bottom-full mb-3 left-0 w-64 glass rounded-3xl border border-theme shadow-2xl p-2 z-[60]">
                    {['detail', 'applications', 'figures'].map(type => (
                      <button key={type} onClick={() => handleFaqInquiry(type as any)} className="w-full px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider hover:bg-indigo-600/10 rounded-xl">
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
             </div>

             <button onClick={handleNextChapter} disabled={currentEra === Era.Unified} className="px-6 py-3 rounded-2xl bg-input border border-theme text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-30">Next Era</button>
          </div>
          <form onSubmit={handleSendMessage} className="relative group">
            <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Ask the Professor..." className="w-full bg-input border border-theme rounded-[2rem] pl-8 pr-32 py-5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            <button type="submit" className="absolute right-4 top-1/2 -translate-y-1/2 bg-indigo-600 text-white px-6 py-2 rounded-xl font-black text-[10px] uppercase">Query</button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default App;
