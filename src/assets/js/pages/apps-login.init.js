import { auth } from '../firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

$(document).ready(function() {
    const form = $('#form-login');
    const btnSubmit = $('#btn-submit-login');

    form.on('submit', async function(e) {
        e.preventDefault();
        
        const email = $('#useremail').val();
        const password = $('#userpassword').val();

        btnSubmit.prop('disabled', true).html('<i class="bx bx-loader bx-spin font-size-16 align-middle me-2"></i> Entrando...');

        try {
            await signInWithEmailAndPassword(auth, email, password);
            window.location.href = 'index.html';
        } catch (error) {
            console.error("Error en login:", error);
            let message = "Credenciales incorrectas o problema de conexión.";
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                message = "Usuario o contraseña inválidos.";
            }
            Swal.fire('Error de Acceso', message, 'error');
            btnSubmit.prop('disabled', false).text('Iniciar Sesión');
        }
    });
});
