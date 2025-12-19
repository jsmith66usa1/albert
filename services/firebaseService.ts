
import { initializeApp, getApp, getApps, FirebaseApp } from "firebase/app";
import { getDatabase, ref, get, set, Database } from "firebase/database";

/**
 * Lazy-loaded Firebase configuration. 
 * We check process.env for the required keys.
 */
const getFirebaseConfig = () => {
  return {
    apiKey: process.env.FIREBASE_API_KEY || process.env.API_KEY, // Fallback to generic API_KEY if available
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  };
};

let dbInstance: Database | null = null;

/**
 * Initializes Firebase App and Database only if necessary and if config is valid.
 */
const getDB = (): Database | null => {
  if (dbInstance) return dbInstance;

  const config = getFirebaseConfig();

  // Project ID is strictly required by Firebase
  if (!config.projectId) {
    console.warn("Firebase Caching Disabled: FIREBASE_PROJECT_ID is missing from environment.");
    return null;
  }

  try {
    let app: FirebaseApp;
    if (getApps().length === 0) {
      app = initializeApp(config);
    } else {
      app = getApp();
    }

    // Realtime Database requires a URL if it's not the default us-central1 location,
    // or if it can't be inferred. We pass the config to getDatabase to be safe.
    dbInstance = getDatabase(app, config.databaseURL);
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

/**
 * Sanitizes a string to be used as a Firebase key (no ., $, #, [, ], or /)
 */
const sanitizeKey = (key: string): string => {
  return key.replace(/[.$#[\]/]/g, "_").trim();
};

export const getCachedChapter = async (label: string): Promise<CachedChapter | null> => {
  const db = getDB();
  if (!db) return null;

  try {
    const key = sanitizeKey(label);
    const chapterRef = ref(db, `chapters/${key}`);
    const snapshot = await get(chapterRef);
    if (snapshot.exists()) {
      return snapshot.val() as CachedChapter;
    }
    return null;
  } catch (error) {
    console.error("Firebase fetch error:", error);
    return null;
  }
};

export const saveChapterToCache = async (label: string, text: string, image: string): Promise<void> => {
  const db = getDB();
  if (!db) return;

  try {
    const key = sanitizeKey(label);
    const chapterRef = ref(db, `chapters/${key}`);
    await set(chapterRef, {
      text,
      image,
      label,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("Firebase save error:", error);
  }
};
