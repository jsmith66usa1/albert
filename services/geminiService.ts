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
export const getPerformanceLogs = () => performanceLogs;
export const clearPerformanceLogs = () => { performanceLogs = []; };

/**
 * TELEMETRY STREAM
 * Strictly isolated from the text stream. 
 * Dispatches events to the Log Modal listener only.
 */
const addLog = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
  const newLog: LogEntry = {
    ...entry,
    id: Math.random().toString(36).substr(2, 9),
    timestamp: Date.now()
  };
  performanceLogs = [newLog, ...performanceLogs].slice(0, 100);
  window.dispatchEvent(new CustomEvent('performance_log_updated'));
};

let db: any = null;
try {
  const startDb = performance.now();
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const dbUrl = firebaseConfig.databaseURL || (firebaseConfig.projectId ? `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com/` : undefined);
  if (dbUrl) {
    db = getDatabase(app, dbUrl);
    addLog({ 
      type: 'CACHE_DB', 
      label: 'World Brain Online', 
      duration: performance.now() - startDb, 
      status: 'SUCCESS', 
      message: 'Telemetry system initialized. All technical data routed to LOG modal.' 
    });
  }
} catch (e: any) {
  addLog({ type: 'ERROR', label: 'Registry Offline', duration: 0, status: 'ERROR', message: `Global sync unavailable: ${e.message}` });
}

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function getFromCache(category: string, key: string): Promise<any> {
  const start = performance.now();
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v8/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ 
          type: 'CACHE_DB', 
          label: `Cache Hit: ${category}`, 
          duration: performance.now() - start, 
          status: 'CACHE_HIT', 
          message: `Technical data recovered for ${key.substring(0,8)}.` 
        });
        return val;
      }
    } catch (e) {}
  }
  try {
    const local = localStorage.getItem(`discovery_v8_${category}_${key}`);
    if (local) return local;
  } catch (e) {}
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data) return;
  const start = performance.now();
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v8/${category}/${key}`);
      set(dbRef, data).catch(() => {});
      addLog({ 
        type: 'CACHE_DB', 
        label: `Sync: ${category}`, 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: `Knowledge propagated to Global Brain.` 
      });
    } catch (e) {}
  }
  try {
    localStorage.setItem(`discovery_v8_${category}_${key}`, data);
  } catch (e) {}
}

/**
 * PRIMARY TEXT STREAM
 * Strictly contains Professor Einstein's dialogue.
 * No log information is ever appended to the return value.
 */
export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]) {
  const cacheInput = JSON.stringify({ history, prompt });
  const key = await generateCacheKey(cacheInput);
  
  const cached = await getFromCache('responses', key);
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: history.concat([{ role: 'user', parts: [{ text: prompt }] }]),
      config: {
        systemInstruction: "You are Professor Albert Einstein. Use whimsical warmth. Use LaTeX for math. Use [IMAGE: description] for visuals. NEVER output technical log data or internal reasoning in your response.",
        temperature: 0.7,
      },
    });
    
    const textResult = result.text;
    if (textResult) {
      await saveToCache('responses', key, textResult);
      addLog({ 
        type: 'AI_TEXT', 
        label: 'Linguistic Synthesis', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Dialogue committed to registry.' 
      });
    }
    return textResult;
  } catch (e: any) {
    if (e.name === 'Canceled') return "";
    addLog({ type: 'ERROR', label: 'Synthesis Error', duration: performance.now() - start, status: 'ERROR', message: e.message });
    // Return a graceful Einsteinian error instead of technical jargon
    return "Ach, my dear friend. It seems the universe is temporarily folding in on itself. Let us try that thought again.";
  }
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  const cached = await getFromCache('images', key);
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ text: `Minimalist scientific chalkboard diagram: ${prompt}. White chalk on black background.` }],
      config: { imageConfig: { aspectRatio: "1:1" } }
    });

    let imageData = "";
    if (result.candidates?.[0]?.content?.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          imageData = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }
    if (imageData) {
      await saveToCache('images', key, imageData);
      addLog({ 
        type: 'AI_IMAGE', 
        label: 'Visual Manifestation', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Image synced to registry.' 
      });
    }
    return imageData;
  } catch (e: any) {
    if (e.name === 'Canceled') return "";
    addLog({ type: 'ERROR', label: 'Image Error', duration: performance.now() - start, status: 'ERROR', message: e.message });
    throw e;
  }
}

export async function generateEinsteinSpeech(text: string): Promise<string> {
  const speechText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  const key = await generateCacheKey(speechText);
  const cached = await getFromCache('audio', key);
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Einstein: ${speechText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      },
    });
    const base64 = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64) {
      await saveToCache('audio', key, base64);
      addLog({ 
        type: 'AI_AUDIO', 
        label: 'Sonic Synthesis', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Audio synthesized and cached.' 
      });
    }
    return base64 || "";
  } catch (e: any) {
    if (e.name === 'Canceled') return "";
    addLog({ type: 'ERROR', label: 'Audio Error', duration: 0, status: 'ERROR', message: e.message });
    throw e;
  }
}

export const decode = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

export const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number) => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
};