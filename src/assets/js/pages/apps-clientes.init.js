/**
 * apps-clientes.init.js
 * Gestión integral de cartera de clientes (CRM básico).
 */

import { db } from '../firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    limit,
    addDoc,
    orderBy,
    serverTimestamp,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

$(document).ready(function() {
    
    let clientsTable;
    let selectedClientCuit = null;

    /**
     * Cargar Listado y Métricas
     */
    const loadClients = async () => {
        try {
            // Spinner
            $('#datatable-clients tbody').html(`
                <tr>
                    <td colspan="6" class="text-center p-4">
                        <div class="spinner-border text-primary m-2" role="status">
                            <span class="visually-hidden">Cargando...</span>
                        </div>
                        <p class="mb-0">Cargando cartera de clientes...</p>
                    </td>
                </tr>
            `);

            // Nota: En producción, esto debería usar paginación o server-side rendering
            // para evitar cargar miles de docs de golpe. Aquí limitamos a 2000 para demo.
            const clientsRef = collection(db, "clients");
            const q = query(clientsRef, limit(2000));
            const snap = await getDocs(q);

            const clients = [];
            let total = 0;
            let withPhone = 0;
            let totalAge = 0;
            let countAge = 0;

            snap.forEach(doc => {
                const data = doc.data();
                clients.push({
                    cuit: doc.id,
                    ...data
                });
                total++;
                if (data.phone) withPhone++;
                if (data.age > 0) {
                    totalAge += data.age;
                    countAge++;
                }
            });

            // Actualizar KPIs básicos
            $('#kpi-total-clients').text(total);
            $('#kpi-avg-age').text(countAge > 0 ? (totalAge / countAge).toFixed(0) : 0);

            // Calcular Activos y Mora
            await calculateClientKPIs();
            
            // Render Tabla
            if ($.fn.DataTable.isDataTable('#datatable-clients')) {
                $('#datatable-clients').DataTable().destroy();
            }

            const tableBody = clients.map(client => {
                const phoneClean = client.phone ? client.phone.replace(/\D/g, '') : '';
                const whatsappLink = phoneClean ? `https://wa.me/549${phoneClean}` : '#';
                const mailLink = client.email ? `mailto:${client.email}` : '#';
                
                return `
                    <tr>
                        <td>
                            <h5 class="font-size-14 mb-1"><a href="javascript: void(0);" class="text-dark">${client.fullName || 'Sin Nombre'}</a></h5>
                            <p class="text-muted mb-0">${client.email || '-'}</p>
                        </td>
                        <td>${client.cuit}</td>
                        <td>${client.age || '-'}</td>
                        <td>
                            <div class="d-flex gap-2">
                                ${client.phone ? `
                                    <a href="${whatsappLink}" target="_blank" class="btn btn-sm btn-success" title="WhatsApp">
                                        <i class="bx bxl-whatsapp font-size-16"></i>
                                    </a>
                                    <a href="tel:${client.phone}" class="btn btn-sm btn-info" title="Llamar">
                                        <i class="bx bx-phone font-size-16"></i>
                                    </a>
                                ` : '<span class="badge bg-light text-muted">Sin Tel</span>'}
                                ${client.email ? `
                                    <a href="${mailLink}" class="btn btn-sm btn-secondary" title="Email">
                                        <i class="bx bx-envelope font-size-16"></i>
                                    </a>
                                ` : ''}
                            </div>
                        </td>
                        <td><span class="badge bg-soft-primary text-primary">Registrado</span></td>
                        <td>
                            <button class="btn btn-sm btn-light open-bitacora" data-cuit="${client.cuit}" data-name="${client.fullName}">
                                <i class="bx bx-note font-size-16 align-middle me-1"></i> Bitácora
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            $('#datatable-clients tbody').html(tableBody);
            
            clientsTable = $('#datatable-clients').DataTable({
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
                order: [[0, 'asc']]
            });

        } catch (error) {
            console.error("Error cargando clientes:", error);
        }
    };

    /**
     * Cálculo de KPIs Reales (Activos y Mora)
     */
    const calculateClientKPIs = async () => {
        try {
            // Buscamos todas las cuotas con saldo > 1 (Activas)
            const q = query(
                collection(db, "loans_installments"),
                where("remainingBalance", ">", 1)
            );
            
            const snap = await getDocs(q);
            const activeCuits = new Set();
            const moraCuits = new Set();
            const today = new Date();

            snap.forEach(doc => {
                const data = doc.data();
                if (data.clientCuit) {
                    activeCuits.add(data.clientCuit);
                    
                    if (data.dueDate && data.dueDate.toDate() < today) {
                        moraCuits.add(data.clientCuit);
                    }
                }
            });

            $('#kpi-active-clients').text(activeCuits.size);
            $('#kpi-mora-clients').text(moraCuits.size);
            
            // Sparklines
            if(window.ApexCharts) {
                const sparkOptions = {
                    chart: { type: 'line', height: 40, sparkline: { enabled: true } },
                    stroke: { curve: 'smooth', width: 2 },
                    tooltip: { fixed: { enabled: false }, x: { show: false }, y: { title: { formatter: () => '' } }, marker: { show: false } }
                };
                new ApexCharts(document.querySelector("#mini-chart2"), { ...sparkOptions, series: [{ data: [12, 14, 2, 47, 42, 15, 47, 75, 65, 19, 14] }], colors: ['#2ab57d'] }).render();
                new ApexCharts(document.querySelector("#mini-chart3"), { ...sparkOptions, series: [{ data: [25, 66, 41, 89, 63, 25, 44, 12, 36, 9, 54] }], colors: ['#fd625e'] }).render();
            }

        } catch (error) {
            console.error("Error calculando KPIs:", error);
        }
    };

    /**
     * Bitácora de Notas
     */
    const loadBitacora = async (cuit) => {
        const list = $('#bitacoraList');
        list.html('<div class="text-center"><i class="bx bx-loader bx-spin"></i> Cargando notas...</div>');
        
        try {
            const notesRef = collection(db, "clients", cuit, "notes");
            // Eliminamos orderBy para evitar errores de índice si no existe. Ordenamos en memoria.
            const q = query(notesRef);
            const snap = await getDocs(q);

            if (snap.empty) {
                list.html('<p class="text-muted text-center py-3">No hay notas registradas para este cliente.</p>');
                return;
            }

            const docs = [];
            snap.forEach(doc => docs.push(doc.data()));
            
            // Ordenar en memoria descendente
            docs.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

            const html = [];
            docs.forEach(note => {
                const date = note.createdAt ? note.createdAt.toDate().toLocaleString() : 'Reciente';
                html.push(`
                    <div class="card border shadow-none mb-2">
                        <div class="card-body p-2">
                            <p class="mb-1">${note.text}</p>
                            <small class="text-muted"><i class="bx bx-time-five"></i> ${date}</small>
                        </div>
                    </div>
                `);
            });
            list.html(html.join(''));

        } catch (error) {
            console.error("Error cargando bitácora:", error);
            list.html('<p class="text-danger">Error al cargar notas.</p>');
        }
    };

    const saveNote = async () => {
        const text = $('#newNote').val();
        if (!text.trim() || !selectedClientCuit) return;

        const btn = $('#btnSaveNote');
        btn.prop('disabled', true).text('Guardando...');

        try {
            const notesRef = collection(db, "clients", selectedClientCuit, "notes");
            await addDoc(notesRef, {
                text: text,
                createdAt: serverTimestamp(),
                createdBy: 'admin' // Idealmente obtener UID del usuario actual
            });
            
            $('#newNote').val('');
            loadBitacora(selectedClientCuit); // Recargar lista
            
        } catch (error) {
            console.error("Error guardando nota:", error);
            alert("No se pudo guardar la nota.");
        } finally {
            btn.prop('disabled', false).text('Guardar Nota');
        }
    };

    // Eventos UI
    $(document).on('click', '.open-bitacora', function() {
        // Aseguramos conversión a string para evitar errores númericos
        const cuit = String($(this).data('cuit'));
        const name = $(this).data('name');
        selectedClientCuit = cuit;
        
        $('#bitacoraClientName').text(name || 'Cliente');
        $('#newNote').val('');
        
        const modal = new bootstrap.Modal(document.getElementById('modalBitacora'));
        modal.show();
        
        loadBitacora(cuit);
    });

    $('#btnSaveNote').on('click', saveNote);

    // Init
    loadClients();
});
