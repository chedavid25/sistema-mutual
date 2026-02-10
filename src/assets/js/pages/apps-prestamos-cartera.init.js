/**
 * apps-prestamos-cartera.init.js
 * Visualización y gestión de la base de clientes.
 */

import { db } from '../firebase-config.js';
import { 
    collection, 
    onSnapshot, 
    query, 
    orderBy 
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

    /**
     * Listener en tiempo real para la colección de clientes
     */
    const loadClients = () => {
        const q = query(collection(db, "clients"), orderBy("fullName", "asc"));
        
        onSnapshot(q, (snapshot) => {
            const clients = [];
            snapshot.forEach((doc) => {
                clients.push({
                    cuit: doc.id,
                    ...doc.data()
                });
            });

            $('#client-total-count').text(clients.length);
            initDataTable(clients);
        }, (error) => {
            console.error("Error cargando clientes:", error);
        });
    };

    loadClients();
});
