import { initializeApp, getApp, getApps, FirebaseApp } from "firebase/app";
import { getDatabase, ref, get, set, Database } from "firebase/database";

const getFirebaseConfig = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || "einstein-math-history"; 
  const dbUrl = process.env.FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com/`;
  
  return {
    apiKey: process.env.FIREBASE_API_KEY || process.env.API_KEY, 
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    databaseURL: dbUrl,
    projectId: projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
  };
};

let dbInstance: Database | null = null;

const getDB = (): Database | null => {
  if (dbInstance) return dbInstance;
  
  const config = getFirebaseConfig();
  
  // Guard: Only initialize if we have at least an API Key and a likely project ID
  if (!config.apiKey || !config.projectId || config.projectId === "einstein-math-history") {
    // If using the default placeholder and no explicit key, we skip to avoid console noise
    if (!process.env.FIREBASE_API_KEY) return null;
  }

  try {
    let app: FirebaseApp;
    if (getApps().length === 0) {
      app = initializeApp(config);
    } else {
      app = getApp();
    }
    dbInstance = getDatabase(app);
    return dbInstance;
  } catch (error) {
    console.debug("Firebase initialization skipped for local dev.");
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
  } catch (error) {}
};

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
  } catch (error) {}
};