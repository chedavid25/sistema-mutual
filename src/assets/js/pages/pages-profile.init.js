import { auth, storage } from '../firebase-config.js';
import { updateProfile, updateEmail, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const profileForm = document.getElementById('profile-form');
const nameInput = document.getElementById('form-name');
const emailInput = document.getElementById('form-email');
// const photoInput = document.getElementById('form-photo-url'); // Removed
const passInput = document.getElementById('form-password');
const passConfirmInput = document.getElementById('form-password-confirm');
const btnSave = document.getElementById('btn-save-profile');

const nameCard = document.getElementById('profile-name-card');
const roleCard = document.getElementById('profile-role-card');
const imgPreview = document.getElementById('profile-img-preview');
const btnUpload = document.getElementById('btn-upload-photo');
const fileInput = document.getElementById('profile-image-input');

// Cargar datos actuales
auth.onAuthStateChanged(user => {
    if (user) {
        nameInput.value = user.displayName || '';
        emailInput.value = user.email || '';
        // photoInput.value = user.photoURL || ''; // Removed
        
        nameCard.textContent = user.displayName || 'Usuario';
        
        if (user.photoURL) {
            imgPreview.src = user.photoURL;
        }
    } else {
        window.location.href = 'auth-login.html';
    }
});

// Trigger file input
if(btnUpload) {
    btnUpload.addEventListener('click', () => fileInput.click());
}

// Handle File Change
if(fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validar tipo y tamaño (opcional, max 2MB por ejemplo)
        if (file.size > 2 * 1024 * 1024) {
            window.Swal.fire('Error', 'La imagen es muy pesada (Máx 2MB)', 'error');
            return;
        }

        try {
            window.Swal.fire({
                title: 'Subiendo imagen...',
                text: 'Por favor espere',
                allowOutsideClick: false,
                didOpen: () => window.Swal.showLoading()
            });

            const user = auth.currentUser;
            const storageRef = ref(storage, `users/${user.uid}/profile_${Date.now()}.jpg`);
            
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            // Actualizar vista previa (NO actualizamos input porque ya no existe)
            imgPreview.src = downloadURL;

            window.Swal.close();
            const toast = window.Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
            toast.fire({ icon: 'success', title: 'Imagen cargada. Recuerda guardar los cambios.' });

        } catch (error) {
            console.error("Error upload:", error);
            window.Swal.fire('Error', 'No se pudo subir la imagen.', 'error');
        }
    });
}

// Manejar guardado
profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="bx bx-loader bx-spin"></i> Guardando...';

    const newName = nameInput.value;
    const newPhoto = imgPreview.src; // Usamos la imagen actual previsualizada como source of truth
    const newPass = passInput.value;
    const confirmPass = passConfirmInput.value;

    try {
        const updates = [];

        // 1. Perfil (Nombre y Foto)
        // Comprobamos contra los datos actuales de Firebase
        if (newName !== user.displayName || newPhoto !== user.photoURL) {
            updates.push(updateProfile(user, {
                displayName: newName,
                photoURL: newPhoto
            }));
        }

        // 2. Contraseña
        if (newPass) {
            if (newPass !== confirmPass) {
                throw new Error("Las contraseñas no coinciden.");
            }
            updates.push(updatePassword(user, newPass));
        }

        await Promise.all(updates);

        if (updates.length > 0) {
            window.Swal.fire({
                icon: 'success',
                title: 'Perfil Actualizado',
                text: 'Los cambios se han guardado correctamente.',
                confirmButtonColor: '#5156be'
            });
            // Actualizar vista previa localmente
            nameCard.textContent = newName;
            // La foto ya está actualizada en imgPreview por el upload o carga inicial
        } else {
            window.Swal.fire({
                icon: 'info',
                title: 'Sin Cambios',
                text: 'No se detectaron cambios para guardar.',
                confirmButtonColor: '#5156be'
            });
        }

    } catch (error) {
        console.error("Error al actualizar perfil:", error);
        let msg = "No se pudo actualizar el perfil.";
        if (error.code === 'auth/requires-recent-login') {
            msg = "Esta operación requiere que inicies sesión nuevamente por seguridad.";
        } else if (error.message) {
            msg = error.message;
        }
        
        window.Swal.fire({
            icon: 'error',
            title: 'Error',
            text: msg,
            confirmButtonColor: '#fd625e'
        });
    } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = '<i class="bx bx-save me-1"></i> Guardar Cambios';
    }
});
