
import { GoogleGenAI, Modality } from "@google/genai";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";
import { LogEntry } from "../types";

const firebaseConfig = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

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

let db: any = null;
try {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const dbUrl = firebaseConfig.databaseURL || (firebaseConfig.projectId ? `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com/` : undefined);
  if (dbUrl) {
    db = getDatabase(app, dbUrl);
    addLog({ 
      type: 'SYSTEM', 
      label: 'WORLD BRAIN', 
      duration: 0, 
      status: 'SUCCESS', 
      message: 'Global synchronization layer active. All laboratory nodes connected.' 
    });
  }
} catch (e: any) {
  addLog({ type: 'ERROR', label: 'REGISTRY FAULT', duration: 0, status: 'ERROR', message: 'Operating in local isolation mode.' });
}

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function getFromCache(category: string, key: string, dataType: string): Promise<any> {
  const start = performance.now();
  
  // 1. Check Global DB (Shared Knowledge)
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
          message: `Retrieved ${dataType} from shared laboratory memory.`
        });
        localStorage.setItem(`discovery_v12_${category}_${key}`, val);
        return val;
      }
    } catch (e) {}
  }

  // 2. Check Local Storage (Node Memory)
  const local = localStorage.getItem(`discovery_v12_${category}_${key}`);
  if (local) {
    addLog({ 
      type: 'CACHE_DB', 
      label: `LOCAL HIT`, 
      duration: performance.now() - start, 
      status: 'CACHE_HIT', 
      message: `Retrieved ${dataType} from local node memory.`
    });
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
      await set(dbRef, data);
    } catch (e) {}
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
  const key = await generateCacheKey(JSON.stringify({ history, prompt, systemInstruction }));
  
  const cached = await getFromCache('responses', key, 'TEXT');
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const contents = history.concat([{ role: 'user', parts: [{ text: prompt }] }]);
    const response = await ai.models.generateContent({ 
      model: 'gemini-3-pro-preview', 
      contents, 
      config: { systemInstruction, temperature: 0.85 } 
    });
    const result = response.text || "Ach, ze stars are blurry.";
    await saveToCache('responses', key, result);
    addLog({ type: 'AI_TEXT', label: 'SYNTHESIS', duration: performance.now() - start, status: 'SUCCESS', message: 'New thought synthesized and shared globally.' });
    return result;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'AI FAULT', duration: 0, status: 'ERROR', message: e.message });
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
      addLog({ type: 'AI_IMAGE', label: 'CHALK SKETCH', duration: performance.now() - start, status: 'SUCCESS', message: 'New diagram rendered and synced globally.' });
      return imageData;
    }
    throw new Error("No pixel data.");
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
