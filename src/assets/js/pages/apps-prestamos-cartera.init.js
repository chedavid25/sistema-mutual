/**
 * apps-prestamos-cartera.init.js
 * Visualización y gestión de la base de clientes.
 */

import { db } from '../firebase-config.js';
import { 
    collection, 
    query, 
    orderBy,
    getDocs,
    getDoc,
    doc,
    limit,
    where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

$(document).ready(function() {

    let table = null;

    const initDataTable = (data) => {
        if (table) {
            table.destroy();
        }

        table = $('#datatable-clientes').DataTable({
            data: data,
            columns: [
                { data: 'fullName' },
                { data: 'cuit' }, // El CUIT es el ID del doc
                { data: 'email' },
                { data: 'phone' },
                { data: 'age', render: (val) => val || '-' },
                { data: 'gender', render: (val) => val || '-' },
                { 
                    data: 'cuit',
                    render: (cuit) => {
                        return `<button class="btn btn-sm btn-soft-primary"><i class="bx bx-show-alt"></i></button>`;
                    }
                }
            ],
            language: {
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
            },
            responsive: true,
            order: [[0, 'asc']]
        });
    };

    let currentUnsubscribe = null;

    const loadClients = async (searchTerm = '') => {
        // 1. Limpiar listener anterior si existía (aunque ahora usaremos getDocs para búsqueda manual)
        if (currentUnsubscribe) {
            currentUnsubscribe();
            currentUnsubscribe = null;
        }

        const clientsRef = collection(db, "clients");
        let q;

        // Feedback de carga
        if (table) table.clear().draw();
        
        try {
            // A. Búsqueda por CUIT Exacto (Prioridad Máxima)
            if (searchTerm && /^\d+$/.test(searchTerm)) {
                 // Buscar documento directo por ID
                 const docRef = doc(db, "clients", searchTerm);
                 const docSnap = await getDoc(docRef);
                 
                 if (docSnap.exists()) {
                     const client = { cuit: docSnap.id, ...docSnap.data() };
                     initDataTable([client]);
                     $('#client-total-count').text("1 (Filtrado)");
                     return;
                 } else {
                     // Si no encuentra por ID, intentar buscar por campo 'cuit' (si acaso fuera diferente)
                     q = query(clientsRef, where("cuit", "==", searchTerm));
                 }

            } else if (searchTerm) {
                // B. Búsqueda por Texto (Nombre) - Case Sensitive
                // Firestore no tiene "contains". Usamos rango >= y <= para "empieza con".
                // IMPORTANTE: Esto distingue mayúsculas. "juan" no encontrará "Juan".
                
                // Normalización simple: Si el usuario escribe todo minúscula, intentamos Capitalizar la primera.
                // Pero lo dejaremos raw para que el usuario tenga control total.
                const term = searchTerm;
                const endTerm = searchTerm + '\uf8ff';
                
                q = query(
                    clientsRef, 
                    where("fullName", ">=", term),
                    where("fullName", "<=", endTerm),
                    limit(50) 
                );

            } else {
                // C. Carga Inicial (Sin búsqueda)
                // Solo traemos los primeros 50 para velocidad.
                q = query(clientsRef, orderBy("fullName", "asc"), limit(50));
            }

            // Ejecutar Query
            const querySnapshot = await getDocs(q);
            const clients = [];
            querySnapshot.forEach((doc) => {
                clients.push({
                    cuit: doc.id,
                    ...doc.data()
                });
            });

            const countLabel = searchTerm ? `${clients.length} (Resultados)` : `50 (Carga Inicial)`;
            $('#client-total-count').text(countLabel);
            initDataTable(clients);

            if (clients.length === 0 && searchTerm) {
               Swal.fire({
                   toast: true,
                   position: 'top-end',
                   icon: 'info',
                   title: 'No se encontraron resultados. Intenta respetar mayúsculas/acentos.',
                   showConfirmButton: false,
                   timer: 3000
               });
            }

        } catch (error) {
            console.error("Error cargando clientes:", error);
            Swal.fire('Error', 'Hubo un problema al buscar los clientes.', 'error');
        }
    };

    // Listeners
    $('#btn-server-search').on('click', () => {
        const val = $('#server-search-input').val().trim();
        loadClients(val);
    });

    $('#server-search-input').on('keypress', (e) => {
        if (e.which === 13) {
            const val = $('#server-search-input').val().trim();
            loadClients(val);
        }
    });

    // Carga inicial
    loadClients();
});
