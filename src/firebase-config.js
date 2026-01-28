// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
    hd: 'bluurock.com' // Replace with your domain
  });