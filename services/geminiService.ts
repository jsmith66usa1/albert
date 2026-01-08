
import { GoogleGenAI, Modality } from "@google/genai";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

let db: any = null;
try {
  // Robust initialization: only init if no app exists
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  // Ensure we have a database URL. If missing, construct the standard one from projectId
  const dbUrl = firebaseConfig.databaseURL || (firebaseConfig.projectId ? `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com/` : undefined);
  if (dbUrl) {
    db = getDatabase(app, dbUrl);
  }
} catch (e) {
  console.error("Firebase initialization failed:", e);
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
  // 1. Try Global Firebase Cache (Shared across all users permanently)
  if (db) {
    try {
      const dbRef = ref(db, `einstein_global_v1/${category}/${key}`);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        // Local secondary cache for speed
        try { localStorage.setItem(`einstein_local_${category}_${key}`, val); } catch(e){}
        return val;
      }
    } catch (e) {
      console.warn("Global cache retrieval error", e);
    }
  }

  // 2. Fallback to LocalStorage
  try {
    return localStorage.getItem(`einstein_local_${category}_${key}`);
  } catch (e) {
    return null;
  }
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data) return;

  // 1. Save to Local Storage
  try {
    localStorage.setItem(`einstein_local_${category}_${key}`, data);
  } catch (e) {}

  // 2. Save to Global Firebase Cache (Make available to all users globally)
  if (db) {
    try {
      const dbRef = ref(db, `einstein_global_v1/${category}/${key}`);
      await set(dbRef, data);
    } catch (e) {
      console.warn("Global cache save failed", e);
    }
  }
}

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]) {
  const cacheInput = JSON.stringify({ history, prompt });
  const key = await generateCacheKey(cacheInput);
  const cached = await getFromCache('responses', key);
  if (cached) return cached;

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
  if (textResult) await saveToCache('responses', key, textResult);
  return textResult;
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);
  const cached = await getFromCache('images', key);
  if (cached) return cached;

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
  if (imageData) await saveToCache('images', key, imageData);
  return imageData;
}

export async function generateEinsteinSpeech(text: string): Promise<string> {
  const speechText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  const key = await generateCacheKey(speechText);
  const cached = await getFromCache('audio', key);
  if (cached) return cached;

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
  if (base64Audio) await saveToCache('audio', key, base64Audio);
  return base64Audio;
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
