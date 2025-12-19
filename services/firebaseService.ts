
import { initializeApp, getApp, getApps, FirebaseApp } from "firebase/app";
import { getDatabase, ref, get, set, Database } from "firebase/database";

const getFirebaseConfig = () => {
  return {
    apiKey: process.env.FIREBASE_API_KEY || process.env.API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  };
};

let dbInstance: Database | null = null;

const getDB = (): Database | null => {
  if (dbInstance) return dbInstance;
  const config = getFirebaseConfig();
  if (!config.projectId) return null;

  try {
    let app: FirebaseApp;
    if (getApps().length === 0) {
      app = initializeApp(config);
    } else {
      app = getApp();
    }
    dbInstance = getDatabase(app, config.databaseURL || undefined);
    return dbInstance;
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    return null;
  }
};

export interface CachedChapter {
  text: string;
  image: string;
  label: string;
}

const sanitizeKey = (key: string): string => {
  // Firebase keys cannot contain certain characters like '.', '#', '$', '[', or ']'
  return key.replace(/[.$#[\]/]/g, "_").substring(0, 120).trim();
};

/**
 * Chapters Cache (Shared session-like states)
 */
export const getCachedChapter = async (label: string): Promise<CachedChapter | null> => {
  const db = getDB();
  if (!db) return null;
  try {
    const key = sanitizeKey(label);
    const chapterRef = ref(db, `math_chapters/${key}`);
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
    const chapterRef = ref(db, `math_chapters/${key}`);
    await set(chapterRef, { text, image, label, timestamp: Date.now() });
  } catch (error) {
    console.error("Firebase chapter save error:", error);
  }
};

/**
 * Global Image Prompt Vault
 * This is where images are permanently stored for all users.
 */
export const getCachedImage = async (prompt: string): Promise<string | null> => {
  const db = getDB();
  if (!db) return null;
  try {
    const key = sanitizeKey(prompt);
    const imageRef = ref(db, `math_image_vault/${key}`);
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
    const imageRef = ref(db, `math_image_vault/${key}`);
    // Check if it already exists to avoid redundant writes
    const snapshot = await get(imageRef);
    if (!snapshot.exists()) {
      await set(imageRef, { data: base64, timestamp: Date.now() });
    }
  } catch (error) {
    console.error("Firebase image vault save error:", error);
  }
};
