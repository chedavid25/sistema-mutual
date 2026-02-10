/**
 * auth-register.init.js
 * Lógica para el registro blindado con código de invitación.
 */

import { functions } from '../firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

$(document).ready(function() {
    
    const form = $('#form-register');
    const btnSubmit = $('#btn-submit-register');

    form.on('submit', async function(e) {
        e.preventDefault();
        
        if (!form[0].checkValidity()) {
            form.addClass('was-validated');
            return;
        }

        const email = $('#useremail').val();
        const password = $('#userpassword').val();
        const nombre = $('#username').val();
        const invitationCode = $('#invitationcode').val();

        btnSubmit.prop('disabled', true).html('<i class="bx bx-loader bx-spin font-size-16 align-middle me-2"></i> Registrando...');

        try {
            const registerFn = httpsCallable(functions, 'registerUserWithCode');
            const result = await registerFn({ email, password, nombre, invitationCode });

            if (result.data.success) {
                await Swal.fire({
                    title: '¡Registro Exitoso!',
                    text: 'Tu cuenta ha sido creada. Ahora puedes iniciar sesión.',
                    icon: 'success'
                });
                window.location.href = 'apps-login.html';
            } else {
                Swal.fire('Error', result.data.message || "Error desconocido", 'error');
                btnSubmit.prop('disabled', false).text('Registrarse');
            }
        } catch (error) {
            console.error("Error en registro:", error);
            Swal.fire('Error de Registro', error.message || "No se pudo completar el registro.", 'error');
            btnSubmit.prop('disabled', false).text('Registrarse');
        }
    });
});
