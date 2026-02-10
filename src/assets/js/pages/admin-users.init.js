/**
 * admin-users.init.js
 * Lógica para la gestión de usuarios e invitaciones (Super Admin)
 */

import { db, functions } from '../firebase-config.js';
import { collection, query, onSnapshot, doc, setDoc, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

$(document).ready(function() {
    
    // --- Referencias a Tablas ---
    const languageConfig = {
        "processing": "Procesando...",
        "lengthMenu": "Mostrar _MENU_ registros",
        "zeroRecords": "No se encontraron resultados",
        "emptyTable": "Ningún dato disponible en esta tabla",
        "info": "Mostrando registros del _START_ al _END_ de un total de _TOTAL_ registros",
        "infoEmpty": "Mostrando registros del 0 al 0 de un total de 0 registros",
        "infoFiltered": "(filtrado de un total de _MAX_ registros)",
        "search": "Buscar:",
        "loadingRecords": "Cargando...",
        "paginate": {
            "first": "Primero",
            "last": "Último",
            "next": "Siguiente",
            "previous": "Anterior"
        },
        "aria": {
            "sortAscending": ": Activar para ordenar la columna de manera ascendente",
            "sortDescending": ": Activar para ordenar la columna de manera descendente"
        }
    };

    const tableUsers = $('#datatable-usuarios').DataTable({
        language: languageConfig
    });
    const tableInvs = $('#datatable-invitaciones').DataTable({
        order: [[3, 'desc']],
        language: languageConfig
    });

    // --- 1. Escuchar Usuarios en Tiempo Real ---
    onSnapshot(collection(db, "usuarios"), (snapshot) => {
        tableUsers.clear();
        snapshot.forEach((doc) => {
            const user = doc.data();
            const uid = doc.id;
            
            const btnStatus = user.status === 'active' ? 'danger' : 'success';
            const btnStatusText = user.status === 'active' ? 'Desactivar' : 'Activar';

            tableUsers.row.add([
                user.nombre,
                user.email,
                `<span class="badge bg-info-subtle text-info font-size-12">${user.role}</span>`,
                `<span class="badge bg-${user.status === 'active' ? 'success' : 'danger'}-subtle text-${user.status === 'active' ? 'success' : 'danger'} font-size-12">${user.status}</span>`,
                `<div class="dropdown">
                    <button class="btn btn-light btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown">Acción</button>
                    <div class="dropdown-menu">
                        <a class="dropdown-item btn-change-role" href="#" data-uid="${uid}">Cambiar Rol</a>
                        <a class="dropdown-item text-${btnStatus} btn-toggle-status" href="#" data-uid="${uid}" data-disabled="${user.status === 'active'}">${btnStatusText}</a>
                        <div class="dropdown-divider"></div>
                        <a class="dropdown-item text-danger btn-delete-user" href="#" data-uid="${uid}">Eliminar</a>
                    </div>
                </div>`
            ]);
        });
        tableUsers.draw();
    });

    // --- 2. Escuchar Invitaciones en Tiempo Real ---
    onSnapshot(collection(db, "invitaciones"), (snapshot) => {
        tableInvs.clear();
        snapshot.forEach((docSnap) => {
            const inv = docSnap.data();
            const code = docSnap.id;
            
            const statusLabel = inv.used 
                ? `<span class="badge bg-danger">Usado</span>` 
                : `<span class="badge bg-success">Activo</span>`;

            tableInvs.row.add([
                `<code>${code}</code>`,
                inv.role,
                statusLabel,
                inv.createdAt?.toDate().toLocaleString() || '---',
                inv.used ? '' : `<button class="btn btn-outline-danger btn-sm btn-del-inv" data-id="${code}"><i class="bx bx-trash"></i></button>`
            ]);
        });
        tableInvs.draw();
    });

    // --- 3. Generar Código de Invitación ---
    $('#form-generar-invitacion').on('submit', async function(e) {
        e.preventDefault();
        const role = $('#inv-role').val();
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();

        try {
            await setDoc(doc(db, "invitaciones", code), {
                role: role,
                used: false,
                createdAt: serverTimestamp()
            });
            $('#modalInvitacion').modal('hide');
            Swal.fire('¡Éxito!', `Código ${code} generado para ${role}`, 'success');
        } catch (error) {
            Swal.fire('Error', error.message, 'error');
        }
    });

    // --- 4. Acciones de Usuario (Cloud Functions) ---
    $(document).on('click', '.btn-toggle-status', async function(e) {
        e.preventDefault();
        const uid = $(this).data('uid');
        const disabled = $(this).data('disabled');
        
        const result = await Swal.fire({
            title: '¿Estás seguro?',
            text: `Vas a ${disabled ? 'desactivar' : 'activar'} a este usuario.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, continuar'
        });

        if (result.isConfirmed) {
            try {
                const toggleFn = httpsCallable(functions, 'toggleUserStatus');
                await toggleFn({ uid, disabled });
                Swal.fire('¡Actualizado!', '', 'success');
            } catch (error) {
                Swal.fire('Error', error.message, 'error');
            }
        }
    });

    $(document).on('click', '.btn-delete-user', async function(e) {
        e.preventDefault();
        const uid = $(this).data('uid');
        
        const result = await Swal.fire({
            title: '¿ELIMINAR USUARIO?',
            text: "Esta acción no se puede deshacer y borrará al usuario de Auth y Firestore.",
            icon: 'error',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'SÍ, ELIMINAR'
        });

        if (result.isConfirmed) {
            try {
                const deleteFn = httpsCallable(functions, 'deleteUser');
                await deleteFn({ uid });
                Swal.fire('Eliminado', 'El usuario ha sido borrado.', 'success');
            } catch (error) {
                Swal.fire('Error', error.message, 'error');
            }
        }
    });

    $(document).on('click', '.btn-change-role', async function(e) {
        e.preventDefault();
        const uid = $(this).data('uid');
        
        const { value: newRole } = await Swal.fire({
            title: 'Cambiar Rol de Usuario',
            input: 'select',
            inputOptions: {
                'super_admin': 'Super Admin',
                'admin': 'Admin',
                'administrativo': 'Administrativo',
                'asistente': 'Asistente'
            },
            inputPlaceholder: 'Seleccione un rol',
            showCancelButton: true
        });

        if (newRole) {
            try {
                const roleFn = httpsCallable(functions, 'setUserRole');
                await roleFn({ uid, newRole });
                Swal.fire('¡Cambiado!', `Nuevo rol: ${newRole}`, 'success');
            } catch (error) {
                Swal.fire('Error', error.message, 'error');
            }
        }
    });

    // Eliminar Invitación
    $(document).on('click', '.btn-del-inv', async function() {
        const id = $(this).data('id');
        try {
            await deleteDoc(doc(db, "invitaciones", id));
            Swal.fire('Eliminado', '', 'success');
        } catch (error) {
            Swal.fire('Error', error.message, 'error');
        }
    });

});
