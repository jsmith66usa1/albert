import { initializeApp, getApp, getApps, FirebaseApp } from "firebase/app";
import { getDatabase, ref, get, set, Database } from "firebase/database";

const getFirebaseConfig = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || "einstein-math-history"; 
  // We strictly require FIREBASE_API_KEY to attempt a real connection to avoid warnings with the Gemini key
  return {
    apiKey: process.env.FIREBASE_API_KEY, 
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${projectId}.firebaseio.com/`,
    projectId: projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
  };
};

let dbInstance: Database | null = null;

const getDB = (): Database | null => {
  if (dbInstance) return dbInstance;
  
  const config = getFirebaseConfig();
  
  // If the user hasn't provided a Firebase API key, we skip Firebase entirely 
  // to prevent the "Firebase error. Please ensure... configured correctly" warnings.
  if (!config.apiKey && !process.env.FIREBASE_DATABASE_URL) {
    return null;
  }

  try {
    let app: FirebaseApp;
    if (getApps().length === 0) {
      // Use the Gemini key as a last resort fallback only if specifically requested via config
      const finalConfig = {
        ...config,
        apiKey: config.apiKey || process.env.API_KEY
      };
      app = initializeApp(finalConfig);
    } else {
      app = getApp();
    }
    dbInstance = getDatabase(app);
    return dbInstance;
  } catch (error) {
    console.warn("Firebase initialization skipped or failed. Using local state.");
    return null;
  }
};

export interface CachedChapter {
  text: string;
  image: string;
  label: string;
  timestamp: number;
}

const sanitizeKey = (key: string): string => {
  return key.replace(/[.$#[\]/]/g, "_").substring(0, 120).trim();
};

/**
 * Shared Chapter Vault
 */
export const getCachedChapter = async (label: string): Promise<CachedChapter | null> => {
  const db = getDB();
  if (!db) return null;
  try {
    const key = sanitizeKey(label);
    const chapterRef = ref(db, `shared_vault/chapters/${key}`);
    const snapshot = await get(chapterRef);
    return snapshot.exists() ? snapshot.val() as CachedChapter : null;
  } catch (error) {
    return null;
  }
};

export const saveChapterToCache = async (label: string, text: string, image: string): Promise<void> => {
  const db = getDB();
  if (!db) return;
  try {
    const key = sanitizeKey(label);
    const chapterRef = ref(db, `shared_vault/chapters/${key}`);
    await set(chapterRef, { text, image, label, timestamp: Date.now() });
  } catch (error) {
    // Silent fail on save - doesn't interrupt user flow
  }
};

/**
 * Global Image Prompt Vault
 */
export const getCachedImage = async (prompt: string): Promise<string | null> => {
  const db = getDB();
  if (!db) return null;
  try {
    const key = sanitizeKey(prompt);
    const imageRef = ref(db, `shared_vault/images/${key}`);
    const snapshot = await get(imageRef);
    return snapshot.exists() ? snapshot.val().data : null;
  } catch (error) {
    return null;
  }
};

export const saveCachedImage = async (prompt: string, base64: string): Promise<void> => {
  const db = getDB();
  if (!db) return;
  try {
    const key = sanitizeKey(prompt);
    const imageRef = ref(db, `shared_vault/images/${key}`);
    const snapshot = await get(imageRef);
    if (!snapshot.exists()) {
      await set(imageRef, { data: base64, timestamp: Date.now() });
    }
  } catch (error) {
    // Silent fail
  }
};
