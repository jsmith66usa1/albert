import { GoogleGenAI, Modality } from "@google/genai";
import { LogEntry } from "../types";

let performanceLogs: LogEntry[] = [];

export const getPerformanceLogs = () => [...performanceLogs];
export const clearPerformanceLogs = () => { performanceLogs = []; };

const addLog = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
  const timestamp = Date.now();
  const newLog: LogEntry = {
    ...entry,
    id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp
  };
  performanceLogs = [newLog, ...performanceLogs].slice(0, 100);
  window.dispatchEvent(new CustomEvent('performance_log_updated', { detail: newLog }));
};

const getAI = () => {
  if (!process.env.API_KEY) throw new Error("Missing Laboratory Key (Gemini API Key).");
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function getFromCache(category: string, key: string, dataType: string): Promise<any> {
  const start = performance.now();
  const storageKey = `discovery_v12_${category}_${key}`;
  
  try {
    const local = localStorage.getItem(storageKey);
    if (local) {
      addLog({ 
        type: 'CACHE_DB', 
        label: `LOCAL HIT`, 
        duration: performance.now() - start, 
        status: 'CACHE_HIT', 
        message: `Retrieved ${dataType} from local memory.`, 
        source: 'geminiService.ts:40' 
      });
      return local;
    }
  } catch (e) {}
  
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  const start = performance.now();
  const storageKey = `discovery_v12_${category}_${key}`;
  
  try {
    localStorage.setItem(storageKey, data);
    addLog({ 
      type: 'CACHE_DB', 
      label: 'LOCAL SAVE', 
      duration: performance.now() - start, 
      status: 'SUCCESS', 
      message: `Knowledge saved to local laboratory storage.`, 
      source: 'geminiService.ts:57' 
    });
  } catch (e: any) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
       addLog({ 
         type: 'SYSTEM', 
         label: 'MEM FULL', 
         duration: 0, 
         status: 'ERROR', 
         message: 'Local storage quota exceeded. Image remains visible but unsaved locally.',
         source: 'geminiService.ts:66'
       });
    }
  }
}

export async function generateEinsteinResponse(prompt: string, history: any[], eraKey?: string): Promise<string> {
  const start = performance.now();
  const cacheKey = eraKey ? await generateCacheKey(`era_${eraKey}`) : await generateCacheKey(JSON.stringify({ prompt, history }));
  
  const cached = await getFromCache('response', cacheKey, 'thought');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are Professor Albert Einstein. Address the user as 'My dear friend'. Be whimsical, humble, and academic. Use metaphors. If you generate an image tag, use the format [IMAGE: description]. Ensure your response contains equations in LaTeX format.",
        temperature: 0.8,
      }
    });

    const text = response.text || "Ach, ze universe remains a mystery.";
    await saveToCache('response', cacheKey, text);
    
    addLog({ type: 'AI_TEXT', label: 'RELATIVITY', duration: performance.now() - start, status: 'SUCCESS', message: 'New thought materialized from the ether.', source: 'geminiService.ts:94' });
    return text;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'GEN FAIL', duration: performance.now() - start, status: 'ERROR', message: `Thought failure: ${e.message}`, source: 'geminiService.ts:97' });
    return `Ach! A disturbance: ${e.message}`;
  }
}

export async function generateChalkboardImage(prompt: string, eraKey?: string): Promise<string | null> {
  const start = performance.now();
  const cacheKey = eraKey ? await generateCacheKey(`img_${eraKey}`) : await generateCacheKey(prompt);
  
  const cached = await getFromCache('image', cacheKey, 'visual');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ 
        parts: [{ text: `A simple, clear chalkboard sketch: ${prompt}. White chalk on black, scientific diagram style.` }] 
      }],
      config: { 
        imageConfig: { aspectRatio: '16:9' }
      }
    });

    let imageUrl = null;
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (imageUrl) {
      try {
        await saveToCache('image', cacheKey, imageUrl);
      } catch (cacheErr) {}
      addLog({ type: 'AI_IMAGE', label: 'OPTICS', duration: performance.now() - start, status: 'SUCCESS', message: 'Visual observation manifested on chalkboard.', source: 'geminiService.ts:136' });
    } else {
      addLog({ type: 'ERROR', label: 'OPTICS FAIL', duration: performance.now() - start, status: 'ERROR', message: 'Model returned content but no image data found.', source: 'geminiService.ts:138' });
    }
    return imageUrl;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'OPTICS FAIL', duration: performance.now() - start, status: 'ERROR', message: `Sketching failure: ${e.message}`, source: 'geminiService.ts:142' });
    return null;
  }
}

export async function generateEinsteinSpeech(text: string): Promise<string | null> {
  const start = performance.now();
  const cleanText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  if (!cleanText) return null;

  const cacheKey = await generateCacheKey(`voice_${cleanText.substring(0, 100)}`);
  const cached = await getFromCache('speech', cacheKey, 'vocal');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak as Einstein: ${cleanText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Charon' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      await saveToCache('speech', cacheKey, base64Audio);
      addLog({ type: 'AI_AUDIO', label: 'HARMONY', duration: performance.now() - start, status: 'SUCCESS', message: 'Vocal frequencies captured.', source: 'geminiService.ts:174' });
    }
    return base64Audio || null;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'HARMONY FAIL', duration: performance.now() - start, status: 'ERROR', message: `Vocal failure: ${e.message}`, source: 'geminiService.ts:178' });
    return null;
  }
}

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}