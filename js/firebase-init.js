// Firebase initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// 環境判定: hostname に -dev が含まれる、または localhost なら dev 扱い
const isDevEnvironment =
  location.hostname.includes('-dev') ||
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1';

// 本番環境 (hidenaka.github.io/taxi-daily-report/)
const PROD_CONFIG = {
  apiKey: "AIzaSyDwy688S23-aw9IoIe82FnHly8GZZJEaXw",
  authDomain: "taxi-dailydata.firebaseapp.com",
  projectId: "taxi-dailydata",
  storageBucket: "taxi-dailydata.firebasestorage.app",
  messagingSenderId: "797799790485",
  appId: "1:797799790485:web:6fb185c0ad7049feeae89c",
  measurementId: "G-83C6HHWD1L"
};

// dev環境 (hidenaka.github.io/-taxi-daily-report-dev/)
const DEV_CONFIG = {
  apiKey: "AIzaSyDj9DDoHUmNOUmXhvFTRr3OTfpBbZ8iJAY",
  authDomain: "taxi-dailydata-dev.firebaseapp.com",
  projectId: "taxi-dailydata-dev",
  storageBucket: "taxi-dailydata-dev.firebasestorage.app",
  messagingSenderId: "1049412243690",
  appId: "1:1049412243690:web:e478db447d48454e0dc793",
  measurementId: "G-ELKKS8QJ4B"
};

const firebaseConfig = isDevEnvironment ? DEV_CONFIG : PROD_CONFIG;

if (isDevEnvironment) {
  console.log('🚧 Firebase: DEV environment (taxi-dailydata-dev)');
} else {
  console.log('🔥 Firebase: PROD environment (taxi-dailydata)');
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
