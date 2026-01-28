import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getDatabase, Database } from "firebase/database";
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
let dbInstance: Database | null = null;
let analyticsInstance: Analytics | null = null;
let initializationPromise: Promise<Database | null> | null = null;

/**
 * Pings the database to verify availability ONCE per session.
 * If successful, subsequent calls return the established instance.
 * If failed, it will not attempt to ping or connect again for the session duration.
 */
export const initWorldBrain = async (addLog: (entry: any) => void): Promise<Database | null> => {
  // Return the existing promise if we've already started or finished initialization
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const start = performance.now();
    
    // 1. Initialize Firebase App (only once)
    if (getApps().length === 0) {
      appInstance = initializeApp(firebaseConfig);
      try {
        analyticsInstance = getAnalytics(appInstance);
      } catch (e) {}
    } else {
      appInstance = getApp();
    }

    // 2. Identify and Probe Database Endpoints
    const urlsToProbe = [
      `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`,
      `https://${firebaseConfig.projectId}.firebaseio.com`
    ];

    for (const baseUrl of urlsToProbe) {
      const pingUrl = `${baseUrl}/.json?shallow=true`;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
        
        const response = await fetch(pingUrl, { 
          method: 'GET', 
          mode: 'cors',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        const statusMsg = `URL: ${baseUrl} | Status: ${response.status}`;
        
        if (response.ok) {
          dbInstance = getDatabase(appInstance, baseUrl);
          
          addLog({ 
            type: 'SYSTEM', 
            label: 'ETHERIC PING', 
            duration: performance.now() - start, 
            status: 'SUCCESS', 
            message: `Shared Brain Linked. ${statusMsg}` 
          });
          
          return dbInstance;
        } else {
          addLog({ 
            type: 'ERROR', 
            label: 'ETHERIC PING', 
            duration: performance.now() - start, 
            status: 'ERROR', 
            message: `Ping failed. ${statusMsg}.` 
          });
        }
      } catch (e: any) {
        // Log individual probe failure but continue loop to check other possible URLs
        console.debug(`Probe to ${baseUrl} failed or timed out.`);
      }
    }

    // 3. Final Fallback: If no probe succeeds, ensure the database is NOT used.
    dbInstance = null;
    addLog({ 
      type: 'ERROR', 
      label: 'SYNC DISABLED', 
      duration: 0, 
      status: 'ERROR', 
      message: "One-time ping failed. Shared World Brain disabled for this session." 
    });
    
    return null;
  })();

  return initializationPromise;
};

export const getDb = () => dbInstance;
export const getAppInstance = () => appInstance;
export const getAnalyticsInstance = () => analyticsInstance;
