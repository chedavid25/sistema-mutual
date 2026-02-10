/**
 * role-guard.js
 * Protección de rutas basada en roles y estado de autenticación.
 */

import { subscribeAuth } from './auth-context.js';

/**
 * Valida el acceso a la página actual.
 * @param {Array} allowedRoles - Lista de roles permitidos. Si es null, solo requiere estar autenticado.
 * @param {string} redirectPath - Ruta a la que redirigir si el acceso es denegado.
 */
export const guardPage = (allowedRoles = null, redirectPath = 'apps-login.html') => {
    // Escuchar el estado de autenticación
    subscribeAuth((state) => {
        if (state.loading) return;

        // Si no está autenticado, fuera
        if (!state.user) {
            window.location.href = redirectPath;
            return;
        }

        // Si se requieren roles específicos
        if (allowedRoles && !allowedRoles.includes(state.role)) {
            console.warn(`Acceso denegado para el rol: ${state.role}`);
            window.location.href = 'index.html'; // Redirigir al dashboard general
            return;
        }
        
        // Si llegamos aquí, el acceso está permitido.
        document.body.classList.remove('auth-loading');
    });
};

// Autoejecución según la URL si es necesario
// Ej: Si la URL contiene /admin/, validar super_admin
if (window.location.pathname.includes('/admin-')) {
    guardPage(['super_admin']);
}
