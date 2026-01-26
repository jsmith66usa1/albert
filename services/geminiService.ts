
import { GoogleGenAI, Modality } from "@google/genai";
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
  const sources = [
    { name: 'VITE_ENV', data: (import.meta as any).env || {} },
    { name: 'PROCESS_ENV', data: (typeof process !== 'undefined' && process.env) ? process.env : {} },
    { name: 'WINDOW_ENV', data: (window as any)._ENV || {} },
    { name: 'WINDOW_PROC', data: (window as any).process?.env || {} }
  ];

  const prefixes = ['', 'VITE_', 'REACT_APP_', 'NEXT_PUBLIC_', 'FIREBASE_'];

  // Deep probe for a specific variable
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

  // Diagnostic mapping
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
    message: `Probe Results (Source Map): ${Object.entries(results).map(([k,v]) => `${k}=${v}`).join(' | ')}`
  });

  // Extract raw values
  const rawId = probe('PROJECT_ID') || probe('GCP_PROJECT') || probe('GOOGLE_CLOUD_PROJECT');
  const rawDb = probe('DATABASE_URL');
  
  let projectId = rawId?.val || null;
  let databaseURL = rawDb?.val || null;

  // HEURISTIC 1: Extract Project ID from Database URL if ID is missing
  if (!projectId && databaseURL) {
    const match = databaseURL.match(/https:\/\/(.*?)\.firebaseio\.com/);
    if (match && match[1]) {
      projectId = match[1].replace('-default-rtdb', '');
      addLogFn({ type: 'SYSTEM', label: 'EXTRACTION', duration: 0, status: 'SUCCESS', message: `Extracted Project ID [${projectId}] from Database URL.` });
    }
  }

  // HEURISTIC 2: Construct Database URL from Project ID if URL is missing
  if (projectId && !databaseURL) {
    databaseURL = `https://${projectId}-default-rtdb.firebaseio.com/`;
    addLogFn({ type: 'SYSTEM', label: 'SYNTHESIS', duration: 0, status: 'SUCCESS', message: `Synthesized DB URL from Project ID [${projectId}].` });
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

// User's specific inquiry for the logs
addLog({
  type: 'SYSTEM',
  label: 'DEBUG INQUIRY',
  duration: 0,
  status: 'SUCCESS',
  message: `Diagnostic Request: Could you please share the detailed trace from your World Brain Registry (Logs), specifically the "Source Map" diagnostic information provided by Cosmic Fingerprint v2? I'm looking for the exact output that shows which environment source (Vite, Process, Window, or Meta) provided each piece of data, or clearly states "NOT_FOUND" for each key.`
});

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
      message: `Global synchronization layer active. Target: ${firebaseConfig.databaseURL}` 
    });
  } else {
    // Graceful handling if World Brain is not configured.
    addLog({ 
      type: 'SYSTEM', 
      label: 'WORLD BRAIN', 
      duration: 0, 
      status: 'SUCCESS', 
      message: `Sync Layer in Local Mode: No Project ID or DB URL found. Shared caching disabled.` 
    });
  }
} catch (e: any) {
  addLog({ type: 'SYSTEM', label: 'SYNC LAYER', duration: 0, status: 'SUCCESS', message: `Local session only: ${e.message}` });
}

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
    } catch (e) {
      console.warn("Global cache error", e);
    }
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
        message: `Knowledge published globally for all users.`
      });
    } catch (e: any) {
      addLog({ 
        type: 'ERROR', 
        label: 'SYNC ERROR', 
        duration: 0, 
        status: 'ERROR', 
        message: `Failed to publish to Global Brain: ${e.message}` 
      });
    }
  }
}

function mathPhoneticizer(text: string): string {
  return text
    .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '$1 over $2')
    .replace(/\\Delta/g, 'delta')
    .replace(/\\hbar/g, 'h-bar')
    .replace(/\\geq/g, 'greater than or equal to')
    .replace(/\\leq/g, 'less than or equal to')
    .replace(/\\pi/g, 'pi')
    .replace(/\\infty/g, 'infinity')
    .replace(/\\int/g, 'the integral')
    .replace(/\^2/g, ' squared')
    .replace(/\^3/g, ' cubed')
    .replace(/_/g, ' ') 
    .replace(/\[IMAGE:.*?\]/g, '') 
    .replace(/\$|\\|\{|\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]): Promise<string> {
  const systemInstruction = `You are Professor Albert Einstein. Use a whimsical German accent. Use LaTeX for math. Include exactly one [IMAGE: visual description] tag.`;
  const cacheInput = JSON.stringify({ history, prompt, systemInstruction });
  const key = await generateCacheKey(cacheInput);
  
  const cached = await getFromCache('responses', key, 'TEXT');
  if (cached) return cached;
  
  const start = performance.now();
  try {
    const ai = getAI();
    const contents = history.concat([{ role: 'user', parts: [{ text: prompt }] }]);
    addLog({ type: 'SYSTEM', label: 'AI THINKING', duration: 0, status: 'SUCCESS', message: 'Synthesizing with Gemini 3 Pro...' });
    
    const response = await ai.models.generateContent({ 
      model: 'gemini-3-pro-preview', 
      contents, 
      config: { systemInstruction, temperature: 0.85 } 
    });
    
    const result = response.text || "Ach, ze stars are blurry.";
    await saveToCache('responses', key, result);
    addLog({ type: 'AI_TEXT', label: 'SYNTHESIS', duration: performance.now() - start, status: 'SUCCESS', message: 'New thought synthesized and shared.' });
    return result;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'AI FAULT', duration: 0, status: 'ERROR', message: `Einstein is confused: ${e.message}` });
    return "Ach, my brain is a bit messy today.";
  }
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  const cached = await getFromCache('images', key, 'SKETCH');
  if (cached) return cached;
  
  const start = performance.now();
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `A physics chalkboard drawing with white chalk: ${prompt}` }] }
    });
    
    let imageData = "";
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageData = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }
    
    if (imageData) {
      await saveToCache('images', key, imageData);
      addLog({ type: 'AI_IMAGE', label: 'CHALK SKETCH', duration: performance.now() - start, status: 'SUCCESS', message: 'New diagram rendered and synced.' });
      return imageData;
    }
    throw new Error("No pixel data returned.");
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'SKETCH FAULT', duration: 0, status: 'ERROR', message: e.message });
    throw e;
  }
}

export async function generateEinsteinSpeech(text: string): Promise<string> {
  const optimized = mathPhoneticizer(text).substring(0, 1000);
  if (!optimized) return "";
  const key = await generateCacheKey(optimized);
  const cached = localStorage.getItem(`discovery_v12_audio_${key}`);
  if (cached) return cached;
  
  const start = performance.now();
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Speak as Albert Einstein: ${optimized}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      },
    });
    
    const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64) {
      try { localStorage.setItem(`discovery_v12_audio_${key}`, base64); } catch(e) {}
      addLog({ type: 'AI_AUDIO', label: 'VOCAL SYNTH', duration: performance.now() - start, status: 'SUCCESS', message: 'Speech articulated locally.' });
      return base64;
    }
    throw new Error("Mute response.");
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'VOCAL FAULT', duration: 0, status: 'ERROR', message: e.message });
    throw e;
  }
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const byteLength = data.byteLength - (data.byteLength % 2);
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, byteLength / 2);
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
