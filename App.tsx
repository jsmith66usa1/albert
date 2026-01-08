
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
  
  // FAQ Dropdown state
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const faqDropdownRef = useRef<HTMLDivElement>(null);

  const currentChapter = useMemo(() => CHAPTERS.find(c => c.id === currentEra), [currentEra]);

  // Sync theme with body class
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  }, [isDarkMode]);

  // Handle outside click for dropdowns
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

  // Auto-scroll and MathJax typeset
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if ((window as any).MathJax) {
      (window as any).MathJax.typeset();
    }
  }, [messages]);

  const stopAudio = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Source might already be stopped
      }
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
      
      const audioBuffer = await decodeAudioData(
        decode(base64),
        audioContextRef.current,
        24000,
        1
      );
      
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
    if (lastIdx !== -1) {
      playSpeech(messages[lastIdx].text, lastIdx);
    }
  };

  const handleAction = async (promptText: string, eraToSet?: Era) => {
    setIsLoading(true);
    const history = messages.map(m => ({
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

      setMessages(prev => [...prev, newMessage]);
      if (eraToSet) {
        setCurrentEra(eraToSet);
      }
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
      case 'detail':
        inquiry = `My dear friend, please explain the mathematical and theoretical details of ${currentEra} in more depth.`;
        break;
      case 'applications':
        inquiry = `Professor, what are the modern scientific applications of the concepts from the ${currentEra}?`;
        break;
      case 'figures':
        inquiry = `Who were the most pivotal historical figures that shaped the ${currentEra}?`;
        break;
    }
    
    // Add user message to chat for context
    const userMsg: Message = {
      role: 'user',
      text: inquiry,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);
    handleAction(inquiry);
  };

  const startEra = (era: Era) => {
    if (isLoading) return;
    setIsDropdownOpen(false);
    const chapter = CHAPTERS.find(c => c.id === era);
    if (chapter) {
      handleAction(chapter.prompt, era);
    }
  };

  const initializeApp = () => {
    setHasStarted(true);
    startEra(Era.Introduction);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading) return;
    
    const userMsg: Message = {
      role: 'user',
      text: userInput,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);
    const inputToProcess = userInput;
    setUserInput('');
    handleAction(inputToProcess);
  };

  const stars = useMemo(() => {
    return Array.from({ length: 80 }).map((_, i) => ({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: `${Math.random() * 2 + 0.5}px`,
      duration: `${Math.random() * 4 + 2}s`,
      delay: `${Math.random() * 5}s`
    }));
  }, []);

  if (!hasStarted) {
    return (
      <div className="h-screen w-screen bg-[#09090b] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          {stars.map((star, i) => (
            <div key={i} className="star bg-indigo-300" style={{ top: star.top, left: star.left, width: star.size, height: star.size, '--duration': star.duration, animationDelay: star.delay } as any} />
          ))}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-indigo-900/10 blur-[150px] rounded-full" />
        </div>
        
        <div className="max-w-lg w-full glass p-12 rounded-[4rem] border border-white/10 flex flex-col items-center text-center shadow-[0_30px_100px_rgba(0,0,0,0.8)] relative z-10 animate-in fade-in zoom-in-95 duration-1000">
          <div className="relative group mb-10">
            <div className="w-56 h-56 rounded-[3rem] border-2 border-indigo-500/40 overflow-hidden shadow-[0_0_60px_rgba(79,70,229,0.3)] bg-zinc-900 rotate-3 transition-transform group-hover:rotate-0 duration-700">
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/480px-Albert_Einstein_Head.jpg" 
                alt="Albert Einstein Iconic Portrait"
                className="w-full h-full object-cover grayscale brightness-110 contrast-110"
                onError={(e) => { e.currentTarget.src = "https://placehold.co/400x400/18181b/indigo?text=Einstein"; }}
              />
            </div>
            <div className="absolute -top-4 -right-4 w-12 h-12 border-t-2 border-r-2 border-indigo-500/50 rounded-tr-2xl" />
            <div className="absolute -bottom-4 -left-4 w-12 h-12 border-b-2 border-l-2 border-indigo-500/50 rounded-bl-2xl" />
          </div>

          <h1 className="serif text-5xl font-black text-white mb-4 tracking-tight">Einstein's Universe</h1>
          <div className="h-0.5 w-16 bg-indigo-600 mb-6" />
          
          <p className="text-zinc-400 text-base italic serif leading-relaxed mb-12 px-4">
            "Imagination is more important than knowledge. For knowledge is limited, whereas imagination embraces the entire world, stimulating progress, giving birth to evolution."
          </p>
          
          <button 
            onClick={initializeApp}
            className="group relative w-full py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-[11px] transition-all active:scale-95 shadow-[0_20px_40px_rgba(79,70,229,0.3)] border border-white/20 overflow-hidden"
          >
            <span className="relative z-10">Initiate Thought Experiment</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
          </button>
          
          <div className="mt-8 text-[9px] mono uppercase tracking-widest text-zinc-600 font-bold opacity-60">
             Relativity Engine Active • Theoretical Core v4.0
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-screen overflow-hidden relative transition-colors duration-500`}>
      <div className="absolute inset-0 pointer-events-none opacity-20 z-0">
        {stars.map((star, i) => (
          <div 
            key={i} 
            className="star bg-indigo-400" 
            style={{ 
              top: star.top, 
              left: star.left, 
              width: star.size, 
              height: star.size, 
              '--duration': star.duration,
              animationDelay: star.delay
            } as any}
          />
        ))}
      </div>

      <header className="h-20 flex-shrink-0 flex items-center justify-between px-8 glass z-40 shadow-xl border-b border-theme">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center ring-4 ring-indigo-500/10 rotate-3 transition-transform hover:rotate-0 shadow-lg">
            <span className="text-white text-[14px] font-black italic">AE</span>
          </div>
          <h1 className="serif text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 animate-gradient hidden lg:block">
            Einstein's Universe
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={playLatestSpeech}
            className={`flex items-center gap-3 px-5 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm ${
              isAudioPlaying 
                ? 'bg-red-500/10 text-red-500 border-red-500/30 animate-pulse' 
                : 'bg-indigo-600 text-white border-indigo-400 hover:bg-indigo-500 hover:shadow-indigo-500/20 active:scale-95'
            }`}
          >
            {isAudioPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            )}
            {isAudioPlaying ? 'Stop Speaking' : 'Listen to Einstein'}
          </button>

          <div className="h-8 w-px bg-theme mx-2" />

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 border border-theme hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all text-xs font-black uppercase tracking-widest text-indigo-500 shadow-sm"
            >
              <span className="hidden md:inline text-zinc-500">Era:</span> {currentChapter?.id}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            
            {isDropdownOpen && (
              <div className="absolute top-full mt-3 right-0 w-80 glass rounded-[2rem] border border-theme shadow-[0_30px_60px_rgba(0,0,0,0.5)] overflow-hidden py-4 animate-in fade-in zoom-in-95 duration-200 z-50">
                <div className="px-5 pb-3 mb-3 border-b border-theme">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Historical Timeline</span>
                </div>
                {CHAPTERS.map((ch, idx) => (
                  <button
                    key={ch.id}
                    onClick={() => startEra(ch.id)}
                    className={`w-full px-5 py-3.5 text-left flex items-center gap-5 hover:bg-indigo-600/10 transition-colors ${currentEra === ch.id ? 'bg-indigo-600/10' : ''}`}
                  >
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-[12px] font-black border transition-colors ${currentEra === ch.id ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800/20 border-zinc-700 text-zinc-500'}`}>
                      {idx + 1}
                    </span>
                    <div className="flex flex-col">
                      <span className={`text-[11px] font-black uppercase tracking-wider ${currentEra === ch.id ? 'text-indigo-400' : 'text-theme opacity-80'}`}>{ch.id}</span>
                      <span className="text-[10px] text-zinc-500 line-clamp-1 italic">{ch.title}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-theme shadow-sm"
            title={isDarkMode ? "Old Paper Mode" : "Dark Space Mode"}
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden z-10 relative">
        <section className="lg:w-[450px] xl:w-[550px] flex-shrink-0 flex flex-col border-r border-theme bg-zinc-950/20 relative shadow-2xl">
          <div className="flex-1 overflow-y-auto px-6 md:px-10 py-10 space-y-12 no-scrollbar">
            <div className="text-center pb-6">
              <span className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.5em] mb-2 block">Dialogue Console</span>
              <div className="h-px w-20 bg-indigo-500/20 mx-auto" />
            </div>
            
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'einstein' ? 'justify-start' : 'justify-end animate-in fade-in slide-in-from-right-4 duration-300'}`}>
                <div className={`max-w-[100%] ${msg.role === 'einstein' ? '' : 'flex flex-col items-end w-full'}`}>
                  {msg.role === 'einstein' && (
                    <div className="flex items-center justify-between mb-4 px-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-indigo-900/50 border border-indigo-500/20 flex items-center justify-center">
                          <span className="serif text-indigo-200 text-[9px] italic font-bold">A.E.</span>
                        </div>
                        <span className="serif text-[11px] font-black text-indigo-500/60 uppercase tracking-[0.2em] italic">
                          Einstein
                        </span>
                      </div>
                      <button 
                        onClick={() => playSpeech(msg.text, idx)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${currentlySpeakingId === idx ? 'bg-red-500/10 text-red-500 border border-red-500/30' : 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 hover:bg-indigo-500/20'}`}
                        title="Listen to the Professor"
                      >
                        {currentlySpeakingId === idx ? (
                          <><div className="w-1 h-1 bg-red-500 rounded-full animate-pulse" /> Stop</>
                        ) : (
                          <><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg> Speak</>
                        )}
                      </button>
                    </div>
                  )}

                  <div className={`rounded-3xl p-6 md:p-8 shadow-xl transition-all ${
                    msg.role === 'einstein' 
                      ? 'bg-einstein border border-theme text-theme backdrop-blur-xl ring-1 ring-white/5' 
                      : 'bg-indigo-600 text-white font-medium shadow-indigo-600/30 ring-1 ring-white/10 ml-12'
                  }`}>
                    <div className={`leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'einstein' ? 'serif text-lg md:text-xl selection:bg-indigo-500/40' : 'text-[15px]'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                  
                  <div className="mt-3 text-[8px] text-zinc-500 mono uppercase tracking-widest px-4 font-bold opacity-40">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-einstein border border-theme rounded-3xl p-6 flex items-center gap-4 shadow-xl">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse delay-75" />
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse delay-150" />
                  </div>
                  <span className="text-[10px] text-zinc-500 uppercase mono font-black tracking-widest">Observing Reality...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </section>

        <aside className="flex-1 flex flex-col bg-aside overflow-hidden relative shadow-[inset_20px_0_40px_rgba(0,0,0,0.3)]">
          <div className="p-8 md:p-12 h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.8)]" />
                <h2 className="serif text-[13px] uppercase tracking-[0.6em] text-indigo-500 font-black">Visual Manifestation</h2>
              </div>
              <div className="flex gap-4">
                 <div className="px-3 py-1 bg-indigo-500/5 rounded-full border border-indigo-500/10 text-[9px] mono text-indigo-400 font-bold uppercase tracking-widest">Scientific Hub</div>
                 <div className="px-3 py-1 bg-zinc-500/5 rounded-full border border-theme text-[9px] mono text-zinc-500 font-bold uppercase tracking-widest">Resolution: 1024px</div>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center relative group min-h-0">
              <div className="w-full h-full max-w-[900px] max-h-[900px] aspect-square rounded-[3rem] overflow-hidden border border-theme bg-zinc-950 flex items-center justify-center shadow-[0_50px_100px_rgba(0,0,0,0.8)] relative z-10 transition-all duration-1000 group-hover:shadow-[0_60px_120px_rgba(79,70,229,0.2)]">
                {lastImage ? (
                  <img 
                    src={lastImage} 
                    alt="Scientific chalkboard illustration" 
                    className="w-full h-full object-cover chalkboard-filter transition-all duration-[2000ms] group-hover:scale-105"
                  />
                ) : (
                  <div className="text-center p-20 opacity-20 group-hover:opacity-40 transition-opacity">
                    <div className="w-32 h-32 border-4 border-dashed border-zinc-700 rounded-full mx-auto mb-10 flex items-center justify-center rotate-45 group-hover:rotate-0 transition-transform duration-1000">
                      <div className="w-16 h-16 bg-zinc-800 rounded-full animate-pulse" />
                    </div>
                    <p className="text-[12px] text-zinc-500 mono uppercase tracking-[0.4em] font-black">Waveform Awaiting Manifestation</p>
                  </div>
                )}
                <div className="absolute inset-0 pointer-events-none mix-blend-screen opacity-10 bg-[url('https://www.transparenttextures.com/patterns/black-chalk.png')]" />
                <div className="absolute inset-0 border-[32px] border-zinc-900/50 pointer-events-none mix-blend-overlay" />
              </div>
              
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-indigo-600/5 blur-[120px] rounded-full pointer-events-none transition-opacity duration-1000 opacity-0 group-hover:opacity-100" />
            </div>
          </div>
        </aside>
      </div>

      <div className="w-full p-6 md:p-8 border-t border-theme glass flex-shrink-0 z-50 bg-inherit relative">
        <div className="max-w-7xl mx-auto w-full">
          {/* Action Row Buttons */}
          <div className="flex items-center gap-4 mb-6 px-4">
             <button 
              onClick={() => handleAction(`Please manifest a new detailed scientific chalkboard diagram for the current topic: ${currentEra}`)}
              disabled={isLoading}
              className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-theme text-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 disabled:opacity-50"
             >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><path d="M12 2v8"/><path d="m16 6-4 4-4-4"/><rect width="20" height="14" x="2" y="8" rx="2"/><path d="M6 14h.01"/><path d="M10 14h.01"/></svg>
                Show Diagram
             </button>
             
             {/* FAQ Dropdown Wrapper */}
             <div className="relative" ref={faqDropdownRef}>
                <button 
                  onClick={() => setIsFaqOpen(!isFaqOpen)}
                  disabled={isLoading}
                  className={`flex items-center gap-3 px-6 py-3 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 disabled:opacity-50 ${isFaqOpen ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-zinc-100 dark:bg-zinc-800/80 border-theme text-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isFaqOpen ? 'text-white' : 'text-indigo-500'}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M8 7h6"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>
                  Scientific Archive (FAQ)
                </button>

                {/* FAQ Dropdown Menu */}
                {isFaqOpen && (
                  <div className="absolute bottom-full mb-4 left-0 w-64 glass rounded-3xl border border-theme shadow-[0_20px_40px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-2 animate-in slide-in-from-bottom-2 duration-200 z-[100]">
                    <div className="px-4 py-3 mb-2 border-b border-theme/50">
                       <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Select Inquiry Path</span>
                    </div>
                    <button 
                      onClick={() => handleFaqInquiry('detail')}
                      className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-indigo-600/10 rounded-xl transition-colors text-[10px] font-bold uppercase tracking-wider text-theme"
                    >
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      More Detail
                    </button>
                    <button 
                      onClick={() => handleFaqInquiry('applications')}
                      className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-indigo-600/10 rounded-xl transition-colors text-[10px] font-bold uppercase tracking-wider text-theme"
                    >
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      Applications
                    </button>
                    <button 
                      onClick={() => handleFaqInquiry('figures')}
                      className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-indigo-600/10 rounded-xl transition-colors text-[10px] font-bold uppercase tracking-wider text-theme"
                    >
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      Historical Figures
                    </button>
                  </div>
                )}
             </div>
          </div>

          <form onSubmit={handleSendMessage} className="relative group">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Pose a question to the Professor..."
              className="w-full bg-input border border-theme rounded-[2.5rem] pl-10 pr-36 py-6 text-base focus:outline-none focus:ring-4 focus:ring-indigo-600/10 transition-all shadow-2xl backdrop-blur-3xl"
            />
            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-4">
               {isLoading && (
                 <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
               )}
               <button
                type="submit"
                disabled={isLoading || !userInput.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-zinc-800 disabled:text-zinc-600 px-8 py-3 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all active:scale-95 shadow-xl shadow-indigo-600/30"
              >
                Query
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default App;
