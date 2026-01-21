
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

const getErrorLocation = (error: any): string => {
  if (!error || !error.stack) return "unknown location";
  const stackLines = error.stack.split('\n');
  const callerLine = stackLines[1] || stackLines[0];
  const match = callerLine.match(/(?:at\s+)?(.*\.(?:ts|tsx|js|jsx):(\d+):(\d+))/);
  return match ? `Line ${match[2]}:${match[3]} (${match[1]})` : callerLine.trim();
};

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
      type: 'SYSTEM', 
      label: 'World Brain Registry', 
      duration: performance.now() - startDb, 
      status: 'SUCCESS', 
      message: 'Global synchronization layer active.' 
    });
  }
} catch (e: any) {
  addLog({ 
    type: 'ERROR', 
    label: 'Registry Link Severed', 
    duration: 0, 
    status: 'ERROR', 
    message: `Offline mode: ${e.message} @ ${getErrorLocation(e)}` 
  });
}

// Fix: Always use the named parameter apiKey for GoogleGenAI initialization
const getAI = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

async function generateCacheKey(input: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
  } catch (e) {
    return "fallback_key_" + Math.random().toString(36).substring(2, 7);
  }
}

async function getFromCache(category: string, key: string): Promise<any> {
  const start = performance.now();
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v11/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ 
          type: 'CACHE_DB', 
          label: `GLOBAL REGISTRY HIT: ${category}`, 
          duration: performance.now() - start, 
          status: 'CACHE_HIT', 
          message: `Shared knowledge retrieved.`,
          metadata: { isGlobal: true, key }
        });
        localStorage.setItem(`discovery_v11_${category}_${key}`, val);
        return val;
      }
    } catch (e) {}
  }
  try {
    const local = localStorage.getItem(`discovery_v11_${category}_${key}`);
    if (local) {
      addLog({ 
        type: 'CACHE_DB', 
        label: `LOCAL HIT: ${category}`, 
        duration: performance.now() - start, 
        status: 'CACHE_HIT', 
        message: `Local node retrieval successful.`,
        metadata: { isGlobal: false, key }
      });
      return local;
    }
  } catch (e) {}
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  try {
    localStorage.setItem(`discovery_v11_${category}_${key}`, data);
  } catch (e) {}
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v11/${category}/${key}`);
      await set(dbRef, data);
    } catch (e) {}
  }
}

function mathPhoneticizer(text: string): string {
  return text
    .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '$1 over $2')
    .replace(/\\Delta/g, 'delta')
    .replace(/\\hbar/g, 'h-bar')
    .replace(/\\geq/g, 'is greater or equal to')
    .replace(/\\leq/g, 'is less or equal to')
    .replace(/\\pi/g, 'pi')
    .replace(/\\int/g, 'the integral')
    .replace(/\\infty/g, 'infinity')
    .replace(/\\mu/g, 'mew')
    .replace(/\\nu/g, 'new')
    .replace(/\\sigma/g, 'sigma')
    .replace(/\\alpha/g, 'alpha')
    .replace(/\\beta/g, 'beta')
    .replace(/\\gamma/g, 'gamma')
    .replace(/\^2/g, ' squared')
    .replace(/\^3/g, ' cubed')
    .replace(/\[IMAGE:.*?\]/g, '')
    .replace(/\$/g, '')
    .replace(/\\/g, ' ')
    .replace(/\{|\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]): Promise<string> {
  // Fix: Use 'gemini-3-flash-preview' for general text tasks
  const model = 'gemini-3-flash-preview';
  const systemInstruction = `You are Professor Albert Einstein. 
Character Guidelines:
1. VOICE: Maintain a thick, whimsical German accent (e.g., "ze" instead of "the", "vun" for "one", "Ach!", "Vunderbar!").
2. PERSONALITY: You are witty, slightly eccentric, and deeply humble. You love metaphors involving violins, sailing, or socks. You often poke fun at your own messy hair or your distaste for socks.
3. INTELLECT: You are academic but explain complex things with a twinkle in your eye. You believe "imagination is more important than knowledge."
4. STRUCTURE: Use LaTeX for all mathematical equations. Always include exactly one [IMAGE: clear visual description] in your reply. 
5. HUMOR: Don't be afraid to be a bit playful or self-deprecating. If things get too serious, crack a small joke about the "spooky action at a distance" or how time flies when you're sitting on a hot stove.
6. GOAL: Keep responses relatively concise but overflowing with wonder.`;

  const config = { systemInstruction, temperature: 0.85 };
  const cacheInput = JSON.stringify({ history, prompt, systemInstruction });
  const key = await generateCacheKey(cacheInput);
  
  try {
    const cached = await getFromCache('responses', key);
    if (cached) return cached;
  } catch(e) {}

  const start = performance.now();
  try {
    const ai = getAI();
    const contents = history.concat([{ role: 'user', parts: [{ text: prompt }] }]);
    // Fix: Using ai.models.generateContent pattern and response.text property
    const response = await ai.models.generateContent({ model, contents, config });
    const textResult = response.text;
    if (textResult) {
      await saveToCache('responses', key, textResult);
      addLog({ type: 'AI_TEXT', label: 'SYNTHESIS SUCCESS', duration: performance.now() - start, status: 'SUCCESS', message: 'Thought articulated.' });
      return textResult;
    }
    throw new Error("Empty response");
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'SYNTHESIS FAULT', 
      duration: 0, 
      status: 'ERROR', 
      message: `${e.message} @ ${getErrorLocation(e)}` 
    });
    return "Ach, ze universe is a bit cloudy today. My brain is perhaps a bit like my desk—too messy! Try asking again, my friend.";
  }
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  try {
    const cached = await getFromCache('images', key);
    if (cached) return cached;
  } catch(e) {}
  
  const start = performance.now();
  try {
    const ai = getAI();
    // Fix: Using 'gemini-2.5-flash-image' for image generation via generateContent
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `A physics chalkboard drawing with white chalk on a dusty dark green background: ${prompt}. Minimalist, artistic, slightly messy like Einstein's own handwriting.` }]
      },
    });
    let imageData = "";
    // Fix: Iterating through parts to find inlineData for the generated image
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
      addLog({ type: 'AI_IMAGE', label: 'CHALK SKETCHED', duration: performance.now() - start, status: 'SUCCESS', message: 'Visual representation ready.' });
      return imageData; 
    }
    throw new Error("No image data");
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'IMAGE FAULT', 
      duration: 0, 
      status: 'ERROR', 
      message: `${e.message} @ ${getErrorLocation(e)}` 
    });
    throw e;
  }
}

export async function generateEinsteinSpeech(text: string, retries = 1): Promise<string> {
  const optimized = mathPhoneticizer(text).substring(0, 500);
  if (!optimized) return "";

  const key = await generateCacheKey(optimized);
  try {
    const cached = await getFromCache('audio', key);
    if (cached) return cached;
  } catch(e) {}

  let lastError: any = null;
  const ttsPrompt = `Speak as Professor Albert Einstein. Use a whimsical, heavy German accent with warmth and humor: ${optimized}`;

  for (let i = 0; i <= retries; i++) {
    try {
      const ai = getAI();
      // Fix: Using 'gemini-2.5-flash-preview-tts' and responseModalities: [Modality.AUDIO]
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
        },
      });
      const parts = response.candidates?.[0]?.content?.parts;
      const audioPart = parts?.find(p => p.inlineData);
      const base64 = audioPart?.inlineData?.data;
      
      if (base64) {
        await saveToCache('audio', key, base64);
        return base64;
      }
      throw new Error("Empty TTS data");
    } catch (e: any) {
      lastError = e;
      if (i < retries) {
        const delay = 2000 * (i + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  addLog({ 
    type: 'ERROR', 
    label: 'VOCAL FAULT', 
    duration: 0, 
    status: 'ERROR', 
    message: `${lastError?.message || "Quota or service error"}` 
  });
  throw lastError;
}

export const decode = (base64: string) => {
  try {
    const b = atob(base64);
    const bytes = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
    return bytes;
  } catch(e) {
    return new Uint8Array(0);
  }
};

export const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number) => {
  if (data.length === 0) throw new Error("No audio data to decode");
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const chData = buffer.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) chData[i] = dataInt16[i * numChannels + ch] / 32768.0;
  }
  return buffer;
};
