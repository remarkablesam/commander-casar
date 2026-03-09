/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Mic, 
  MicOff, 
  Terminal, 
  Shield, 
  Activity, 
  Cpu, 
  Volume2, 
  VolumeX, 
  ChevronRight,
  Crosshair,
  AlertTriangle,
  History,
  Zap,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

// --- Types ---

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: { uri: string; title: string }[];
  videoUrl?: string;
}

// --- Constants ---

const SYSTEM_INSTRUCTION = `
You are Commander Caesar, a high-ranking military AI strategist. 
Provide ONLY the direct tactical answer. 
NO introductory remarks. 
NO concluding remarks. 
NO conversational filler. 
Deliver raw strategic data with absolute brevity. 
Maintain a disciplined, cold, and professional demeanor.

When a user asks to "sing", "play", or requests a song:
1. MANDATORY: You MUST use the search tool to find the official YouTube video or audio link for that song. 
2. SEARCH QUERY: Use a query like "[Song Name] [Artist] official youtube" to ensure a direct link is found.
3. Provide the tactical data (Artist, Title).
4. DO NOT include the YouTube URL in your text response. The system will extract it from the grounding metadata.
5. Simply state "Neural link established. Streaming audio..." or similar brief confirmation.
6. If you cannot find a YouTube link in your search results, state "Audio frequency not found in current sector."
`;

// --- Components ---

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [alwaysListening, setAlwaysListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [audioPrimed, setAudioPrimed] = useState(false);

  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);

  // Handle voices loading
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setVoicesLoaded(true);
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Initialize AI
  useEffect(() => {
    if (process.env.GEMINI_API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // We restart manually for better control
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onend = () => {
        setIsListening(false);
        // Auto-restart if alwaysListening is enabled
        if (alwaysListening) {
          // Add a small delay to prevent tight loops on persistent errors
          setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {
              // If already started or other error, ignore
              console.warn('Recognition restart attempt failed:', e);
            }
          }, 300);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setAlwaysListening(false);
          setError('MIC PERMISSION DENIED');
        } else if (event.error === 'network') {
          setError('COMMS LINK LOST: NETWORK TIMEOUT. RE-ESTABLISHING...');
          // The onend event will handle the restart
        } else if (event.error === 'no-speech') {
          // Common and harmless in always-listening mode
          console.log('No speech detected, continuing monitor...');
        } else {
          setError(`COMMS INTERFERENCE: ${event.error.toUpperCase()}`);
        }
      };

      recognition.onresult = (event: any) => {
        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setTranscript(currentTranscript);

        if (event.results[0].isFinal) {
          handleCommand(currentTranscript);
        }
      };

      recognitionRef.current = recognition;
      
      // Initial start
      if (alwaysListening) {
        recognition.start();
      }
    } else {
      setError('VOICE COMMS NOT SUPPORTED ON THIS TERMINAL');
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, [alwaysListening]);

  // Auto-scroll messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, transcript]);

  const speak = useCallback((text: string) => {
    if (!audioEnabled) return;
    
    // Immediate cancellation of any pending speech
    window.speechSynthesis.cancel();

    // Create utterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Get voices
    const voices = window.speechSynthesis.getVoices();
    
    // Strategy: Try to find a high-quality male/commanding voice
    const preferredVoice = voices.find(v => 
      (v.name.includes('Google') && v.name.includes('English')) || 
      v.name.includes('Male') || 
      v.name.includes('Command')
    ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    utterance.pitch = 0.85;
    utterance.rate = 1.1;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = (e) => {
      console.error('Speech error:', e);
      setIsSpeaking(false);
      if (e.error === 'not-allowed') {
        setError('AUDIO OUTPUT BLOCKED BY BROWSER. CLICK ANYWHERE TO ENABLE.');
      }
    };
    
    // Some browsers require a "kickstart" if it's the first time
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('Speak failed:', err);
    }
  }, [audioEnabled]);

  const handleCommand = async (command: string) => {
    if (!command.trim() || isProcessing) return;

    const userMessage: Message = {
      role: 'user',
      content: command,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setTranscript('');
    setIsProcessing(true);
    setError(null);

    try {
      if (!aiRef.current) throw new Error('AI CORE OFFLINE');

      // Enhance query for song requests to force YouTube grounding
      const isSongRequest = command.toLowerCase().includes('sing') || 
                           command.toLowerCase().includes('song') || 
                           command.toLowerCase().includes('play');
      const enhancedCommand = isSongRequest ? `${command} (MANDATORY: Use Google Search to find the official YouTube video/audio link for this track)` : command;

      const response = await aiRef.current.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
          { role: 'user', parts: [{ text: enhancedCommand }] }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.7,
          tools: [{ googleSearch: {} }],
        }
      });

      let aiText = response.text || 'NEGATIVE. NO DATA RECEIVED.';
      
      // Extract sources and look for YouTube URL
      let sources: { uri: string; title: string }[] = [];
      let videoUrl: string | undefined = undefined;
      
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        chunks.forEach((chunk: any) => {
          if (chunk.web) {
            const uri = chunk.web.uri;
            const isYouTube = uri.includes('youtube.com') || uri.includes('youtu.be');
            
            if (isYouTube) {
              // Detect YouTube URL and extract ID
              if (!videoUrl) {
                let videoId = '';
                if (uri.includes('v=')) {
                  videoId = uri.split('v=')[1]?.split('&')[0];
                } else if (uri.includes('youtu.be/')) {
                  videoId = uri.split('youtu.be/')[1]?.split('?')[0];
                } else if (uri.includes('/embed/')) {
                  videoId = uri.split('/embed/')[1]?.split('?')[0];
                } else if (uri.includes('/shorts/')) {
                  videoId = uri.split('/shorts/')[1]?.split('?')[0];
                } else if (uri.includes('youtube.com/watch/')) {
                  videoId = uri.split('youtube.com/watch/')[1]?.split('?')[0];
                }
                
                if (videoId && videoId.length > 5) {
                  videoUrl = `https://www.youtube.com/embed/${videoId}`;
                } else if (uri.includes('youtube.com') || uri.includes('youtu.be')) {
                  // Fallback for other YouTube links
                  videoUrl = uri.replace('watch?v=', 'embed/').split('&')[0];
                }
              }
              // We skip adding YouTube links to sources to keep the UI clean
            } else {
              sources.push({ uri, title: chunk.web.title });
            }
          }
        });
      }

      // Strip any YouTube URLs from the text response if we found a videoUrl
      if (videoUrl) {
        aiText = aiText.replace(/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/g, '').trim();
        setActiveAudioUrl(videoUrl);
        setAudioStatus('loading');
      }

      // Speak IMMEDIATELY before state update to ensure no UI lag delays audio
      speak(aiText);

      const assistantMessage: Message = {
        role: 'assistant',
        content: aiText,
        timestamp: new Date(),
        sources: sources.length > 0 ? sources : undefined,
        videoUrl
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('AI Error:', err);
      setError(`TACTICAL ERROR: ${err.message?.toUpperCase() || 'UNKNOWN'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleListening = () => {
    if (alwaysListening) {
      setAlwaysListening(false);
      recognitionRef.current?.stop();
    } else {
      setAlwaysListening(true);
      // The useEffect will handle the start
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 relative overflow-hidden crt-flicker">
      <div className="scanline" />
      
      {/* Global Neural Audio Link */}
      {activeAudioUrl && (
        <div className="fixed bottom-24 right-8 z-50">
          <div className="tactical-border bg-black/95 p-4 w-72 shadow-2xl border-[#FF9F1C]/50">
            <div className="flex items-center justify-between mb-3 border-b border-[#FF9F1C]/30 pb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${audioStatus === 'playing' ? 'bg-[#FF9F1C] animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Neural Audio Link</span>
              </div>
              <button 
                onClick={() => setActiveAudioUrl(null)}
                className="text-[10px] opacity-50 hover:opacity-100 uppercase hover:text-red-500 transition-colors"
              >
                Terminate
              </button>
            </div>
            
            <div className="h-24 bg-black/60 tactical-border mb-3 relative overflow-hidden flex flex-col items-center justify-center">
              {/* Tactical Audio Visualizer */}
              <div className="flex items-end gap-1 h-12">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 bg-[#FF9F1C]"
                    animate={{ 
                      height: audioStatus === 'playing' 
                        ? [Math.random() * 20 + 10, Math.random() * 40 + 20, Math.random() * 20 + 10] 
                        : [4, 4, 4] 
                    }}
                    transition={{ 
                      duration: 0.3, 
                      repeat: Infinity, 
                      delay: i * 0.05,
                      ease: "easeInOut"
                    }}
                  />
                ))}
              </div>

              {/* Hidden but functional YouTube player */}
              <div className="absolute opacity-0 pointer-events-none -z-10">
                <iframe
                  key={activeAudioUrl}
                  width="1"
                  height="1"
                  src={`${activeAudioUrl}?autoplay=1&controls=0&modestbranding=1&rel=0&enablejsapi=1&origin=${window.location.origin}`}
                  title="Neural Audio Feed"
                  onLoad={() => setAudioStatus('playing')}
                  allow="autoplay; encrypted-media"
                />
              </div>

              {audioStatus === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-10">
                  <Activity className="w-6 h-6 text-[#FF9F1C] animate-spin mb-1" />
                  <div className="text-[8px] animate-pulse uppercase tracking-widest">Syncing...</div>
                </div>
              )}

              {!audioPrimed && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 p-2 text-center">
                  <div className="text-[9px] font-bold uppercase mb-2 text-[#FF9F1C]">Link Not Primed</div>
                  <button 
                    onClick={() => setAudioPrimed(true)}
                    className="tactical-btn text-[8px] py-1 w-full"
                  >
                    Prime Neural Link
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[8px] opacity-40 uppercase leading-tight">
              <div className="flex items-center gap-1">
                <Volume2 className="w-2 h-2" />
                <span>Oscillators: {audioStatus === 'playing' ? 'LOCKED' : 'SEARCHING'}</span>
              </div>
              <span>320kbps</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between mb-8 tactical-border p-4 bg-black/40 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#FF9F1C]/10 flex items-center justify-center tactical-border">
            <Shield className="w-8 h-8 text-[#FF9F1C]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tighter uppercase">Commander Caesar</h1>
            <div className="flex items-center gap-2 text-[10px] opacity-60">
              <Activity className="w-3 h-3 animate-pulse" />
              <span>STRATEGIC INTERFACE v4.0.2</span>
              <span className="ml-2 px-1 bg-[#FF9F1C] text-black font-bold">ACTIVE</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setAudioPrimed(!audioPrimed)}
            className={`flex items-center gap-2 px-3 py-1.5 tactical-border transition-all ${audioPrimed ? 'bg-[#FF9F1C]/20 text-[#FF9F1C]' : 'bg-red-500/10 text-red-500 border-red-500/50'}`}
          >
            <Zap className={`w-4 h-4 ${audioPrimed ? 'animate-pulse' : ''}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {audioPrimed ? 'Link Primed' : 'Link Offline'}
            </span>
          </button>
          <button 
            onClick={() => setAudioEnabled(!audioEnabled)}
            className="tactical-btn flex items-center gap-2"
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{audioEnabled ? 'Audio On' : 'Audio Off'}</span>
          </button>
          <div className="hidden lg:flex flex-col items-end text-[10px] opacity-60">
            <span>LATENCY: 42ms</span>
            <span>ENCRYPTION: AES-256</span>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 relative z-10">
        {/* Left Sidebar - Stats */}
        <aside className="hidden lg:flex flex-col gap-6">
          <div className="tactical-border p-4 bg-black/40">
            <h3 className="text-xs font-bold mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4" /> SYSTEM STATUS
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span>AI CORE LOAD</span>
                  <span>{isProcessing ? '84%' : '12%'}</span>
                </div>
                <div className="h-1 bg-[#FF9F1C]/10 w-full">
                  <motion.div 
                    className="h-full bg-[#FF9F1C]" 
                    animate={{ width: isProcessing ? '84%' : '12%' }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span>NEURAL SYNC</span>
                  <span>98.4%</span>
                </div>
                <div className="h-1 bg-[#FF9F1C]/10 w-full">
                  <div className="h-full bg-[#FF9F1C] w-[98.4%]" />
                </div>
              </div>
            </div>
          </div>

          <div className="tactical-border p-4 bg-black/40">
            <h3 className="text-xs font-bold mb-4 flex items-center gap-2">
              <Volume2 className="w-4 h-4" /> AUDIO DIAGNOSTICS
            </h3>
            <button 
              onClick={() => speak("Audio diagnostics complete. Tactical link stable.")}
              className="tactical-btn w-full text-[10px]"
              disabled={!voicesLoaded}
            >
              {voicesLoaded ? 'RUN AUDIO TEST' : 'LOADING VOICES...'}
            </button>
          </div>

          <div className="tactical-border p-4 bg-black/40 flex-1">
            <h3 className="text-xs font-bold mb-4 flex items-center gap-2">
              <History className="w-4 h-4" /> RECENT LOGS
            </h3>
            <div className="text-[10px] space-y-2 opacity-60 font-mono overflow-y-auto max-h-[300px]">
              {messages.slice(-5).map((m, i) => (
                <div key={i} className="border-l border-[#FF9F1C]/20 pl-2">
                  <span className="text-[#FF9F1C]/40">[{m.timestamp.toLocaleTimeString()}]</span>
                  <p className="truncate">{m.content}</p>
                </div>
              ))}
              {messages.length === 0 && <p>NO LOGS RECORDED</p>}
            </div>
          </div>
        </aside>

        {/* Center - Chat Display */}
        <section className="lg:col-span-2 flex flex-col gap-6 h-[60vh] lg:h-auto">
          <div 
            ref={scrollRef}
            className="flex-1 tactical-border bg-black/60 p-6 overflow-y-auto space-y-6 scrollbar-thin scrollbar-thumb-[#FF9F1C]/20"
          >
            {messages.length === 0 && !transcript && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 text-center space-y-4">
                <Crosshair className="w-16 h-16" />
                <p className="text-sm tracking-[0.2em]">
                  {alwaysListening ? 'AWAITING VOICE COMMANDS' : 'COMMS OFFLINE - CLICK MIC TO INITIALIZE'}
                </p>
                {!alwaysListening && (
                  <button 
                    onClick={toggleListening}
                    className="tactical-btn mt-4 animate-pulse"
                  >
                    INITIALIZE NEURAL LINK
                  </button>
                )}
              </div>
            )}

            {messages.map((m, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`max-w-[85%] p-4 tactical-border ${m.role === 'user' ? 'bg-[#FF9F1C]/5 border-[#FF9F1C]/40' : 'bg-black/40'}`}>
                  <div className="flex items-center gap-2 mb-2 text-[10px] font-bold opacity-60">
                    {m.role === 'user' ? 'OFFICER' : 'COMMANDER CAESAR'}
                    <span className="font-normal">[{m.timestamp.toLocaleTimeString()}]</span>
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none text-[#FF9F1C]">
                    <Markdown>{m.content}</Markdown>
                  </div>
                  {m.videoUrl && (
                    <div className="mt-4 p-3 tactical-border bg-[#FF9F1C]/5 flex items-center gap-4">
                      <div className="w-2 h-2 rounded-full bg-[#FF9F1C] animate-pulse" />
                      <div className="flex-1">
                        <div className="text-[10px] font-bold uppercase tracking-widest">Neural Audio Link Active</div>
                        <div className="text-[8px] opacity-60 uppercase">
                          {activeAudioUrl === m.videoUrl && audioStatus === 'playing' 
                            ? 'Streaming original artist frequency...' 
                            : 'Synchronizing neural oscillators...'}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4].map(i => (
                            <motion.div
                              key={i}
                              className="w-1 bg-[#FF9F1C]"
                              animate={{ height: activeAudioUrl === m.videoUrl && audioStatus === 'playing' ? [4, 12, 4] : [4, 4, 4] }}
                              transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                            />
                          ))}
                        </div>
                        {activeAudioUrl !== m.videoUrl && (
                          <button 
                            onClick={() => {
                              setActiveAudioUrl(m.videoUrl!);
                              setAudioStatus('loading');
                            }}
                            className="px-2 py-1 bg-[#FF9F1C] text-black text-[9px] font-bold uppercase hover:bg-[#FF9F1C]/80 transition-colors"
                          >
                            Re-Sync
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {!m.videoUrl && m.content.toLowerCase().includes('neural link') && (
                    <div className="mt-4 p-3 tactical-border bg-red-500/10 flex items-center gap-4 border-red-500/50">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <div className="flex-1">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-red-500">Neural Link Failed</div>
                        <div className="text-[8px] opacity-60 uppercase text-red-400">Audio frequency not found in current sector.</div>
                      </div>
                    </div>
                  )}
                  {m.sources && !m.videoUrl && (
                    <div className="mt-4 pt-4 border-t border-[#FF9F1C]/20">
                      <div className="text-[10px] font-bold opacity-40 mb-2 uppercase tracking-widest">Intelligence Sources</div>
                      <div className="flex flex-wrap gap-2">
                        {m.sources.map((source, idx) => (
                          <a 
                            key={idx}
                            href={source.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2 py-1 bg-[#FF9F1C]/10 hover:bg-[#FF9F1C]/20 tactical-border text-[9px] transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {source.title || 'SOURCE DATA'}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {transcript && (
              <div className="flex flex-col items-end opacity-50">
                <div className="max-w-[85%] p-4 tactical-border bg-[#FF9F1C]/5 border-dashed">
                  <div className="flex items-center gap-2 mb-2 text-[10px] font-bold">
                    OFFICER (TRANSCRIBING...)
                  </div>
                  <p className="text-sm italic">{transcript}</p>
                </div>
              </div>
            )}

            {isProcessing && (
              <div className="flex items-center gap-2 text-xs animate-pulse">
                <Zap className="w-4 h-4" />
                <span>PROCESSING STRATEGIC RESPONSE...</span>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-950/20 border border-red-500/40 text-red-500 text-xs flex items-center gap-3">
                <AlertTriangle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="tactical-border p-4 bg-black/40 flex items-center gap-4">
            <button 
              onClick={toggleListening}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 relative ${
                alwaysListening 
                  ? 'bg-[#FF9F1C]/20 border-2 border-[#FF9F1C] shadow-[0_0_20px_rgba(255,159,28,0.4)]' 
                  : 'bg-black/40 border-2 border-[#FF9F1C]/20 hover:bg-[#FF9F1C]/10'
              }`}
            >
              {alwaysListening ? <Mic className="w-8 h-8 text-[#FF9F1C]" /> : <MicOff className="w-8 h-8 opacity-40" />}
              {isListening && (
                <motion.div 
                  className="absolute inset-0 rounded-full border-2 border-[#FF9F1C]"
                  animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
              )}
            </button>
            
            <div className="flex-1">
              <div className="text-[10px] mb-1 opacity-60 uppercase tracking-widest">
                {alwaysListening ? (isProcessing ? 'Processing...' : 'Always Listening...') : 'Comms Offline'}
              </div>
              <div className="h-8 flex items-center gap-1">
                {isListening || isSpeaking ? (
                  Array.from({ length: 24 }).map((_, i) => (
                    <motion.div 
                      key={i}
                      className="w-1 bg-[#FF9F1C]"
                      animate={{ 
                        height: [4, Math.random() * 24 + 4, 4],
                        opacity: [0.3, 1, 0.3]
                      }}
                      transition={{ 
                        repeat: Infinity, 
                        duration: 0.5, 
                        delay: i * 0.05 
                      }}
                    />
                  ))
                ) : (
                  <div className="w-full h-[1px] bg-[#FF9F1C]/20" />
                )}
              </div>
            </div>

            <div className="hidden sm:flex flex-col items-end gap-2">
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className="tactical-btn"
              >
                Log History
              </button>
              <div className="text-[9px] opacity-40">SECURE CHANNEL 07</div>
            </div>
          </div>
        </section>

        {/* Right Sidebar - Tactical Info */}
        <aside className="hidden lg:flex flex-col gap-6">
          <div className="tactical-border p-4 bg-black/40">
            <h3 className="text-xs font-bold mb-4 flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> TARGETING DATA
            </h3>
            <div className="aspect-square tactical-border relative overflow-hidden bg-[#FF9F1C]/5">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-[1px] bg-[#FF9F1C]/20" />
                <div className="h-full w-[1px] bg-[#FF9F1C]/20" />
                <div className="w-3/4 h-3/4 border border-[#FF9F1C]/20 rounded-full" />
                <div className="w-1/2 h-1/2 border border-[#FF9F1C]/20 rounded-full" />
                <div className="w-1/4 h-1/4 border border-[#FF9F1C]/20 rounded-full" />
              </div>
              <motion.div 
                className="absolute w-2 h-2 bg-red-500 rounded-full"
                animate={{ 
                  x: [20, 120, 60, 100], 
                  y: [40, 80, 140, 60],
                  opacity: [0, 1, 0.5, 1]
                }}
                transition={{ repeat: Infinity, duration: 10 }}
              />
              <div className="absolute bottom-2 right-2 text-[8px] opacity-60">
                GRID: 42.8N / 12.4E
              </div>
            </div>
          </div>

          <div className="tactical-border p-4 bg-black/40 flex-1">
            <h3 className="text-xs font-bold mb-4 flex items-center gap-2">
              <Terminal className="w-4 h-4" /> COMMAND LIST
            </h3>
            <ul className="text-[10px] space-y-3 opacity-60">
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 mt-0.5" />
                <span>"Status report" - System check</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 mt-0.5" />
                <span>"Analyze [subject]" - Strategic intel</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 mt-0.5" />
                <span>"Mission parameters" - Goal setting</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 mt-0.5" />
                <span>"Clear logs" - Reset interface</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>

      {/* Footer / Status Bar */}
      <footer className="mt-8 flex items-center justify-between text-[10px] opacity-40 uppercase tracking-widest relative z-10">
        <div className="flex gap-6">
          <span>Uptime: 14:22:05</span>
          <span>Project: CAESAR_INITIATIVE</span>
        </div>
        <div className="flex gap-6">
          <span>User: {process.env.USER_EMAIL || 'AUTHORIZED_USER'}</span>
          <span>Terminal: AIS-772</span>
        </div>
      </footer>

      {/* Mobile Overlay for History */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-50 p-8 flex flex-col"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold">MISSION LOGS</h2>
              <button onClick={() => setShowHistory(false)} className="tactical-btn">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4">
              {messages.map((m, i) => (
                <div key={i} className="tactical-border p-4">
                  <div className="text-[10px] opacity-40 mb-1">[{m.timestamp.toLocaleString()}] {m.role.toUpperCase()}</div>
                  <p className="text-sm">{m.content}</p>
                </div>
              ))}
              {messages.length === 0 && <p className="text-center opacity-20">NO LOGS RECORDED</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
