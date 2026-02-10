import { db, auth } from '../firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

$(document).ready(function() {

    const updateSummaryKPIs = async (user) => {
        if (!user) return;
        console.log("Dashboard: Iniciando carga de KPIs para usuario", user.uid);

        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);

        try {
            const q = query(
                collection(db, "loans_installments"),
                where("dueDate", ">=", startOfYear),
                where("dueDate", "<=", endOfYear)
            );

            const snap = await getDocs(q);
            console.log(`Dashboard: ${snap.size} cuotas encontradas.`);
            
            let totalCapital = 0;
            let totalExpected = 0;
            let totalPaid = 0;
            let itemsCount = 0;

            snap.forEach(doc => {
                const d = doc.data();
                totalCapital += Number(d.expectedAmount) || 0;
                totalExpected += Number(d.expectedAmount) || 0;
                totalPaid += Number(d.paidAmount) || 0;
                itemsCount++;
            });

            const effectiveness = totalExpected > 0 ? (totalPaid / totalExpected * 100) : 0;
            const arrearsIndex = totalExpected > 0 ? ((totalExpected - totalPaid) / totalExpected * 100) : 0;

            // Actualizar UI
            $('#summary-capital').text(`$${totalCapital.toLocaleString('es-AR')}`);
            $('#summary-effectiveness').text(`${effectiveness.toFixed(1)}%`);
            $('#summary-arrears').text(`${arrearsIndex.toFixed(1)}%`);
            $('#summary-total-credits').text(itemsCount);

            console.log("Dashboard: KPIs actualizados exitosamente.");

        } catch (error) {
            console.error("Error cargando resumen index:", error);
        }
    };

    // Esperar a que el estado de autenticación esté listo
    onAuthStateChanged(auth, (user) => {
        if (user) {
            updateSummaryKPIs(user);
        } else {
            console.warn("Dashboard: No hay usuario autenticado.");
        }
    });
});