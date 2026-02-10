/*
* Sistema Mutual - Configuración de Firebase
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_idnsBECbcWIutDph-RGfwfdOCjikY5U",
  authDomain: "sistema-mutual-dffb9.firebaseapp.com",
  projectId: "sistema-mutual-dffb9",
  storageBucket: "sistema-mutual-dffb9.firebasestorage.app",
  messagingSenderId: "881852889887",
  appId: "1:881852889887:web:61f0e68c813e93601bce2a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Habilitar persistencia offline
enableIndexedDbPersistence(db)
  .catch((err) => {
      if (err.code == 'failed-precondition') {
          console.warn('Persistencia falló: Múltiples pestañas abiertas.');
      } else if (err.code == 'unimplemented') {
          console.warn('Persistencia no soportada por el navegador.');
      }
  });

// Export instances
export const auth = getAuth(app);
export { db };
export const functions = getFunctions(app);
export const storage = getStorage(app);

export default app;
