/**
 * apps-prestamos-importar.init.js
 * Lógica para la importación masiva de créditos y clientes desde Excel.
 */

import { db } from '../firebase-config.js';
import { 
    collection, 
    doc, 
    setDoc, 
    getDoc, 
    writeBatch,
    addDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth } from '../firebase-config.js';

$(document).ready(function() {

    const dropzone = $('#import-dropzone');
    const fileInput = $('#import-file-input');
    const progressContainer = $('#import-progress-container');
    const progressBar = $('#import-progress-bar');
    const percentageText = $('#import-percentage');
    const countText = $('#import-count');
    const statusText = $('#import-status-text');
    const resultsContainer = $('#import-results');
    const summaryText = $('#import-summary-text');

    // Manejo de clic y drag & drop
    dropzone.on('click', (e) => {
        if (e.target !== fileInput[0]) {
            fileInput.click();
        }
    });

    fileInput.on('click', (e) => {
        e.stopPropagation();
    });
    
    dropzone.on('dragover', (e) => {
        e.preventDefault();
        dropzone.addClass('bg-primary bg-opacity-25');
    });

    dropzone.on('dragleave', () => {
        dropzone.removeClass('bg-opacity-25');
    });

    dropzone.on('drop', (e) => {
        e.preventDefault();
        dropzone.removeClass('bg-opacity-25');
        const file = e.originalEvent.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.on('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    const handleFile = (file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (jsonData.length === 0) {
                    throw new Error("El archivo Excel está vacío.");
                }

                await processImport(jsonData);

            } catch (error) {
                console.error("Error al leer Excel:", error);
                Swal.fire('Error', error.message || "No se pudo leer el archivo Excel.", 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    };

    /**
     * Convierte fechas de Excel (número serial) a Objeto Date de JS
     */
    const excelDateToJS = (serial) => {
        if (!serial) return null;
        if (typeof serial === 'string') return new Date(serial);
        const utc_days  = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        
        const fractional_day = serial - Math.floor(serial) + 0.0000001;
        let total_seconds = Math.floor(86400 * fractional_day);
        const seconds = total_seconds % 60;
        total_seconds -= seconds;
        const hours = Math.floor(total_seconds / (60 * 60));
        const minutes = Math.floor(total_seconds / 60) % 60;

        return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
    };

    /**
     * Calcula la edad basada en la fecha de nacimiento
     */
    const calculateAge = (birthDate) => {
        if (!birthDate) return null;
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    };

    /**
     * Normaliza los nombres de proveedores para evitar duplicados sucios.
     */
    const normalizeProvider = (rawName) => {
       if (!rawName) return 'Desconocido';
       const upper = String(rawName).toUpperCase().trim();
       
       // Reglas específicas para SANCOR
       if (upper.includes('SANCOR')) {
           if (upper.includes('UNO') || upper.includes('1')) return 'Sancor 1';
           if (upper.includes('DOS') || upper.includes('2')) return 'Sancor 2';
           if (upper.includes('TRES') || upper.includes('3')) return 'Sancor 3';
           if (upper.includes('CUATRO') || upper.includes('4')) return 'Sancor 4';
           if (upper.includes('CINCO') || upper.includes('5')) return 'Sancor 5';
           if (upper.includes('SEIS') || upper.includes('6')) return 'Sancor 6';
           if (upper.includes('SIETE') || upper.includes('7')) return 'Sancor 7';
           if (upper.includes('OCHO') || upper.includes('8')) return 'Sancor 8';
       }
       return upper; // Devolver original si no coincide
    };

    const processImport = async (data) => {
        dropzone.addClass('d-none');
        progressContainer.removeClass('d-none');
        
        const totalRows = data.length;
        let processedCount = 0;
        let loanCount = 0;
        let clientCount = 0;

        // Map en memoria para evitar redundancia de clientes en la misma carga
        const uniqueClients = new Map();

        // Array para almacenar las promesas de los batches
        const batchPromises = [];
        
        // Batch actual
        let batch = writeBatch(db);
        let operationCounter = 0;
        const BATCH_LIMIT = 499; // Límite de seguridad de Firestore

        for (const row of data) {
            try {
                // 1. Validar campos mínimos
                const loanId = row.Numero || row.numero || row.LoanId;
                const installmentNo = row["Nro Cuota"] || row.nro_cuota || row.installmentNumber;
                const cuit = row.CUIT || row.cuit;

                if (!loanId || !installmentNo || !cuit) {
                    processedCount++;
                    continue;
                }

                // 2. Preparar datos de Préstamo/Cuota
                const docId = `${loanId}_${installmentNo}`;
                const expectedAmount = parseFloat(row["Monto Total"] || 0);
                const paidAmount = Math.abs(parseFloat(row["Total Pago"] || 0));
                const remainingBalance = parseFloat(row["Saldo Cuota"] || 0);

                // Cálculo de Status & Dates
                const dueDate = excelDateToJS(row.Fecha || row.dueDate);
                const paymentDate = excelDateToJS(row["Fecha Cobro"]);
                
                let status = 'IMPAGO';
                if (remainingBalance === 0) status = 'PAGADO';
                else if (paidAmount > 0) status = 'PARCIAL';
                
                // Cálculo de Días de Atraso
                let daysDelayed = 0;
                if (status === 'PAGADO' && paymentDate && dueDate) {
                    const diffTime = paymentDate.getTime() - dueDate.getTime();
                    daysDelayed = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                } else if (status !== 'PAGADO' && dueDate < new Date()) {
                    const diffTime = new Date().getTime() - dueDate.getTime();
                    daysDelayed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                // Normalización de Proveedor
                const rawProvider = row.Proveedor || row.provider || "Mutual";
                const normalizedProvider = normalizeProvider(rawProvider);

                const loanData = {
                    loanId: String(loanId),
                    installmentNumber: Number(installmentNo),
                    productLine: row["Linea Prestamo"] || row.productLine || "General",
                    provider: normalizedProvider,
                    issueDate: excelDateToJS(row["Fecha Emision"]),
                    dueDate: dueDate,
                    paymentDate: paymentDate,
                    refinancedAmount: parseFloat(row["Monto Refinanciado"] || row.refinancedAmount || 0),
                    expectedAmount,
                    paidAmount,
                    remainingBalance,
                    status,
                    daysDelayed: daysDelayed,
                    clientCuit: String(cuit),
                    updatedAt: serverTimestamp()
                };

                const loanRef = doc(db, "loans_installments", docId);
                batch.set(loanRef, loanData, { merge: true });
                operationCounter++;
                loanCount++;

                // 3. Preparar datos de Cliente (Únicos por carga)
                if (!uniqueClients.has(cuit)) {
                    const bDateValue = row["Fecha De Nacimiento"] || row["Fecha Nacimiento"] || row["FECHA NACIMIENTO"] || row.birthDate;
                    const birthDate = excelDateToJS(bDateValue);
                    const clientData = {
                        fullName: row["Nombre Completo"] || row["Nombre y Apellido"] || row.FullName || row.fullName || row.nombre || row.CLIENTE || "Sin Nombre",
                        email: String(row.Email || row.email || "").toLowerCase(),
                        phone: row.Celular || row.phone || "",
                        address: row.Direccion || row.address || "",
                        birthDate: birthDate,
                        age: calculateAge(birthDate),
                        gender: row.Sexo || row.gender || "",
                        lastUpdate: serverTimestamp()
                    };
                    uniqueClients.set(cuit, clientData);

                    const clientRef = doc(db, "clients", String(cuit));
                    batch.set(clientRef, clientData, { merge: true });
                    operationCounter++;
                    clientCount++;
                }

                // Ejecutar push del batch si llegamos al límite
                if (operationCounter >= BATCH_LIMIT) {
                    batchPromises.push(batch.commit()); // Guardar la promesa
                    batch = writeBatch(db); // Reiniciar batch
                    operationCounter = 0;
                }

                processedCount++;
                
                // Actualizar progreso UI (Visualmente, aunque la carga real es al final en Promise.all, da feedback de "Procesando")
                if (processedCount % 50 === 0) { // Actualizar cada 50 filas para no bloquear UI
                        const percent = Math.round((processedCount / totalRows) * 100);
                        progressBar.css('width', percent + '%');
                        percentageText.text(percent + '%');
                        countText.text(`${processedCount} / ${totalRows} filas preparadas`);
                        statusText.text(`Preparando lotes...`);
                }

            } catch (err) {
                console.error("Error en fila:", row, err);
            }
        }

        // Push final si quedaron operaciones pendientes
        if (operationCounter > 0) {
            batchPromises.push(batch.commit());
        }

        // Ejecutar todas las escrituras en paralelo
        statusText.text(`Escribiendo en base de datos (${batchPromises.length} lotes)...`);
        await Promise.all(batchPromises);

        // Feedback visual de finalización
        progressBar.css('width', '100%');
        percentageText.text('100%');
        statusText.text('¡Importación Finalizada! Generando resumen...');
        
        // Pequeña pausa para que el usuario vea el 100%
        await new Promise(resolve => setTimeout(resolve, 800));

        // Finalizar UI
        progressContainer.addClass('d-none');
        resultsContainer.removeClass('d-none');
        summaryText.text(`Se han procesado ${loanCount} cuotas de préstamos y se han actualizado ${uniqueClients.size} perfiles de clientes.`);

        // Crear Notificación de Sistema
        try {
            await addDoc(collection(db, "notifications"), {
                title: "Importación Completada",
                message: `Archivo procesado: ${loanCount} cuotas y ${uniqueClients.size} clientes actualizados.`,
                date: serverTimestamp(),
                type: "success",
                read: false,
                user: auth.currentUser ? auth.currentUser.email : "Sistema"
            });
        } catch (noteErr) {
            console.error("Error creando notificación:", noteErr);
        }

        Swal.fire({
            title: '¡Éxito!',
            text: 'Importación completada correctamente.',
            icon: 'success',
            confirmButtonText: 'Ver Dashboard'
        }).then(() => {
            window.location.href = 'apps-prestamos-dashboard.html';
        });
    };
});
