/**
 * auth-context.js
 * Manejo del estado global de autenticación y Custom Claims.
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const AuthState = {
    user: null,
    role: null,
    loading: true,
    initialized: false
};

const listeners = [];

export const subscribeAuth = (callback) => {
    listeners.push(callback);
    if (AuthState.initialized) {
        callback(AuthState);
    }
    return () => {
        const index = listeners.indexOf(callback);
        if (index > -1) listeners.splice(index, 1);
    };
};

const notifyListeners = () => {
    listeners.forEach(callback => callback(AuthState));
};

// Inicializar observación de cambios de Auth
onAuthStateChanged(auth, async (user) => {
    AuthState.loading = true;
    AuthState.initialized = true;
    
    if (user) {
        AuthState.user = user;
        
        // Obtener Custom Claims (Rol del Token)
        const idTokenResult = await user.getIdTokenResult(true);
        AuthState.role = idTokenResult.claims.role || null;

        // Si no hay rol en el token, intentamos buscar en Firestore como fallback (opcional)
        if (!AuthState.role) {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                AuthState.role = userDoc.data().role;
            }
        }
    } else {
        AuthState.user = null;
        AuthState.role = null;
    }
    
    AuthState.loading = false;
    notifyListeners();
});

export const getAuthState = () => AuthState;

export const logout = () => auth.signOut();
