import { GoogleGenAI, Modality } from "@google/genai";
import { LogEntry } from "../types";

let performanceLogs: LogEntry[] = [];
const DB_NAME = 'EinsteinLaboratoryDB';
const STORE_NAME = 'CosmicCache';
const DB_VERSION = 1;

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

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getAI = () => {
  if (!process.env.API_KEY) throw new Error("Missing Laboratory Key (Gemini API Key).");
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

async function generateCacheKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/**
 * Validates if the fetched blob is a valid image via magic numbers.
 */
async function isValidImage(blob: Blob): Promise<boolean> {
  if (blob.size < 10) return false;
  const buffer = await blob.slice(0, 4).arrayBuffer();
  const header = new Uint8Array(buffer);
  
  // JPEG: FF D8 FF
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return true;
  
  return false;
}

/**
 * Static Server Cache Helpers
 */
async function getFromStaticServer(type: 'text' | 'images', eraKey: string): Promise<string | null> {
  const start = performance.now();
  
  const directory = type === 'text' ? 'text' : 'images';
  const prefix = type === 'text' ? 'einstein-discussion-' : 'einstein-diagram-';
  const extension = type === 'text' ? 'txt' : 'jpg';
  
  // Remove all spaces for the filename
  const noSpaceKey = eraKey.replace(/\s+/g, '');
  const fileName = `${prefix}${noSpaceKey}.${extension}`;
  
  // Exhaustive path list to handle root vs subdirectory deployments
  const pathsToTry = [
    `${directory}/${fileName}`,      // Relative to app root
    `./${directory}/${fileName}`,    // Relative with dot
    `/${directory}/${fileName}`,     // Absolute from domain root
    fileName,                        // Flat relative
    `./${fileName}`,                 // Flat relative dot
    `/${fileName}`                   // Flat absolute
  ];

  for (const urlToFetch of pathsToTry) {
    try {
      addLog({ 
        type: 'CACHE_DB', 
        label: 'STATIC PROBE', 
        duration: 0, 
        status: 'SUCCESS', 
        message: `Probing static library: ${urlToFetch}`, 
        source: 'geminiService.ts' 
      });

      const response = await fetch(urlToFetch, { cache: 'no-cache' });
      
      if (!response.ok) {
        addLog({ 
          type: 'CACHE_DB', 
          label: 'STATIC MISS', 
          duration: 0, 
          status: 'ERROR', 
          message: `404: Not found at ${urlToFetch}`, 
          source: 'geminiService.ts' 
        });
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        addLog({ 
          type: 'CACHE_DB', 
          label: 'STATIC FAIL', 
          duration: 0, 
          status: 'ERROR', 
          message: `REJECTED: ${urlToFetch} returned HTML.`, 
          source: 'geminiService.ts' 
        });
        continue;
      }

      if (type === 'text') {
        const text = await response.text();
        addLog({ 
          type: 'CACHE_DB', 
          label: 'SERVER HIT', 
          duration: performance.now() - start, 
          status: 'CACHE_HIT', 
          message: `SUCCESS: Static archive loaded from ${urlToFetch}`, 
          source: 'geminiService.ts' 
        });
        return text;
      } else {
        const blob = await response.blob();
        if (await isValidImage(blob)) {
          addLog({ 
            type: 'CACHE_DB', 
            label: 'SERVER HIT', 
            duration: performance.now() - start, 
            status: 'CACHE_HIT', 
            message: `SUCCESS: Static diagram loaded from ${urlToFetch}`, 
            source: 'geminiService.ts' 
          });
          return URL.createObjectURL(blob);
        }
      }
    } catch (e: any) {
      addLog({ 
        type: 'ERROR', 
        label: 'FETCH ERR', 
        duration: 0, 
        status: 'ERROR', 
        message: `Network failure fetching ${urlToFetch}: ${e.message}`, 
        source: 'geminiService.ts' 
      });
    }
  }
  
  return null;
}

async function getFromCache(category: string, key: string, dataType: string): Promise<any> {
  const start = performance.now();
  const storageKey = `discovery_v12_${category}_${key}`;
  
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(storageKey);

    return new Promise((resolve) => {
      request.onsuccess = () => {
        if (request.result) {
          addLog({ 
            type: 'CACHE_DB', 
            label: `IDB HIT`, 
            duration: performance.now() - start, 
            status: 'CACHE_HIT', 
            message: `Retrieved ${dataType} from local storage.`, 
            source: 'geminiService.ts' 
          });
          resolve(request.result);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function saveToCache(category: string, key: string, data: string): Promise<void> {
  if (!data || data.length < 5) return;
  const start = performance.now();
  const storageKey = `discovery_v12_${category}_${key}`;
  
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(data, storageKey);

    addLog({ 
      type: 'CACHE_DB', 
      label: 'IDB SAVE', 
      duration: performance.now() - start, 
      status: 'SUCCESS', 
      message: `Content archived in local database.`, 
      source: 'geminiService.ts' 
    });
  } catch (e: any) {
    addLog({ 
      type: 'SYSTEM', 
      label: 'IDB ERR', 
      duration: 0, 
      status: 'ERROR', 
      message: `Database archival error.`,
      source: 'geminiService.ts'
    });
  }
}

export async function generateEinsteinResponse(prompt: string, history: any[], eraKey?: string): Promise<string> {
  const start = performance.now();
  
  if (eraKey) {
    const staticResult = await getFromStaticServer('text', eraKey);
    if (staticResult) return staticResult;
  }

  const cacheKey = await generateCacheKey(prompt + JSON.stringify(history));
  const cached = await getFromCache('text', cacheKey, 'text');
  if (cached) return cached;

  try {
    const ai = getAI();
    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: "You are Professor Albert Einstein. Address the user as 'My dear friend'. Introduce the experience if it is the start. Explain pivotal eras of math. Keep it whimsical, humble, and academic. Use metaphors. Always use LaTeX for mathematical equations. IMPORTANT: You speak with a distinct German accent, using 'ze' for 'the', 'zat' for 'that', 'vis' for 'this', and occasionally words like 'Ach', 'Ja', and 'und' to emphasize your heritage.",
      },
      history: history
    });

    const response = await chat.sendMessage({ message: prompt });
    const text = response.text || "Ach, ze universe remains silent.";
    
    await saveToCache('text', cacheKey, text);
    
    addLog({
      type: 'AI_TEXT',
      label: 'GEMINI TEXT',
      duration: performance.now() - start,
      status: 'SUCCESS',
      message: 'Consulted ze relative wisdom of ze stars.',
      source: 'geminiService.ts'
    });
    
    return text;
  } catch (error: any) {
    addLog({
      type: 'ERROR',
      label: 'AI FAIL',
      duration: performance.now() - start,
      status: 'ERROR',
      message: error.message,
      source: 'geminiService.ts'
    });
    return "My dear friend, ze cosmic connection is slightly warped. Let us try again in a moment.";
  }
}

export async function generateChalkboardImage(description: string, eraKey?: string): Promise<string | null> {
  const start = performance.now();

  if (eraKey) {
    const staticImg = await getFromStaticServer('images', eraKey);
    if (staticImg) return staticImg;
  }

  const cacheKey = await generateCacheKey(description);
  const cached = await getFromCache('image', cacheKey, 'image');
  if (cached) return cached;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `A chalkboard sketch: ${description}. White chalk on a dark dusty blackboard. Highly detailed mathematical and scientific diagram style.` }]
      },
      config: {
        imageConfig: { aspectRatio: "1:1" }
      }
    });

    let imageUrl = null;
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (imageUrl) {
      await saveToCache('image', cacheKey, imageUrl);
      addLog({
        type: 'AI_IMAGE',
        label: 'GEMINI IMAGE',
        duration: performance.now() - start,
        status: 'SUCCESS',
        message: 'Successfully sketched on ze chalkboard.',
        source: 'geminiService.ts'
      });
      return imageUrl;
    }
    return null;
  } catch (error: any) {
    addLog({
      type: 'ERROR',
      label: 'IMAGE FAIL',
      duration: performance.now() - start,
      status: 'ERROR',
      message: error.message,
      source: 'geminiService.ts'
    });
    return null;
  }
}

/**
 * Enhanced TTS with exponential backoff and retry logic
 */
export async function generateEinsteinSpeech(text: string): Promise<string | null> {
  const maxRetries = 3;
  let retryCount = 0;
  
  const attemptSpeech = async (isSimplified: boolean): Promise<string | null> => {
    const start = performance.now();
    try {
      const ai = getAI();
      const instruction = isSimplified 
        ? "Say this in the voice of Albert Einstein" 
        : "Say this with a warm, inquisitive, wise, and distinctly German-accented tone, phonetically pronouncing 'the' as 'ze' and 'that' as 'zat'";
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `${instruction}: ${text}` }] }],
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
      if (base64Audio) {
        addLog({
          type: 'AI_AUDIO',
          label: 'GEMINI TTS',
          duration: performance.now() - start,
          status: 'SUCCESS',
          message: 'Synthesized ze professor\'s voice.',
          source: 'geminiService.ts'
        });
        return base64Audio;
      }
      return null;
    } catch (error: any) {
      addLog({
        type: 'ERROR',
        label: `TTS FAIL ${retryCount + 1}`,
        duration: performance.now() - start,
        status: 'ERROR',
        message: error.message,
        source: 'geminiService.ts'
      });
      throw error;
    }
  };

  while (retryCount < maxRetries) {
    try {
      // Third attempt uses a simplified prompt to bypass potential synthesis complexity issues
      return await attemptSpeech(retryCount === maxRetries - 1);
    } catch (e: any) {
      retryCount++;
      if (retryCount >= maxRetries) return null;
      
      const delay = Math.pow(2, retryCount - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
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
