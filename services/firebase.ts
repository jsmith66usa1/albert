import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getDatabase, Database } from "firebase/database";
import { getAnalytics, Analytics } from "firebase/analytics";

// Verified configuration from Firebase Console
export const firebaseConfig = {
  apiKey: "AIzaSyATY0par56GqdPFSkN7aplC9GEcSwftwD0",
  authDomain: "gen-lang-client-0708024447.firebaseapp.com",
  projectId: "gen-lang-client-0708024447",
  databaseURL: "https://gen-lang-client-0708024447.firebaseio.com",
  storageBucket: "gen-lang-client-0708024447.firebasestorage.app",
  messagingSenderId: "372856387530",
  appId: "1:372856387530:web:57c09241b68cfd1da24133",
  measurementId: "G-6PF7DJXBYR"
};

let appInstance: FirebaseApp;
let dbInstance: Database | null = null;
let pingHasRun = false;

/**
 * Initializes the Firebase connection without performing an immediate ping.
 * Diagnostics are deferred until a real operation fails.
 */
export const initWorldBrain = async (addLog: (entry: any) => void): Promise<Database | null> => {
  try {
    if (getApps().length === 0) {
      appInstance = initializeApp(firebaseConfig);
      try {
        getAnalytics(appInstance);
      } catch (e) {}
    } else {
      appInstance = getApp();
    }

    // Using the databaseURL from the config for consistency
    dbInstance = getDatabase(appInstance, firebaseConfig.databaseURL);
    return dbInstance;
  } catch (err: any) {
    addLog({
      type: 'ERROR',
      label: 'INIT FAIL',
      duration: 0,
      status: 'ERROR',
      message: `Database initialization failed: ${err.message}`,
      source: 'firebase.ts:38'
    });
    return null;
  }
};

/**
 * Performs a diagnostic ping to the specific .json endpoint to log failure details.
 * This runs exactly once per session if a database operation fails.
 */
export const runDiagnosticPing = async (addLog: (entry: any) => void): Promise<void> => {
  if (pingHasRun) return;
  pingHasRun = true;

  const start = performance.now();
  const pingUrl = `${firebaseConfig.databaseURL}/.json`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(pingUrl, { 
      method: 'GET', 
      mode: 'cors',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.ok) {
      addLog({ 
        type: 'SYSTEM', 
        label: 'ETHERIC PING', 
        duration: performance.now() - start, 
        status: 'SUCCESS', 
        message: `Manual ping successful (Status: ${response.status}). Connectivity is established.`,
        source: 'firebase.ts:77'
      });
    } else {
      addLog({ 
        type: 'ERROR', 
        label: 'ETHERIC PING', 
        duration: performance.now() - start, 
        status: 'ERROR', 
        message: `Manual ping rejected (Status: ${response.status}). Check security rules.`,
        source: 'firebase.ts:85'
      });
    }
  } catch (e: any) {
    const isTimeout = e.name === 'AbortError';
    addLog({ 
      type: 'ERROR', 
      label: 'ETHERIC PING', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: `Diagnostic failed: ${isTimeout ? 'Request timed out' : e.message}. Check network connection.`,
      source: 'firebase.ts:95'
    });
  }
};

export const getDb = () => dbInstance;
