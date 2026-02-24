// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDa6fezdvhViWBSoh5LQuwzYwyDh1lY314",
  authDomain: "bluu-backend.firebaseapp.com",
  projectId: "bluu-backend",
  storageBucket: "bluu-backend.firebasestorage.app",
  messagingSenderId: "211818603920",
  appId: "1:211818603920:web:531afeb508d1debcb3ff15"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Persistent IndexedDB cache — serves cached docs on re-load without a network read.
// Single-device assumption: persistentMultipleTabManager avoids tab conflicts while
// still sharing the cache. Re-navigation to the same page hits the cache first
// (0 billable reads) and only bills when the server sends a real update.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
    hd: 'bluurock.com' // Replace with your domain
  });