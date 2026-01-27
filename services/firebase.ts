import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getDatabase, Database } from "firebase/database";
import { getAnalytics, Analytics } from "firebase/analytics";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

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

/**
 * Pings the database to verify availability.
 * Logs the URL and status code to the console and system logs.
 * Returns the database instance only if the connection is successful.
 */
export const initWorldBrain = async (addLog: (entry: any) => void): Promise<Database | null> => {
  const start = performance.now();
  
  // 1. Initialize Firebase App
  if (getApps().length === 0) {
    appInstance = initializeApp(firebaseConfig);
    
    // Optional: Initialize App Check if site key is provided
    // try {
    //   initializeAppCheck(appInstance, {
    //     provider: new ReCaptchaEnterpriseProvider('YOUR_SITE_KEY'), 
    //     isTokenAutoRefreshEnabled: true
    //   });
    // } catch (e) {}

    // Initialize Analytics
    try {
      analyticsInstance = getAnalytics(appInstance);
    } catch (e) {}
  } else {
    appInstance = getApp();
  }

  // 2. Identify and Probe Database Endpoints
  // We check both the modern 'default-rtdb' and the legacy naming conventions.
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

      // Log the specific URL and Status Code as requested
      const statusMsg = `URL: ${baseUrl} | Status: ${response.status} ${response.statusText}`;
      
      if (response.ok) {
        dbInstance = getDatabase(appInstance, baseUrl);
        
        addLog({ 
          type: 'SYSTEM', 
          label: 'ETHERIC PING', 
          duration: performance.now() - start, 
          status: 'SUCCESS', 
          message: `Database online. ${statusMsg}` 
        });
        
        return dbInstance;
      } else {
        addLog({ 
          type: 'ERROR', 
          label: 'ETHERIC PING', 
          duration: performance.now() - start, 
          status: 'ERROR', 
          message: `Ping failed. ${statusMsg}. Check security rules or project provisioning.` 
        });
      }
    } catch (e: any) {
      addLog({ 
        type: 'ERROR', 
        label: 'NETWORK ERR', 
        duration: performance.now() - start, 
        status: 'ERROR', 
        message: `Could not reach ${baseUrl}: ${e.name === 'AbortError' ? 'Timeout' : e.message}` 
      });
    }
  }

  // 3. Final Fallback: If no probe succeeds, ensure the database is NOT used.
  dbInstance = null;
  addLog({ 
    type: 'ERROR', 
    label: 'SYNC DISABLED', 
    duration: 0, 
    status: 'ERROR', 
    message: "Shared World Brain is unavailable. Local memory mode only." 
  });
  
  return null;
};

export const getDb = () => dbInstance;
export const getAppInstance = () => appInstance;
export const getAnalyticsInstance = () => analyticsInstance;
