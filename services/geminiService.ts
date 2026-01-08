import { GoogleGenAI, Modality } from "@google/genai";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

// Firebase configuration using environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase only if we have sufficient configuration to avoid fatal errors
let db: any = null;
try {
  // We check for databaseURL or projectId to construct a working instance.
  // Realtime Database requires the URL; if missing but projectId exists, we can infer the default URL.
  if (firebaseConfig.databaseURL || firebaseConfig.projectId) {
    const app = initializeApp(firebaseConfig);
    const dbUrl = firebaseConfig.databaseURL || (firebaseConfig.projectId ? `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com/` : undefined);
    
    if (dbUrl) {
      db = getDatabase(app, dbUrl);
    }
  }
} catch (e) {
  // Catch silently to avoid stopping the app, will fallback to LocalStorage
  console.debug("Firebase shared cache initialization deferred (missing or invalid config).");
}

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

/**
 * Generates a simple hash string for caching keys
 */
async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/**
 * Robust cache getter that checks Firebase first, then LocalStorage
 */
async function getFromCache(category: string, key: string): Promise<any> {
  // 1. Try Firebase (Shared Cache)
  if (db) {
    try {
      const snapshot = await get(ref(db, `cache/${category}/${key}`));
      if (snapshot.exists()) {
        console.log(`Cache [Firebase]: Hit for ${category}/${key}`);
        return snapshot.val();
      }
    } catch (e) {
      console.warn(`Firebase cache lookup failed for ${category}/${key}`, e);
    }
  }

  // 2. Try LocalStorage (Local Persistent Fallback)
  try {
    const localVal = localStorage.getItem(`einstein_cache_${category}_${key}`);
    if (localVal) {
      console.log(`Cache [Local]: Hit for ${category}/${key}`);
      return localVal;
    }
  } catch (e) {
    // LocalStorage might be blocked or full
  }

  return null;
}

/**
 * Robust cache setter that saves to both Firebase and LocalStorage
 */
async function saveToCache(category: string, key: string, data: string): Promise<void> {
  // Save to LocalStorage
  try {
    localStorage.setItem(`einstein_cache_${category}_${key}`, data);
  } catch (e) {
    // Ignore errors for local storage being full
  }

  // Save to Firebase
  if (db) {
    try {
      await set(ref(db, `cache/${category}/${key}`), data);
    } catch (e) {
      console.warn(`Failed to save to Firebase cache for ${category}/${key}`, e);
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
      systemInstruction: "You are Professor Albert Einstein. Speak with a warm, humble, whimsical, and academic tone. Address the user as 'My dear friend'. Use metaphors to explain complex concepts. Use LaTeX for equations wrapped in $ or $$. If you introduce a new visual topic, generate a tag exactly like [IMAGE: prompt] describing a chalkboard-style scientific illustration.",
      temperature: 0.8,
    },
  });
  
  const textResult = response.text;
  if (textResult) {
    await saveToCache('responses', key, textResult);
  }
  
  return textResult;
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const key = await generateCacheKey(prompt);

  const cached = await getFromCache('images', key);
  if (cached) return cached;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ text: `A professional chalkboard scientific drawing of: ${prompt}. High-contrast white chalk strokes on a dusty black chalkboard background. Include scientific diagrams, handwritten formulas, and elegant minimalist line art. Moody atmosphere, academic look.` }],
    config: {
      imageConfig: { aspectRatio: "1:1" }
    }
  });

  let imageData = "";
  if (response.candidates && response.candidates[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        imageData = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }
  }
  
  if (!imageData) {
    throw new Error("The scientific manifestation failed to materialize (No image part found).");
  }

  await saveToCache('images', key, imageData);
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
    contents: [{ parts: [{ text: `Say with a mature, gentle, intellectual German-accented warmth: ${speechText}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio generated");

  await saveToCache('audio', key, base64Audio);
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
