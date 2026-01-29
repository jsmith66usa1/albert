import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore, collection, getDocs, limit, query } from "firebase/firestore";
import { getAnalytics, Analytics } from "firebase/analytics";

// Verified configuration from Firebase Console
export const firebaseConfig = {
  apiKey: "AIzaSyATY0par56GqdPFSkN7aplC9GEcSwftwD0",
  authDomain: "gen-lang-client-0708024447.firebaseapp.com",
  projectId: "gen-lang-client-0708024447",
  storageBucket: "gen-lang-client-0708024447.firebasestorage.app",
  messagingSenderId: "372856387530",
  appId: "1:372856387530:web:57c09241b68cfd1da24133",
  measurementId: "G-6PF7DJXBYR"
};

let appInstance: FirebaseApp;
let firestoreInstance: Firestore | null = null;
let diagnosticHasRun = false;

/**
 * Initializes the Firebase Firestore connection.
 */
export const initWorldBrain = async (addLog: (entry: any) => void): Promise<Firestore | null> => {
  try {
    if (getApps().length === 0) {
      appInstance = initializeApp(firebaseConfig);
      try {
        getAnalytics(appInstance);
      } catch (e) {}
    } else {
      appInstance = getApp();
    }

    firestoreInstance = getFirestore(appInstance);
    return firestoreInstance;
  } catch (err: any) {
    addLog({
      type: 'ERROR',
      label: 'INIT FAIL',
      duration: 0,
      status: 'ERROR',
      message: `Firestore initialization failed: ${err.message}`,
      source: 'firebase.ts:32'
    });
    return null;
  }
};

/**
 * Performs a diagnostic check against a test collection to verify Firestore connectivity.
 */
export const runDiagnosticPing = async (addLog: (entry: any) => void): Promise<void> => {
  if (diagnosticHasRun || !firestoreInstance) return;
  diagnosticHasRun = true;

  const start = performance.now();
  try {
    const testQuery = query(collection(firestoreInstance, 'world_brain_v12'), limit(1));
    await getDocs(testQuery);
    
    addLog({ 
      type: 'SYSTEM', 
      label: 'ETHERIC PING', 
      duration: performance.now() - start, 
      status: 'SUCCESS', 
      message: `Firestore link verified. Cloud brain is active.`,
      source: 'firebase.ts:56'
    });
  } catch (e: any) {
    addLog({ 
      type: 'ERROR', 
      label: 'ETHERIC PING', 
      duration: performance.now() - start, 
      status: 'ERROR', 
      message: `Cloud connection failed: ${e.message}. Check Firestore security rules.`,
      source: 'firebase.ts:64'
    });
  }
};

export const getDb = () => firestoreInstance;
