
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";
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

/**
 * v2.8 Global Knowledge Config
 * Specifically maps to gen-lang-client-0708024447 project for shared intelligence.
 */
const getFirebaseConfig = () => {
  const env = process.env;

  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyATY0par56GqdPFSkN7aplC9GEcSwftwD0",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "gen-lang-client-0708024447.firebaseapp.com",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "gen-lang-client-0708024447",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "gen-lang-client-0708024447.firebasestorage.app",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "372856387530",
    appId: env.VITE_FIREBASE_APP_ID || "1:372856387530:web:57c09241b68cfd1da24133",
    databaseURL: env.VITE_FIREBASE_DATABASE_URL || "https://gen-lang-client-0708024447-default-rtdb.firebaseio.com/",
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-6PF7DJXBYR"
  };

  addLog({ 
    type: 'SYSTEM', 
    label: 'COSMIC TRACE', 
    duration: 0, 
    status: 'SUCCESS', 
    message: `Laboratory Registry: Project ${config.projectId} active.` 
  });

  return config;
};

let db: any = null;
const firebaseConfig = getFirebaseConfig();

try {
  if (firebaseConfig.projectId && firebaseConfig.apiKey) {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    if (firebaseConfig.databaseURL) {
      db = getDatabase(app, firebaseConfig.databaseURL);
      addLog({ type: 'SYSTEM', label: 'WORLD BRAIN', duration: 0, status: 'SUCCESS', message: 'Synchronization path established.' });
    } else {
      addLog({ type: 'SYSTEM', label: 'WORLD BRAIN', duration: 0, status: 'SUCCESS', message: 'Local mode active (Missing DB URL).' });
    }
  }
} catch (e: any) {
  addLog({ type: 'ERROR', label: 'SYNC LAYER', duration: 0, status: 'ERROR', message: `Database init failed: ${e.message}` });
}

const getAI = () => {
  if (!process.env.API_KEY) {
    throw new Error("Missing Laboratory Key (Gemini API Key).");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/**
 * Fault-tolerant cache retrieval with timeout protection.
 */
async function getFromCache(category: string, key: string, dataType: string): Promise<any> {
  const start = performance.now();
  
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v12/${category}/${key}`);
      const snapshotPromise = get(dbRef);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Etheric Timeout')), 3000));
      const snapshot = await Promise.race([snapshotPromise, timeoutPromise]) as any;

      if (snapshot && snapshot.exists()) {
        const val = snapshot.val();
        addLog({ type: 'CACHE_DB', label: `GLOBAL HIT`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Shared ${dataType} retrieved from World Brain.` });
        localStorage.setItem(`discovery_v12_${category}_${key}`, val);
        return val;
      }
    } catch (e: any) {
      addLog({ type: 'ERROR', label: `GLOBAL FAIL`, duration: 0, status: 'ERROR', message: `World Brain retrieval error: ${e.message}` });
      addLog({ type: 'SYSTEM', label: `SYNC BYPASS`, duration: 0, status: 'SUCCESS', message: 'Checking local memories.' });
    }
  }

  const local = localStorage.getItem(`discovery_v12_${category}_${key}`);
  if (local) {
    addLog({ type: 'CACHE_DB', label: `LOCAL HIT`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Retrieved ${dataType} from memory.` });
    return local;
  }
  
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  const start = performance.now();
  try { localStorage.setItem(`discovery_v12_${category}_${key}`, data); } catch (e) {}
  
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v12/${category}/${key}`);
      const setPromise = set(dbRef, data);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
      await Promise.race([setPromise, timeoutPromise]);
      addLog({ type: 'CACHE_DB', label: 'GLOBAL SAVE', duration: performance.now() - start, status: 'SUCCESS', message: `Knowledge uploaded to World Brain.` });
    } catch (e: any) {
      addLog({ type: 'ERROR', label: 'UPLOAD FAIL', duration: 0, status: 'ERROR', message: `World Brain upload failed: ${e.message}` });
    }
  }
}

/**
 * Generates Einstein's academic response using Gemini 3 Pro.
 * Uses eraKey for global synchronization of chapter intros.
 */
export async function generateEinsteinResponse(prompt: string, history: any[], eraKey?: string): Promise<string> {
  const start = performance.now();
  // If eraKey is provided, we use it as a canonical key for shared knowledge
  const cacheKey = eraKey ? await generateCacheKey(`era_${eraKey}`) : await generateCacheKey(JSON.stringify({ prompt, history }));
  
  const cached = await getFromCache('response', cacheKey, 'thought');
  if (cached) return cached;

  addLog({ type: 'SYSTEM', label: 'KNOWLEDGE GAP', duration: 0, status: 'SUCCESS', message: eraKey ? `Generating canonical thought for ${eraKey}.` : 'No shared thought found. Consulting AI.' });

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
    const errorMsg = `Ach! A disturbance: ${e.message}`;
    addLog({ type: 'ERROR', label: 'VOID ERROR', duration: 0, status: 'ERROR', message: `AI generation failed: ${e.message}` });
    return errorMsg;
  }
}

/**
 * Generates a chalkboard image using Gemini 2.5 Flash Image.
 * Uses eraKey for shared diagrams.
 */
export async function generateChalkboardImage(prompt: string, eraKey?: string): Promise<string | null> {
  const start = performance.now();
  const cacheKey = eraKey ? await generateCacheKey(`img_${eraKey}`) : await generateCacheKey(prompt);
  
  const cached = await getFromCache('image', cacheKey, 'visual');
  if (cached) return cached;

  addLog({ type: 'SYSTEM', label: 'VISUAL GAP', duration: 0, status: 'SUCCESS', message: eraKey ? `Drafting shared visual for ${eraKey}.` : 'Creating new visual observation.' });

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { 
        parts: [{ text: `A detailed chalkboard sketch: ${prompt}. Style: hand-drawn white chalk, mathematical diagrams, 1920s style.` }] 
      },
      config: { imageConfig: { aspectRatio: '16:9' } }
    });

    let imageUrl = null;
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (imageUrl) {
      await saveToCache('image', cacheKey, imageUrl);
      addLog({ type: 'AI_IMAGE', label: 'OPTICS', duration: performance.now() - start, status: 'SUCCESS', message: 'Visual observation manifested on chalkboard.' });
    }
    return imageUrl;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'OPTIC FAIL', duration: 0, status: 'ERROR', message: `Visual generation error: ${e.message}` });
    return null;
  }
}

export async function generateEinsteinSpeech(text: string): Promise<string | null> {
  const start = performance.now();
  const cleanText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  if (!cleanText) return null;

  // We hash the exact text for speech caching to ensure it matches specific thoughts
  const cacheKey = await generateCacheKey(`voice_${cleanText.substring(0, 100)}`);
  const cached = await getFromCache('speech', cacheKey, 'vocal');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak as Einstein: ${cleanText}` }] }],
      config: {
        responseModalalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      await saveToCache('speech', cacheKey, base64Audio);
      addLog({ type: 'AI_AUDIO', label: 'HARMONY', duration: performance.now() - start, status: 'SUCCESS', message: 'Vocal frequencies captured.' });
    }
    return base64Audio || null;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'AUDIO FAIL', duration: 0, status: 'ERROR', message: `TTS generation error: ${e.message}` });
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
