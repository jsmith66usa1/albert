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
      const dbRef = ref(db, `world_brain_v11/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        addLog({ 
          type: 'CACHE_DB', 
          label: `GLOBAL REGISTRY HIT: ${category}`, 
          duration: performance.now() - start, 
          status: 'CACHE_HIT', 
          message: `Shared knowledge retrieved from global brain.` 
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
        message: `Local asset found.` 
      });
      return local;
    }
  } catch (e) {}
  return null;
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  const start = performance.now();
  try {
    localStorage.setItem(`discovery_v11_${category}_${key}`, data);
  } catch (e) {}
  if (db) {
    try {
      const dbRef = ref(db, `world_brain_v11/${category}/${key}`);
      await set(dbRef, data);
      addLog({ 
        type: 'CACHE_DB', 
        label: `GLOBAL SYNC: ${category}`, 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: `Knowledge synchronized to global brain.` 
      });
    } catch (e) {}
  }
}

function mathPhoneticizer(text: string): string {
  return text
    .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '$1 divided by $2')
    .replace(/\\Delta/g, 'delta')
    .replace(/\\hbar/g, 'h-bar')
    .replace(/\\geq/g, 'is greater than or equal to')
    .replace(/\\pi/g, 'pi')
    .replace(/\\int/g, 'the integral of')
    .replace(/\^2/g, ' squared')
    .replace(/\[IMAGE:.*?\]/g, '')
    .replace(/\$/g, '')
    .trim();
}

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[], retryCount = 0): Promise<string> {
  // Switched to Flash for better reliability with high-persona prompts
  const model = 'gemini-3-flash-preview';
  const systemInstruction = "You are Professor Albert Einstein. Whimsical German accent. Use LaTeX. Always include one [IMAGE: description] in your reply.";
  const config = { systemInstruction, temperature: 0.8 };
  
  const cacheInput = JSON.stringify({ history, prompt, systemInstruction });
  const key = await generateCacheKey(cacheInput);
  
  const cached = await getFromCache('responses', key);
  if (cached) return cached;

  const start = performance.now();
  try {
    const ai = getAI();
    const contents = history.concat([{ role: 'user', parts: [{ text: prompt }] }]);
    const result = await ai.models.generateContent({
      model: model,
      contents: contents,
      config: config,
    });
    
    const textResult = result.text;
    if (textResult && textResult.trim().length > 0) {
      await saveToCache('responses', key, textResult);
      addLog({ type: 'AI_TEXT', label: 'SYNTHESIS SUCCESS', duration: performance.now() - start, status: 'SUCCESS', message: 'New response synthesized.' });
      return textResult;
    }
    
    // Retry logic for empty responses
    if (retryCount < 1) {
      addLog({ type: 'SYSTEM', label: 'RECALIBRATING', duration: 0, status: 'SUCCESS', message: 'Empty response detected. Re-attempting with simpler prompt.' });
      return generateEinsteinResponse(prompt + " (Please respond directly as Einstein)", history, retryCount + 1);
    }
    
    throw new Error("Gemini returned empty text after retry.");
  } catch (e: any) {
    const duration = performance.now() - start;
    addLog({ 
      type: 'ERROR', 
      label: 'DEBUG_AI_STUDIO_TEXT', 
      duration, 
      status: 'ERROR', 
      message: `Dialogue failed: ${e.message}`,
      metadata: { 
        model, 
        prompt, 
        history_length: history.length, 
        config, 
        error: e.toString(),
        retry_attempt: retryCount
      }
    });
    return "Ach, my dear friend. Ze field equations are becoming quite stubborn. It seems my thoughts are wandering into ze void! Let us try to observe another angle of zis problem.";
  }
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  const cached = await getFromCache('images', key);
  if (cached) return cached;

  const start = performance.now();
  const model = 'gemini-2.5-flash-image';
  const config = { imageConfig: { aspectRatio: "1:1" } };
  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: model,
      contents: [{ text: `Minimalist chalkboard diagram: ${prompt}. White chalk on black background. Scientific accuracy is key.` }],
      config: config
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
      addLog({ type: 'AI_IMAGE', label: 'IMAGE SUCCESS', duration: performance.now() - start, status: 'SUCCESS', message: 'Image manifested.' });
      return imageData;
    }
    throw new Error("No inlineData found in response parts.");
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'DEBUG_AI_STUDIO_IMAGE', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: `Manifestation failed: ${e.message}`,
      metadata: { model, prompt, config, error: e.toString() }
    });
    throw e;
  }
}

export async function generateEinsteinSpeech(text: string): Promise<string> {
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
      contents: [{ parts: [{ text: `Read with accent: ${optimizedSpeechText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      },
    });
    const base64 = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64) {
      await saveToCache('audio', key, base64);
      addLog({ type: 'AI_AUDIO', label: 'VOCAL SUCCESS', duration: performance.now() - start, status: 'SUCCESS', message: 'Vocal generated.' });
      return base64;
    }
    throw new Error("TTS candidate had no audio data.");
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'DEBUG_AI_STUDIO_AUDIO', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: `Vocal failed: ${e.message}`,
      metadata: { model, text_sample: optimizedSpeechText.substring(0, 40), error: e.toString() }
    });
    throw e;
  }
}

export const decode = (base64: string) => {
  const b = atob(base64);
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return bytes;
};

export const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number) => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const chData = buffer.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) chData[i] = dataInt16[i * numChannels + ch] / 32768.0;
  }
  return buffer;
};
