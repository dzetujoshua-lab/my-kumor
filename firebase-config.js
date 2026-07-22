// ============================================================
// firebase-config.js — Kumora Campus Trace | Live Production Config
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyB6xOvULN2NfdQ0s76ElriPBe7QlPXucZw",
  authDomain: "kumora-data.firebaseapp.com",
  projectId: "kumora-data",
  storageBucket: "kumora-data.firebasestorage.app",
  messagingSenderId: "405150896558",
  appId: "1:405150896558:web:36edfa874933abdad5b83f",
  measurementId: "G-6EQBTQCHF3"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let messaging = null;
async function initMessaging() {
  try {
    const supported = await isSupported();
    if (supported) {
      messaging = getMessaging(app);
    }
  } catch (err) {
    console.warn("FCM messaging initialization notice:", err);
  }
  return messaging;
}

export { app, auth, db, messaging, initMessaging, getToken, onMessage, getMessaging };


