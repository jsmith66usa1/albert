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

// Internal Log Store
let performanceLogs: LogEntry[] = [];
export const getPerformanceLogs = () => performanceLogs;
export const clearPerformanceLogs = () => { performanceLogs = []; };

const addLog = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
  const logTask = () => {
    const newLog: LogEntry = {
      ...entry,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
    performanceLogs = [newLog, ...performanceLogs].slice(0, 100);
    window.dispatchEvent(new CustomEvent('performance_log_updated'));
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(logTask);
  } else {
    setTimeout(logTask, 0);
  }
};

let db: any = null;
try {
  const startDb = performance.now();
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const dbUrl = firebaseConfig.databaseURL || (firebaseConfig.projectId ? `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com/` : undefined);
  if (dbUrl) {
    db = getDatabase(app, dbUrl);
    addLog({ type: 'CACHE_DB', label: 'Firebase Sync', duration: performance.now() - startDb, status: 'SUCCESS', message: 'Successfully connected to the World Brain. Your discoveries are now shared globally with all users in real-time via Firebase.' });
  }
} catch (e: any) {
  addLog({ type: 'ERROR', label: 'Firebase Offline', duration: 0, status: 'ERROR', message: `[DIAGNOSTIC_RECOVERY] Global sync unavailable. Discoveries will remain local to this device. Error: ${e.message}` });
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
      const dbRef = ref(db, `einstein_global_v1/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ type: 'CACHE_DB', label: `Global ${category} Retrieval`, duration: performance.now() - start, status: 'CACHE_HIT', message: `Retrieved shared discovery [ID: ${key.substring(0,8)}] from the Global Firebase Cache. This intelligence (text/image/audio) was previously contributed by another user to the World Brain.` });
        return val;
      }
    } catch (e: any) {
      addLog({ type: 'ERROR', label: `Global ${category} Fetch Error`, duration: performance.now() - start, status: 'ERROR', message: `[DIAGNOSTIC_RECOVERY] RTDB Read failure: ${e.message}. Falling back to local device memory.` });
    }
  }

  const local = localStorage.getItem(`einstein_local_${category}_${key}`);
  if (local) {
    addLog({ type: 'CACHE_DB', label: `Local ${category} Retrieval`, duration: performance.now() - start, status: 'CACHE_HIT', message: 'Retrieved from device-specific browser storage.' });
  }
  return local;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data) return;
  const start = performance.now();
  try {
    // Attempt local cache first
    try {
      localStorage.setItem(`einstein_local_${category}_${key}`, data);
    } catch (localErr) {}

    if (db) {
      const dbRef = ref(db, `einstein_global_v1/${category}/${key}`);
      await set(dbRef, data);
      addLog({ type: 'CACHE_DB', label: `Global ${category} Persistence`, duration: performance.now() - start, status: 'SUCCESS', message: `Manifestation [ID: ${key.substring(0,8)}] successfully synchronized with the Global Firebase World Brain. This discovery (text/image/audio) is now instantly available to every user on the planet.` });
    }
  } catch (e: any) {
    addLog({ type: 'ERROR', label: `Global ${category} Sync Failure`, duration: performance.now() - start, status: 'ERROR', message: `[DIAGNOSTIC_RECOVERY] Global Persistence failure: ${e.message}. Discovery is currently isolated to this observer's session.` });
  }
}

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]) {
  const cacheInput = JSON.stringify({ history, prompt });
  const key = await generateCacheKey(cacheInput);
  const cached = await getFromCache('responses', key);
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: history.concat([{ role: 'user', parts: [{ text: prompt }] }]),
      config: {
        systemInstruction: "You are Professor Albert Einstein. Speak with whimsical German-accented warmth. Be concise and elegant. Address user as 'My dear friend'. Use LaTeX for equations. If a new concept is introduced, add [IMAGE: description] for a chalkboard diagram. Use simple, beautiful analogies. You are part of a 'World Brain' - your answers are shared globally with all users.",
        temperature: 0.7,
      },
    });
    
    const textResult = response.text;
    if (textResult) {
      addLog({ type: 'AI_TEXT', label: 'Linguistic Computation', duration: performance.now() - start, status: 'SUCCESS', message: `The Professor synthesized a new linguistic response. Synchronizing this text data with the Global World Brain via Firebase.` });
      await saveToCache('responses', key, textResult);
    }
    return textResult;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'AI Synthesis Error', duration: performance.now() - start, status: 'ERROR', message: `[DIAGNOSTIC_RECOVERY] Logic Engine failure: ${e.message}.` });
    throw e;
  }
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  const cached = await getFromCache('images', key);
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ text: `A clean, minimalist chalkboard scientific diagram: ${prompt}. White chalk lines on dark dusty black background. Elegant handwriting. High contrast.` }],
      config: { imageConfig: { aspectRatio: "1:1" } }
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
      addLog({ type: 'AI_IMAGE', label: 'Visual Manifestation', duration: performance.now() - start, status: 'SUCCESS', message: 'New chalkboard visualization rendered. Transmitting binary image data to the Global Firebase cluster for universal synchronization.' });
      await saveToCache('images', key, imageData);
    }
    return imageData;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'Visual Synthesis Error', duration: performance.now() - start, status: 'ERROR', message: `[DIAGNOSTIC_RECOVERY] Image manifestation failed: ${e.message}.` });
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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say this with a gentle, wise, elderly German intellectual tone: ${speechText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      addLog({ type: 'AI_AUDIO', label: 'Sonic Synthesis', duration: performance.now() - start, status: 'SUCCESS', message: 'Audio waveform synthesized for the Professor. Streaming audio bytes to the Global Firebase Cache so all users share the same voice.' });
      await saveToCache('audio', key, base64Audio);
    }
    return base64Audio;
  } catch (e: any) {
    addLog({ type: 'ERROR', label: 'Audio Synthesis Error', duration: performance.now() - start, status: 'ERROR', message: `[DIAGNOSTIC_RECOVERY] TTS Sonic failure: ${e.message}.` });
    throw e;
  }
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
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