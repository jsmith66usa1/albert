
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
 * v2.7 Environmental Synchronization Logic
 * Strictly uses process.env for environment variables to ensure compatibility and adhere to security guidelines.
 * Fallbacks are calibrated for the gen-lang-client-0708024447 project.
 */
const getFirebaseConfig = () => {
  // Fix: Use process.env instead of import.meta.env to satisfy TypeScript and consistency requirements
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

// Initialize Global Synchronization Layer (Realtime Database)
try {
  if (firebaseConfig.projectId && firebaseConfig.apiKey) {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    if (firebaseConfig.databaseURL) {
      db = getDatabase(app, firebaseConfig.databaseURL);
      addLog({ type: 'SYSTEM', label: 'WORLD BRAIN', duration: 0, status: 'SUCCESS', message: 'Synchronization path established.' });
    } else {
      addLog({ type: 'SYSTEM', label: 'WORLD BRAIN', duration: 0, status: 'SUCCESS', message: 'Local knowledge mode active (No DB URL).' });
    }
  }
} catch (e: any) {
  addLog({ type: 'SYSTEM', label: 'SYNC LAYER', duration: 0, status: 'ERROR', message: `Database init failed: ${e.message}` });
}

// Gemini AI initialization - process.env.API_KEY is restricted to this usage
const getAI = () => {
  if (!process.env.API_KEY) {
    throw new Error("Missing Laboratory Key (Gemini API Key). The experiment cannot proceed.");
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
        addLog({ type: 'CACHE_DB', label: `GLOBAL HIT`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Retrieved ${dataType} from World Brain.` });
        localStorage.setItem(`discovery_v12_${category}_${key}`, val);
        return val;
      }
    } catch (e) {
      addLog({ type: 'SYSTEM', label: `SYNC BYPASS`, duration: 0, status: 'SUCCESS', message: 'Global signal lost, checking local memory.' });
    }
  }

  const local = localStorage.getItem(`discovery_v12_${category}_${key}`);
  if (local) {
    addLog({ type: 'CACHE_DB', label: `LOCAL HIT`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Retrieved ${dataType} from local memory.` });
    return local;
  }
  
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  try { localStorage.setItem(`discovery_v12_${category}_${key}`, data); } catch (e) {}

  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v12/${category}/${key}`);
      const setPromise = set(dbRef, data);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
      await Promise.race([setPromise, timeoutPromise]);
    } catch (e) {}
  }
}

/**
 * Generates Einstein's academic response using Gemini 3 Pro.
 */
export async function generateEinsteinResponse(prompt: string, history: any[]): Promise<string> {
  const start = performance.now();
  const cacheKey = await generateCacheKey(JSON.stringify({ prompt, history }));
  
  const cached = await getFromCache('response', cacheKey, 'thought');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are Professor Albert Einstein. Address the user as 'My dear friend'. Be whimsical, humble, and academic. Use metaphors. If you generate an image tag, use the format [IMAGE: description]. Ensure your response contains equations in LaTeX format where appropriate.",
        temperature: 0.8,
      }
    });

    const text = response.text || "Ach, ze universe remains a mystery to me.";
    await saveToCache('response', cacheKey, text);
    
    addLog({ 
      type: 'AI_TEXT', 
      label: 'RELATIVITY', 
      duration: performance.now() - start, 
      status: 'SUCCESS', 
      message: 'Thought waves successfully materialized.' 
    });
    
    return text;
  } catch (e: any) {
    const errorMsg = `Ach! A disturbance in ze ether: ${e.message}`;
    addLog({ type: 'ERROR', label: 'VOID ERROR', duration: 0, status: 'ERROR', message: e.message });
    return errorMsg;
  }
}

/**
 * Generates a chalkboard image using Gemini 2.5 Flash Image.
 */
export async function generateChalkboardImage(prompt: string): Promise<string | null> {
  const start = performance.now();
  const cacheKey = await generateCacheKey(prompt);
  
  const cached = await getFromCache('image', cacheKey, 'visual');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { 
        parts: [{ text: `A highly detailed chalkboard sketch: ${prompt}. Style: hand-drawn white chalk on a dusty green chalkboard, intricate mathematical diagrams, academic atmosphere, 1920s laboratory style.` }] 
      },
      config: {
        imageConfig: { aspectRatio: '16:9' }
      }
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
  const cleanText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  if (!cleanText) return null;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak as Einstein: ${cleanText}` }] }],
      config: {
        // Fix: Correct typo responseModalalities -> responseModalities
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
      addLog({ 
        type: 'AI_AUDIO', 
        label: 'HARMONY', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Vocal frequencies resonated correctly.' 
      });
    }
    return base64Audio || null;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'AUDIO FAIL', duration: 0, status: 'ERROR', message: e.message });
    return null;
  }
}

/**
 * Manual implementation of base64 decoding for raw bytes.
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
 * Decodes raw PCM audio data into an Audio buffer.
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
