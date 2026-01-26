
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";
import { LogEntry } from "../types";

let performanceLogs: LogEntry[] = [];
export const getPerformanceLogs = () => [...performanceLogs];
export const clearPerformanceLogs = () => { performanceLogs = []; };

// Centralized logging for the laboratory
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

/**
 * v2 Hyper-Scanner Environment Discovery
 * Probes memory sources directly and uses heuristics to fill missing configuration.
 */
const getFirebaseConfig = (addLogFn: (entry: any) => void) => {
  // Vite-specific environment access
  const viteEnv = (import.meta as any).env || {};
  // Node-style environment access (fallback)
  const procEnv = (typeof process !== 'undefined' && process.env) ? process.env : {};
  
  const sources = [
    { name: 'VITE_ENV', data: viteEnv },
    { name: 'PROCESS_ENV', data: procEnv },
    { name: 'WINDOW_ENV', data: (window as any)._ENV || {} }
  ];

  // For Firebase, we prefer the VITE_ prefix as per modern standards
  const prefixes = ['VITE_FIREBASE_', 'VITE_', 'FIREBASE_', ''];

  const probe = (key: string) => {
    for (const source of sources) {
      for (const p of prefixes) {
        const fullKey = p + key;
        const val = source.data[fullKey];
        if (val) return { val: String(val), source: source.name, key: fullKey };
      }
    }
    return null;
  };

  const keysToProbe = ['PROJECT_ID', 'DATABASE_URL', 'API_KEY', 'AUTH_DOMAIN', 'APP_ID'];
  const results: Record<string, string> = {};
  
  keysToProbe.forEach(k => {
    const found = probe(k);
    if (found) {
      const isSensitive = k.includes('KEY');
      results[k] = `${found.source}->${found.key} (${isSensitive ? `MASKED:${found.val.length}` : found.val})`;
    } else {
      results[k] = 'NOT_FOUND';
    }
  });

  addLogFn({ 
    type: 'SYSTEM', 
    label: 'COSMIC TRACE', 
    duration: 0, 
    status: 'SUCCESS', 
    message: `Environment Probe: ${Object.entries(results).map(([k,v]) => `${k}=${v}`).join(' | ')}`
  });

  // Extraction logic for initialization
  const rawId = probe('PROJECT_ID')?.val;
  const rawDb = probe('DATABASE_URL')?.val;
  
  let projectId = rawId || null;
  let databaseURL = rawDb || null;

  // Heuristic fallbacks
  if (!projectId && databaseURL) {
    const match = databaseURL.match(/https:\/\/(.*?)\.firebaseio\.com/);
    if (match) projectId = match[1].replace('-default-rtdb', '');
  }
  if (projectId && !databaseURL) {
    databaseURL = `https://${projectId}-default-rtdb.firebaseio.com/`;
  }

  if (!projectId || !databaseURL) {
    addLogFn({ 
      type: 'ERROR', 
      label: 'REGISTRY FAIL', 
      duration: 0, 
      status: 'ERROR', 
      message: `Firebase setup incomplete. Ensure VITE_FIREBASE_PROJECT_ID is set.`
    });
  }

  return {
    apiKey: probe('API_KEY')?.val,
    authDomain: probe('AUTH_DOMAIN')?.val,
    databaseURL,
    projectId,
    storageBucket: probe('STORAGE_BUCKET')?.val,
    messagingSenderId: probe('MESSAGING_SENDER_ID')?.val,
    appId: probe('APP_ID')?.val
  };
};

let db: any = null;
const firebaseConfig = getFirebaseConfig(addLog);

// Initialize Global Synchronization Layer
try {
  if (firebaseConfig.projectId && firebaseConfig.databaseURL) {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getDatabase(app, firebaseConfig.databaseURL);
    addLog({ 
      type: 'SYSTEM', 
      label: 'WORLD BRAIN', 
      duration: 0, 
      status: 'SUCCESS', 
      message: `Global synchronization active at ${firebaseConfig.databaseURL}` 
    });
  } else {
    addLog({ 
      type: 'SYSTEM', 
      label: 'WORLD BRAIN', 
      duration: 0, 
      status: 'SUCCESS', 
      message: `Local Mode: Knowledge stored in browser memory only.` 
    });
  }
} catch (e: any) {
  addLog({ type: 'SYSTEM', label: 'SYNC LAYER', duration: 0, status: 'SUCCESS', message: `Database init failed: ${e.message}` });
}

// Gemini AI setup as per instructions
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/**
 * Retrieves cached data from World Brain (Firebase) or Local Memory.
 */
async function getFromCache(category: string, key: string, dataType: string): Promise<any> {
  const start = performance.now();
  
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v12/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ 
          type: 'CACHE_DB', 
          label: `GLOBAL HIT`, 
          duration: performance.now() - start, 
          status: 'CACHE_HIT', 
          message: `Retrieved shared ${dataType} from World Brain.`
        });
        localStorage.setItem(`discovery_v12_${category}_${key}`, val);
        return val;
      }
    } catch (e) {}
  }

  const local = localStorage.getItem(`discovery_v12_${category}_${key}`);
  if (local) {
    addLog({ 
      type: 'CACHE_DB', 
      label: `LOCAL HIT`, 
      duration: performance.now() - start, 
      status: 'CACHE_HIT', 
      message: `Retrieved ${dataType} from local memory.`
    });
    return local;
  }
  
  return null;
}

/**
 * Saves data to both Local Memory and World Brain (Firebase).
 */
async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  
  const start = performance.now();
  try { localStorage.setItem(`discovery_v12_${category}_${key}`, data); } catch (e) {}

  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v12/${category}/${key}`);
      await set(dbRef, data);
      addLog({ 
        type: 'CACHE_DB', 
        label: `GLOBAL SYNC`, 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: `Knowledge published globally.`
      });
    } catch (e: any) {}
  }
}

/**
 * Generates Einstein's academic response using Gemini 3 Pro.
 */
export async function generateEinsteinResponse(prompt: string, history: any[]): Promise<string> {
  const start = performance.now();
  const ai = getAI();
  const cacheKey = await generateCacheKey(JSON.stringify({ prompt, history }));
  
  const cached = await getFromCache('response', cacheKey, 'thought');
  if (cached) return cached;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are Professor Albert Einstein. Address the user as 'My dear friend'. Be whimsical, humble, and academic. Use metaphors. If you generate an image tag, use the format [IMAGE: description].",
        temperature: 0.8,
      }
    });

    const text = response.text || "Ach, ze universe remains a mystery.";
    await saveToCache('response', cacheKey, text);
    
    addLog({ 
      type: 'AI_TEXT', 
      label: 'RELATIVITY', 
      duration: performance.now() - start, 
      status: 'SUCCESS', 
      message: 'Thought waves successfully captured.' 
    });
    
    return text;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'VOID ERROR', duration: 0, status: 'ERROR', message: e.message });
    throw e;
  }
}

/**
 * Generates a chalkboard image using Gemini 2.5 Flash Image.
 */
export async function generateChalkboardImage(prompt: string): Promise<string | null> {
  const start = performance.now();
  const ai = getAI();
  const cacheKey = await generateCacheKey(prompt);
  
  const cached = await getFromCache('image', cacheKey, 'visual');
  if (cached) return cached;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `A chalkboard sketch of: ${prompt}. Style: old chalkboard with white chalk, rough texture, academic, intricate detail, charcoal-like.` }] },
      config: {
        imageConfig: { aspectRatio: '16:9' }
      }
    });

    let imageUrl = null;
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        imageUrl = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }

    if (imageUrl) {
      await saveToCache('image', cacheKey, imageUrl);
      addLog({ 
        type: 'AI_IMAGE', 
        label: 'OPTICS', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Visual observation manifested on chalkboard.' 
      });
    }
    
    return imageUrl;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'OPTIC FAIL', duration: 0, status: 'ERROR', message: e.message });
    return null;
  }
}

/**
 * Generates Einstein's speech audio using Gemini TTS.
 */
export async function generateEinsteinSpeech(text: string): Promise<string | null> {
  const start = performance.now();
  const ai = getAI();
  const cleanText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  if (!cleanText) return null;

  const cacheKey = await generateCacheKey(cleanText);
  const cached = await getFromCache('speech', cacheKey, 'resonance');
  if (cached) return cached;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak as Einstein: ${cleanText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Charon' }
          }
        }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      await saveToCache('speech', cacheKey, base64Audio);
      addLog({ 
        type: 'AI_AUDIO', 
        label: 'HARMONY', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Sound waves resonated through ze ether.' 
      });
    }
    return base64Audio || null;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'AUDIO FAIL', duration: 0, status: 'ERROR', message: e.message });
    return null;
  }
}

/**
 * Manual implementation of base64 decoding to bytes as required by guidelines.
 */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM audio data into an AudioBuffer as required by guidelines.
 */
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
