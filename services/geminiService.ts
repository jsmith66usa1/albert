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

const addLog = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
  const newLog: LogEntry = {
    ...entry,
    id: Math.random().toString(36).substr(2, 9),
    timestamp: Date.now()
  };
  performanceLogs = [newLog, ...performanceLogs].slice(0, 100);
  window.dispatchEvent(new CustomEvent('performance_log_updated', { detail: newLog }));
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
      message: 'Permanent global registry connected and ready.' 
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
      const dbRef = ref(db, `world_brain_v9/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ 
          type: 'CACHE_DB', 
          label: `GLOBAL REGISTRY HIT: ${category}`, 
          duration: performance.now() - start, 
          status: 'CACHE_HIT', 
          message: `Shared knowledge retrieved from permanent global brain. Key: ${key}` 
        });
        localStorage.setItem(`discovery_v9_${category}_${key}`, val);
        return val;
      }
    } catch (e) {}
  }

  try {
    const local = localStorage.getItem(`discovery_v9_${category}_${key}`);
    if (local) {
      addLog({ 
        type: 'CACHE_DB', 
        label: `LOCAL HIT: ${category}`, 
        duration: performance.now() - start, 
        status: 'CACHE_HIT', 
        message: `Local asset found in browser storage. Key: ${key}` 
      });
      return local;
    }
  } catch (e) {}

  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data) return;
  const start = performance.now();
  
  try {
    localStorage.setItem(`discovery_v9_${category}_${key}`, data);
  } catch (e) {}

  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v9/${category}/${key}`);
      await set(dbRef, data);
      addLog({ 
        type: 'CACHE_DB', 
        label: `GLOBAL SYNC: ${category}`, 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: `Knowledge synchronized to permanent global registry. Key: ${key}` 
      });
    } catch (e) {}
  }
}

/**
 * Phonetic Mathematical Translation
 * Converts LaTeX and symbols into speakable strings to prevent TTS crashes.
 */
function mathPhoneticizer(text: string): string {
  return text
    .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '$1 divided by $2')
    .replace(/\\Delta/g, 'delta')
    .replace(/\\hbar/g, 'h-bar')
    .replace(/\\geq/g, 'is greater than or equal to')
    .replace(/\\pi/g, 'pi')
    .replace(/\\mu/g, 'mew')
    .replace(/\\nu/g, 'new')
    .replace(/\\int/g, 'the integral of')
    .replace(/\^2/g, ' squared')
    .replace(/\^([0-9a-zA-Z]+)/g, ' to the power of $1')
    .replace(/R_\{.*?\}/g, 'R')
    .replace(/T_\{.*?\}/g, 'T')
    .replace(/g_\{.*?\}/g, 'g')
    .replace(/\+/g, ' plus ')
    .replace(/=/g, ' equals ')
    .replace(/-/g, ' minus ')
    .replace(/\*/g, ' times ')
    .replace(/\[IMAGE:.*?\]/g, '') // Remove image tags from speech
    .replace(/\$/g, '') // Remove LaTeX delimiters
    .trim();
}

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]) {
  const model = 'gemini-3-pro-preview';
  const systemInstruction = "You are Professor Albert Einstein. Speak with a strong, whimsical German accent (e.g., use 'v' for 'w', 'z' for 'th' where appropriate, or simply write in a way that implies the cadence). Use whimsical warmth. Use LaTeX for math. Use [IMAGE: description] for visuals. NEVER output technical log data.";
  
  const cacheInput = JSON.stringify({ history, prompt, systemInstruction, model });
  const key = await generateCacheKey(cacheInput);
  
  const cached = await getFromCache('responses', key);
  if (cached) return cached;

  const start = performance.now();
  const temperature = 0.7;

  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: model,
      contents: history.concat([{ role: 'user', parts: [{ text: prompt }] }]),
      config: {
        systemInstruction: systemInstruction,
        temperature: temperature,
      },
    });
    
    const textResult = result.text;
    if (textResult) {
      await saveToCache('responses', key, textResult);
      addLog({ 
        type: 'AI_TEXT', 
        label: 'DIALOGUE SYNTHESIS', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'New shared knowledge synthesized.',
        metadata: { model, request: { prompt, history_length: history.length } }
      });
    }
    return textResult;
  } catch (e: any) {
    if (e.name === 'Canceled') return "";
    addLog({ 
      type: 'ERROR', 
      label: 'AI FAULT', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: e.message
    });
    return "Ach, my dear friend. It seems ze universe is temporarily folding in on itself. Let us try zat thought again.";
  }
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  const cached = await getFromCache('images', key);
  if (cached) return cached;

  const start = performance.now();
  const model = 'gemini-2.5-flash-image';
  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: model,
      contents: [{ text: `Minimalist scientific chalkboard diagram: ${prompt}. Use thin, precise white chalk lines on a deep black background. High contrast, clean educational style.` }],
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
        label: 'IMAGE MANIFESTATION',
        duration: performance.now() - start,
        status: 'SUCCESS',
        message: 'Chalkboard visualization complete.',
        metadata: { model, prompt }
      });
    }
    return imageData;
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'VISUAL ERROR', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: e.message
    });
    throw e;
  }
}

export async function generateEinsteinSpeech(text: string): Promise<string> {
  // Use the phoneticizer to make math speakable and clean up formatting
  const optimizedSpeechText = mathPhoneticizer(text).substring(0, 900);
  
  const key = await generateCacheKey(optimizedSpeechText);
  const cached = await getFromCache('audio', key);
  if (cached) return cached;

  const start = performance.now();
  const model = "gemini-2.5-flash-preview-tts";
  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: model,
      contents: [{ parts: [{ text: `Read with a whimsical German accent: ${optimizedSpeechText}` }] }],
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
        label: 'VOCAL SYNTHESIS',
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: 'Vocal bytes generated.',
        metadata: { model, text_length: optimizedSpeechText.length }
      });
    }
    return base64 || "";
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'VOCAL FAULT', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: e.message
    });
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
