import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

/**
 * Header User Handler
 * Se encarga de mostrar la foto y el nombre del usuario logueado en el Topbar.
 */

const headerImg = document.getElementById('header-user-image');
const headerName = document.getElementById('header-user-name');

onAuthStateChanged(auth, (user) => {
    if (user) {
        if (headerName) headerName.textContent = user.displayName || user.email.split('@')[0];
        if (headerImg && user.photoURL) headerImg.src = user.photoURL;
    } else {
       // No hacer nada o redirigir (la redirección ya la manejan las páginas protegidas)
    }
});
