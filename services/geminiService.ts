
import { GoogleGenAI, Modality } from "@google/genai";
import { ref, get, set, Database } from "firebase/database";
import { LogEntry } from "../types";
import { initWorldBrain } from "./firebase";

let performanceLogs: LogEntry[] = [];
let db: Database | null = null;

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

// Initialize World Brain on module load
initWorldBrain(addLog).then(instance => {
  db = instance;
});

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
  
  // Try World Brain (Global Sync)
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v12/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ type: 'CACHE_DB', label: `GLOBAL HIT`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Shared ${dataType} retrieved from World Brain.` });
        localStorage.setItem(`discovery_v12_${category}_${key}`, val);
        return val;
      }
    } catch (e) {}
  }

  // Fallback to Local Memory
  const local = localStorage.getItem(`discovery_v12_${category}_${key}`);
  if (local) {
    addLog({ type: 'CACHE_DB', label: `LOCAL HIT`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Retrieved ${dataType} from local memory.` });
    return local;
  }
  
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  const start = performance.now();
  localStorage.setItem(`discovery_v12_${category}_${key}`, data);
  
  if (db) {
    try {
      await set(ref(db, `world_brain_v12/${category}/${key}`), data);
      addLog({ type: 'CACHE_DB', label: 'GLOBAL SAVE', duration: performance.now() - start, status: 'SUCCESS', message: `Knowledge uploaded to World Brain.` });
    } catch (e) {}
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
      model: 'gemini-3-pro-preview',
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are Professor Albert Einstein. Address the user as 'My dear friend'. Be whimsical, humble, and academic. Use metaphors. If you generate an image tag, use the format [IMAGE: description]. Ensure your response contains equations in LaTeX format.",
        temperature: 0.8,
      }
    });

    const text = response.text || "Ach, ze universe remains a mystery.";
    await saveToCache('response', cacheKey, text);
    
    addLog({ type: 'AI_TEXT', label: 'RELATIVITY', duration: performance.now() - start, status: 'SUCCESS', message: 'New thought materialized from the ether.' });
    return text;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'GEN FAIL', duration: performance.now() - start, status: 'ERROR', message: `Thought failure: ${e.message}` });
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
        parts: [{ text: `A clear, high-contrast chalkboard diagram of: ${prompt}. Hand-drawn white chalk on black board, neat handwriting, scientific style.` }] 
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
      await saveToCache('image', cacheKey, imageUrl);
      addLog({ type: 'AI_IMAGE', label: 'OPTICS', duration: performance.now() - start, status: 'SUCCESS', message: 'Visual observation manifested on chalkboard.' });
    } else {
      addLog({ type: 'ERROR', label: 'OPTICS FAIL', duration: performance.now() - start, status: 'ERROR', message: 'Model returned content but no image data found.' });
    }
    return imageUrl;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'OPTICS FAIL', duration: performance.now() - start, status: 'ERROR', message: `Sketching failure: ${e.message}` });
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
      addLog({ type: 'AI_AUDIO', label: 'HARMONY', duration: performance.now() - start, status: 'SUCCESS', message: 'Vocal frequencies captured.' });
    }
    return base64Audio || null;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'HARMONY FAIL', duration: performance.now() - start, status: 'ERROR', message: `Vocal failure: ${e.message}` });
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
