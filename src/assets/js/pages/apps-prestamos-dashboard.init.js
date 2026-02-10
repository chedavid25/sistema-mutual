/**
 * apps-prestamos-dashboard.init.js
 * Motor analítico y visualización de créditos.
 */

import { db } from '../firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    orderBy,
    limit,
    getDoc,
    doc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

$(document).ready(function() {

    // Inicializar Tooltips (para botones de ayuda)
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // Elementos UI
    const filterYear = $('#filter-year');
    const filterPeriod = $('#filter-period');
    const filterStart = $('#filter-start-date');
    const filterEnd = $('#filter-end-date');
    const btnApply = $('#btn-apply-filters');

    // Instancias de Gráficos (para actualizar)
    let charts = {
        evolucion: null,
        ranking: null,
        flujo: null,
        pago: null,
        demografico: null,
        bucket: null,
        topMorosos: null,
        topPagadores: null,
        proyeccion: null,
        dineroFresco: null,
        composicion: null,
        demoraProv: null,
        riesgoEdad: null
    };

    // Cache Global de Clientes (Optimización de Rendimiento)
    let clientCache = {}; 
    let isClientCacheLoaded = false;

    /**
     * Carga de Clientes en Memoria (Solo una vez)
     * Evita miles de lecturas redundantes al filtrar.
     */
    const preloadClientCache = async () => {
        if (isClientCacheLoaded) return;
        
        try {
            console.log("Iniciando precarga de clientes...");
            // Limitamos a 2000 para no explotar memoria, pero ordenamos por nombre
            const q = query(collection(db, "clients"), orderBy("fullName"), limit(2000));
            const snap = await getDocs(q);
            
            snap.forEach(doc => {
                const data = doc.data();
                clientCache[doc.id] = {
                    fullName: data.fullName || "Sin Nombre",
                    birthDate: data.birthDate ? data.birthDate.toDate() : null
                };
            });
            
            isClientCacheLoaded = true;
            console.log(`Clientes en caché: ${Object.keys(clientCache).length}`);
            
        } catch (error) {
            console.error("Error en precarga de caché:", error);
        }
    };

    /**
     * Inicialización de Filtros
     */
    const initFilters = () => {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear; i >= currentYear - 5; i--) {
            filterYear.append(`<option value="${i}">${i}</option>`);
        }
    };

    /**
     * Obtener fechas basadas en el periodo
     */
    const getRangeByPeriod = (year, period) => {
        let start, end;
        const now = new Date();
        const y = parseInt(year);

        if (!isNaN(parseInt(period))) {
            // Es un mes específico (1-12)
            start = new Date(y, parseInt(period) - 1, 1);
            end = new Date(y, parseInt(period), 0);
        } else {
            switch (period) {
                case 'current':
                    start = new Date(y, now.getMonth(), 1);
                    end = new Date(y, now.getMonth() + 1, 0);
                    break;
                case 'Q1': start = new Date(y, 0, 1); end = new Date(y, 3, 0); break;
                case 'Q2': start = new Date(y, 3, 1); end = new Date(y, 6, 0); break;
                case 'Q3': start = new Date(y, 6, 1); end = new Date(y, 9, 0); break;
                case 'Q4': start = new Date(y, 9, 1); end = new Date(y, 12, 0); break;
                case 'S1': start = new Date(y, 0, 1); end = new Date(y, 6, 0); break;
                case 'S2': start = new Date(y, 6, 1); end = new Date(y, 12, 0); break;
                case 'year':
                    start = new Date(y, 0, 1);
                    end = new Date(y, 11, 31);
                    break;
                default:
                    start = new Date(y, 0, 1);
                    end = new Date(y, 11, 31);
            }
        }
        return { start, end };
    };

    /**
     * Calcula la edad basada en la fecha de nacimiento
     */
    const calculateAge = (birthDate) => {
        if (!birthDate) return null;
        const today = new Date();
        const birth = birthDate.toDate ? birthDate.toDate() : new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    };

    /**
     * Consulta principal a Firestore
     */
    const fetchData = async (startDate, endDate) => {
        const loansRef = collection(db, "loans_installments");
        
        // Asegurarnos de usar Timestamps de JS para la consulta
        const q = query(
            loansRef, 
            where("dueDate", ">=", startDate),
            where("dueDate", "<=", endDate)
        );

        const querySnapshot = await getDocs(q);
        console.log(`FetchData: Encontradas ${querySnapshot.size} cuotas entre ${startDate.toLocaleDateString()} y ${endDate.toLocaleDateString()}`);
        const results = [];
        querySnapshot.forEach((doc) => results.push(doc.data()));
        return results;
    };

    /**
     * PROCESAMIENTO CENTRALIZADO (Single Pass)
     * Recorre los datos UNA sola vez y genera todas las métricas.
     */
    const processDashboardData = (data) => {
        // Inicializar acumuladores (Legacy)
        const kpis = { expected: 0, paid: 0, mora: 0, totalDelayedDays: 0, delayedItemsCount: 0 };
        const monthlyEvolucion = {};
        const productsRanking = {};
        const monthlyFlujo = {};
        const paymentStates = { 'PAGADO': 0, 'PARCIAL': 0, 'IMPAGO': 0 };
        const lineDelay = {};
        const lineHealth = {};
        const activeCuits = new Set();
        const paymentsByClient = {};

        // Nuevas Métricas
        const monthlyRefinancing = {}; // { month: { cash: 0, refinanced: 0 } }
        const providerDelay = {}; // { provider: { totalDelay: 0, count: 0, amount: 0 } }
        const portfolioComposition = { 'Vigente': 0, 'Mora 30': 0, 'Mora 60': 0, 'Mora 90+': 0 };
        const ageRisk = { '18-25': { exp: 0, paid: 0 }, '26-35': { exp: 0, paid: 0 }, '36-45': { exp: 0, paid: 0 }, '46-60': { exp: 0, paid: 0 }, '+60': { exp: 0, paid: 0 }, 'N/D': { exp: 0, paid: 0 } };

        const today = new Date();

        data.forEach(item => {
            // Conversiones comunes
            const date = item.dueDate.toDate ? item.dueDate.toDate() : new Date(item.dueDate);
            const month = date.getMonth();
            const line = item.productLine || 'Otros';
            const provider = item.provider || 'Mutual'; // Default provider if missing
            const capital = item.expectedAmount || 0;
            const paid = item.paidAmount || 0;
            const refinanced = item.refinancedAmount || 0;
            const debt = item.remainingBalance || 0;

            // 1. KPIs Basics
            kpis.expected += Number(capital.toFixed(2));
            kpis.paid += Number(paid.toFixed(2));
            
            const isUnpaid = item.status === 'IMPAGO' || item.status === 'PARCIAL' || (debt > 10 && !item.status);
            if (isUnpaid) {
                kpis.mora += Number(debt.toFixed(2));
            }
            if (item.daysDelayed > 0) {
                kpis.totalDelayedDays += item.daysDelayed;
                kpis.delayedItemsCount++;
            }

            // 2. Evolución (Sin cambios)
            if (!monthlyRefinancing[month]) monthlyRefinancing[month] = { cash: 0, refinanced: 0 };
            const effectiveCash = Math.max(0, paid - refinanced);
            monthlyRefinancing[month].cash += effectiveCash;
            monthlyRefinancing[month].refinanced += refinanced;

            if (!monthlyEvolucion[month]) monthlyEvolucion[month] = { amount: 0, count: 0 };
            monthlyEvolucion[month].amount += capital;
            monthlyEvolucion[month].count += 1;

            // 3. Ranking Productos (Sin cambios)
            productsRanking[line] = (productsRanking[line] || 0) + capital;

            // 4. Flujo de Caja (Sin cambios)
            if (!monthlyFlujo[month]) monthlyFlujo[month] = { expected: 0, paid: 0 };
            monthlyFlujo[month].expected += capital;
            monthlyFlujo[month].paid += paid;

            // 5. Comportamiento Pago (Legacy -> KPI Saturación)
            const status = (item.status || 'IMPAGO').toUpperCase();
            if (paymentStates[status] !== undefined) paymentStates[status]++;

            // 6. Atraso & Salud & Proveedor
            if (!lineDelay[line]) lineDelay[line] = { totalDelay: 0, count: 0 };
            if (!lineHealth[line]) lineHealth[line] = { expected: 0, paid: 0 };
            
            if (!providerDelay[provider]) providerDelay[provider] = { totalDelay: 0, count: 0, amount: 0 };
            providerDelay[provider].amount += capital;

            // Cálculo de atraso puntual
            let currentDelay = 0;
            const due = date;
            const paidDate = item.paymentDate ? (item.paymentDate.toDate ? item.paymentDate.toDate() : new Date(item.paymentDate)) : null;

            if (due) {
                 if (status === 'PAGADO' && paidDate) {
                     const diffTime = paidDate - due;
                     currentDelay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                 } else if (due < today && status !== 'PAGADO') {
                     const diffTime = today - due;
                     currentDelay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                 }
            }
            if (currentDelay < 0) currentDelay = 0;
            
            if (currentDelay > 0) {
                lineDelay[line].totalDelay += currentDelay;
                lineDelay[line].count++;
                
                providerDelay[provider].totalDelay += currentDelay;
                providerDelay[provider].count++;
            }

            // Salud Cartera
            lineHealth[line].expected += capital;
            lineHealth[line].paid += paid;

            // Composición Cartera (Buckets del periodo)
            if (currentDelay <= 5) portfolioComposition['Vigente'] += capital; // Tolerancia 5 días
            else if (currentDelay <= 30) portfolioComposition['Mora 30'] += capital;
            else if (currentDelay <= 60) portfolioComposition['Mora 60'] += capital;
            else portfolioComposition['Mora 90+'] += capital;

            // 7. Demográfico & Pagadores & Riesgo/Edad
            if (item.clientCuit) {
                 activeCuits.add(String(item.clientCuit));
                 if (paid > 0) {
                     paymentsByClient[item.clientCuit] = (paymentsByClient[item.clientCuit] || 0) + paid;
                 }

                 // Riesgo por Edad
                 const client = clientCache[item.clientCuit];
                 let ageGroup = 'N/D';
                 if (client && client.birthDate) {
                     const age = calculateAge(client.birthDate);
                     if (age >= 18 && age <= 25) ageGroup = '18-25';
                     else if (age >= 26 && age <= 35) ageGroup = '26-35';
                     else if (age >= 36 && age <= 45) ageGroup = '36-45';
                     else if (age >= 46 && age <= 60) ageGroup = '46-60';
                     else if (age > 60) ageGroup = '+60';
                 }
                 ageRisk[ageGroup].exp += capital;
                 ageRisk[ageGroup].paid += paid;
            }
        });

        return {
            kpis, monthlyEvolucion, productsRanking, monthlyFlujo, paymentStates, 
            lineDelay, lineHealth, activeCuits, paymentsByClient,
            monthlyRefinancing, providerDelay, portfolioComposition, ageRisk
        };
    };

    /**
     * Renderizado de KPIs
     */
    /**
     * Renderizado de KPIs (Optimizado)
     */
    const updateKPIs = (kpis) => {
        const effectiveRate = kpis.expected > 0 ? (kpis.paid / kpis.expected) * 100 : 0;
        const avgDelay = kpis.delayedItemsCount > 0 ? (kpis.totalDelayedDays / kpis.delayedItemsCount) : 0;

        $('#kpi-capital').text(kpis.expected.toLocaleString('es-AR', { minimumFractionDigits: 2 }));
        $('#kpi-efectividad').text(effectiveRate.toFixed(1));
        $('#kpi-atraso').text(avgDelay.toFixed(1));
    };

    /**
     * Gráfico de Evolución de Ventas
     */
    /**
     * Gráfico de Evolución de Ventas (Optimizado)
     */
    const renderEvolucion = (monthlyData) => {
        document.querySelector("#chart-evolucion-ventas").innerHTML = "";

        const categories = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const seriesAmount = categories.map((_, i) => monthlyData[i]?.amount || 0);
        const seriesCount = categories.map((_, i) => monthlyData[i]?.count || 0);

        const options = {
            chart: { height: 350, type: 'line', toolbar: { show: false } },
            stroke: { width: [0, 4] },
            series: [{
                name: 'Monto Vencimiento',
                type: 'column',
                data: seriesAmount
            }, {
                name: 'Cantidad Cuotas',
                type: 'line',
                data: seriesCount
            }],
            colors: ['#5156be', '#2ab57d'],
            xaxis: { categories },
            yaxis: [
                { 
                    title: { text: 'Monto ($)' },
                    labels: {
                        formatter: (val) => '$' + val.toLocaleString('es-AR')
                    }
                },
                { opposite: true, title: { text: 'Cantidad' } }
            ],
            tooltip: {
                y: {
                    formatter: function (val, { seriesIndex }) {
                        if (seriesIndex === 0) return "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2 });
                        return val;
                    }
                }
            }
        };

        if (charts.evolucion) charts.evolucion.destroy();
        charts.evolucion = new ApexCharts(document.querySelector("#chart-evolucion-ventas"), options);
        charts.evolucion.render();
    };

    /**
     * Gráfico de Ranking de Productos
     */
    /**
     * Gráfico de Ranking de Productos
     */
    const renderRanking = (products) => {
        document.querySelector("#chart-ranking-productos").innerHTML = "";

        const options = {
            chart: { type: 'donut', height: 350 },
            series: Object.values(products),
            labels: Object.keys(products),
            colors: ['#5156be', '#2ab57d', '#fd625e', '#ffbf53', '#4ba6ef'],
            legend: { position: 'bottom' },
            tooltip: {
                y: {
                    formatter: (val) => "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2 })
                }
            }
        };

        if (charts.ranking) charts.ranking.destroy();
        charts.ranking = new ApexCharts(document.querySelector("#chart-ranking-productos"), options);
        charts.ranking.render();
    };

    /**
     * Gráfico de Flujo de Caja
     */
    /**
     * Gráfico de Flujo de Caja
     */
    const renderFlujo = (monthly) => {
        document.querySelector("#chart-flujo-caja").innerHTML = "";

        const categories = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const seriesExpected = categories.map((_, i) => monthly[i]?.expected || 0);
        const seriesPaid = categories.map((_, i) => monthly[i]?.paid || 0);

        const options = {
            chart: { height: 350, type: 'area', toolbar: { show: false } },
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth', width: 2 },
            series: [
                { name: 'Dinero Cobrado', data: seriesPaid },
                { name: 'Dinero Esperado', data: seriesExpected }
            ],
            colors: ['#2ab57d', '#74788d'],
            xaxis: { categories },
            yaxis: {
                labels: {
                    formatter: (val) => {
                        if (val >= 1000000) return "$" + (val / 1000000).toFixed(1) + "M";
                        if (val >= 1000) return "$" + (val / 1000).toFixed(0) + "k";
                        return "$" + val.toFixed(0);
                    }
                }
            },
            tooltip: {
                y: {
                    formatter: (val) => "$" + val.toLocaleString('es-AR', { maximumFractionDigits: 0 })
                }
            }
        };

        if (charts.flujo) charts.flujo.destroy();
        charts.flujo = new ApexCharts(document.querySelector("#chart-flujo-caja"), options);
        charts.flujo.render();
    };

    /**
     * Gráfico de Comportamiento de Pago (Barra Apilada)
     */
    /**
     * Gráfico de Comportamiento de Pago (Barra Apilada)
     */
    const renderPago = (states) => {
        document.querySelector("#chart-comportamiento-pago").innerHTML = ""; // Clear spinner
        const total = (states['PAGADO'] + states['PARCIAL'] + states['IMPAGO']) || 1;
        const series = [
            { name: 'Pagado', data: [(states['PAGADO'] / total * 100).toFixed(1)] },
            { name: 'Parcial', data: [(states['PARCIAL'] / total * 100).toFixed(1)] },
            { name: 'Impago', data: [(states['IMPAGO'] / total * 100).toFixed(1)] }
        ];

        const options = {
            chart: { type: 'bar', height: 350, stacked: true, stackType: '100%', toolbar: { show: false } },
            plotOptions: { bar: { horizontal: true } },
            series: series,
            colors: ['#2ab57d', '#ffbf53', '#fd625e'],
            xaxis: { categories: ['Cartera %'] },
            legend: { position: 'bottom' },
            dataLabels: {
                enabled: true,
                style: { 
                    colors: ['#FFFFFF'],
                    fontSize: '13px',
                    fontWeight: 800
                },
                dropShadow: { enabled: false }
            },
            theme: { mode: 'light' }
        };

        if (charts.pago) charts.pago.destroy();
        charts.pago = new ApexCharts(document.querySelector("#chart-comportamiento-pago"), options);
        charts.pago.render();
    };

    /**
     * Gráfico Demográfico (Optimizado con Caché)
     */
    /**
     * Gráfico Demográfico (Optimizado con Caché)
     */
    const renderDemografico = async (activeCuitsSet) => { // Recibe Set de CUITs
        const container = document.querySelector("#chart-demografico");
        container.innerHTML = "";

        const activeCuits = [...activeCuitsSet];
        
        if (activeCuits.length === 0) {
            document.querySelector("#chart-demografico").innerHTML = '<div class="alert alert-info py-2 m-0 text-center">No hay créditos activos en este periodo para analizar.</div>';
            return;
        }

        try {
            const ageGroups = { '18-25': 0, '26-35': 0, '36-45': 0, '46-60': 0, '+60': 0, 'N/D': 0 };
            let validAges = 0;

            activeCuits.forEach(cuit => {
                const client = clientCache[cuit]; // Lectura directa de memoria
                if (client && client.birthDate) {
                    const age = calculateAge(client.birthDate);
                    if (age >= 18 && age <= 25) ageGroups['18-25']++;
                    else if (age >= 26 && age <= 35) ageGroups['26-35']++;
                    else if (age >= 36 && age <= 45) ageGroups['36-45']++;
                    else if (age >= 46 && age <= 60) ageGroups['46-60']++;
                    else if (age > 60) ageGroups['+60']++;
                    else ageGroups['N/D']++;
                    
                    if (age > 0) validAges++;
                } else {
                    ageGroups['N/D']++;
                }
            });

            const options = {
                chart: { type: 'bar', height: 350, toolbar: { show: false } },
                series: [{ name: 'Clientes', data: Object.values(ageGroups) }],
                colors: ['#5156be'],
                plotOptions: { bar: { horizontal: true } },
                dataLabels: {
                    enabled: true,
                    style: { colors: ['#fff'] }
                },
                xaxis: { categories: Object.keys(ageGroups) },
                title: { text: `Perfil de ${validAges} clientes activos (Datos en Caché)`, align: 'right', style: { fontSize: '12px', color: '#74788d' } }
            };

            if (charts.demografico) charts.demografico.destroy();
            charts.demografico = new ApexCharts(document.querySelector("#chart-demografico"), options);
            charts.demografico.render();
            
        } catch (error) {
            console.error("Error cargando demográficos:", error);
        }
    };

    /**
     * Gráfico Atraso por Línea
     */
    /**
     * Gráfico Atraso por Línea
     */
    const renderAtrasoLinea = (lineData) => {
            const container = document.querySelector("#chart-atraso-linea");
            container.innerHTML = "";
            
            if (Object.keys(lineData).length === 0) {
                 document.querySelector("#chart-atraso-linea").innerHTML = '<div class="alert alert-info py-2 m-0 text-center">No hay atrasos registrados en este periodo.</div>';
                 return;
            }

            const categories = Object.keys(lineData);
        const series = categories.map(cat => (lineData[cat].totalDelay / (lineData[cat].count || 1)).toFixed(1));

        const options = {
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            series: [{ name: 'Días de Atraso', data: series }],
            plotOptions: { bar: { horizontal: false, columnWidth: '45%' } },
            colors: ['#fd625e'],
            xaxis: { categories: categories },
            dataLabels: {
                enabled: true,
                style: { 
                    colors: ['#FFFFFF'],
                    fontWeight: 600
                },
                dropShadow: { enabled: false }
            }
        };

        if (charts.atrasoLinea) charts.atrasoLinea.destroy();
        charts.atrasoLinea = new ApexCharts(document.querySelector("#chart-atraso-linea"), options);
        charts.atrasoLinea.render();
    };

    /**
     * Gráfico Salud de Cartera
     */
    /**
     * Gráfico Salud de Cartera
     */
    const renderSaludCartera = (lineData) => {
        document.querySelector("#chart-salud-cartera").innerHTML = ""; 

        const sortedLines = Object.keys(lineData).sort((a, b) => {
            const ratioA = lineData[a].paid / (lineData[a].expected || 1);
            const ratioB = lineData[b].paid / (lineData[b].expected || 1);
            return ratioB - ratioA;
        });

        const series = sortedLines.map(cat => {
            const ratio = (lineData[cat].paid / (lineData[cat].expected || 1)) * 100;
            return Math.min(100, ratio).toFixed(1);
        });

        const options = {
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            series: [{ name: '% Cobranza Real', data: series }],
            plotOptions: { bar: { horizontal: true, barHeight: '50%' } },
            xaxis: { 
                categories: sortedLines,
                max: 100,
                labels: { formatter: (val) => val + '%' }
            },
            colors: ['#2ab57d'],
            dataLabels: { 
                enabled: true, 
                formatter: (val) => val + '%',
                textAnchor: 'middle',
                style: { 
                    colors: ['#FFFFFF'],
                    fontWeight: 700
                },
                dropShadow: { enabled: false }
            }
        };

        if (charts.salud) charts.salud.destroy();
        charts.salud = new ApexCharts(document.querySelector("#chart-salud-cartera"), options);
        charts.salud.render();
    };

    /**
     * Métricas Globales de Mora (Independientes del filtro de fecha)
     * - Bucket de Mora (Envejecimiento)
     * - Top 10 Morosos
     */
    const renderGlobalMoraMetrics = async () => {
        try {
            const today = new Date();
            
            // OPTIMIZACIÓN CRÍTICA: 
            // En lugar de traer TODA la historia por fecha (que incluye miles de PAGADOS),
            // traemos solo lo que está IMPAGO o PARCIAL.
            // Firestore maneja "in" hasta 10 valores, perfecto para status.
            const q = query(
                collection(db, "loans_installments"),
                where("status", "in", ["IMPAGO", "PARCIAL"])
            );
            
            const snap = await getDocs(q);
            console.log(`GlobalMetrics: Analizando ${snap.size} cuotas impagas/parciales.`);

            const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
            const clientDebt = {};

            snap.forEach(doc => {
                const data = doc.data();
                
                // Filtro de fecha en memoria (rápido porque el dataset ya es pequeño)
                const due = data.dueDate.toDate ? data.dueDate.toDate() : new Date(data.dueDate);
                if (due >= today) return; // Vence en futuro, no es mora vencida

                const debt = data.remainingBalance || 0;
                if (debt <= 0) return;

                const diffTime = Math.abs(today - due);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

                // Bucket
                if (diffDays <= 30) buckets['0-30'] += debt;
                else if (diffDays <= 60) buckets['31-60'] += debt;
                else if (diffDays <= 90) buckets['61-90'] += debt;
                else buckets['90+'] += debt;

                // Top Morosos (Acumulado por CUIT)
                if (data.clientCuit) {
                    if (!clientDebt[data.clientCuit]) clientDebt[data.clientCuit] = 0;
                    clientDebt[data.clientCuit] += debt;
                }
            });

            // --- Render Bucket Chart ---
            document.querySelector("#chart-bucket-mora").innerHTML = "";

            const bucketOptions = {
                chart: { type: 'bar', height: 350, toolbar: { show: false } },
                series: [{ name: 'Deuda Vencida ($)', data: Object.values(buckets) }],
                colors: ['#f46a6a'],
                plotOptions: { bar: { borderRadius: 4, horizontal: false } }, // Vertical para variar
                xaxis: { categories: Object.keys(buckets), title: { text: 'Días de Atraso' } },
                dataLabels: { enabled: true, formatter: (val) => "$" + (val/1000).toFixed(0) + "k", style: { colors: ['#fff'] } },
                yaxis: { labels: { formatter: (val) => "$" + val.toLocaleString('es-AR') } }
            };
            
            if (charts.bucket) charts.bucket.destroy();
            charts.bucket = new ApexCharts(document.querySelector("#chart-bucket-mora"), bucketOptions);
            charts.bucket.render();

             // --- Render Top 10 Morosos ---
            const sortedDebtors = Object.entries(clientDebt)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10);
            
            if (sortedDebtors.length > 0) {
                 // Usar Caché para nombres
                 const debtorData = sortedDebtors.map(([cuit, amount]) => {
                    const client = clientCache[cuit];
                    return {
                        name: client ? client.fullName : `CUIT ${cuit}`,
                        amount: amount
                    };
                });

                const topMorososOptions = {
                    chart: { type: 'bar', height: 350, toolbar: { show: false } },
                    series: [{ name: 'Deuda Total', data: debtorData.map(d => d.amount) }],
                    colors: ['#343a40'],
                    plotOptions: { bar: { horizontal: true } },
                    xaxis: { categories: debtorData.map(d => d.name) },
                    dataLabels: { enabled: true, formatter: (val) => "$" + val.toLocaleString('es-AR'), style: { colors: ['#fff'] } }
                };

                if (charts.topMorosos) charts.topMorosos.destroy();
                document.querySelector("#chart-top-morosos").innerHTML = "";
                charts.topMorosos = new ApexCharts(document.querySelector("#chart-top-morosos"), topMorososOptions);
                charts.topMorosos.render();
            } else {
                 document.querySelector("#chart-top-morosos").innerHTML = '<div class="alert alert-success text-center">¡No hay morosos registrados!</div>';
            }

        } catch (error) {
            console.error("Error en métricas globales de mora:", error);
        }
    };

    /**
     * Top 10 Pagadores (Basado en el periodo seleccionado)
     */
    /**
     * Top 10 Pagadores (Basado en el periodo seleccionado)
     */
    const renderTopPagadores = async (clientPayments) => {

        const sortedPayers = Object.entries(clientPayments)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);

        if (sortedPayers.length === 0) {
            document.querySelector("#chart-top-pagadores").innerHTML = '<div class="alert alert-warning text-center">Sin pagos en este periodo.</div>';
            return;
        }

        // Usar Caché para nombres
        const payerData = sortedPayers.map(([cuit, amount]) => {
            const client = clientCache[cuit];
            return {
                name: client ? client.fullName : `CUIT ${cuit}`,
                amount: amount
            };
        });

        const options = {
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            series: [{ name: 'Pagado', data: payerData.map(d => d.amount) }],
            colors: ['#2ab57d'], // Verde Success
            plotOptions: { bar: { horizontal: true } },
            xaxis: { categories: payerData.map(d => d.name) },
            dataLabels: { enabled: true, formatter: (val) => "$" + val.toLocaleString('es-AR'), style: { colors: ['#fff'] } }
        };

        if (charts.topPagadores) charts.topPagadores.destroy();
        document.querySelector("#chart-top-pagadores").innerHTML = "";
        charts.topPagadores = new ApexCharts(document.querySelector("#chart-top-pagadores"), options);
        charts.topPagadores.render();
    };

    /**
     * Proyección de Liquidez (Próximos 12 meses)
     */
    const renderProyeccionLiquidez = async () => {
        try {
            const today = new Date();
            const future = new Date();
            future.setMonth(today.getMonth() + 12);

            const q = query(
                collection(db, "loans_installments"),
                where("dueDate", ">=", today),
                where("dueDate", "<=", future),
                orderBy("dueDate", "asc")
            );

            const snap = await getDocs(q);
            const monthlyData = {};

            snap.forEach(doc => {
                const data = doc.data();
                const d = data.dueDate.toDate();
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (!monthlyData[key]) monthlyData[key] = 0;
                monthlyData[key] += (data.remainingBalance || 0);
            });

            const categories = Object.keys(monthlyData).sort();
            const series = categories.map(c => monthlyData[c].toFixed(2));

            const options = {
                chart: { type: 'area', height: 350, toolbar: { show: false } },
                series: [{ name: 'Capital a Ingresar', data: series }],
                xaxis: { categories: categories.map(c => c.split('-').reverse().join('/')) },
                colors: ['#5156be'],
                dataLabels: { enabled: false },
                stroke: { curve: 'smooth' },
                yaxis: { labels: { formatter: (val) => "$" + val.toLocaleString('es-AR') } }
            };

            if (charts.proyeccion) charts.proyeccion.destroy();
            document.querySelector("#chart-proyeccion-liquidez").innerHTML = "";
            charts.proyeccion = new ApexCharts(document.querySelector("#chart-proyeccion-liquidez"), options);
            charts.proyeccion.render();

        } catch (error) {
            console.error("Error en proyeccion:", error);
        }
    };
    /**
     * Feedback Visual de Carga
     */
    const showLoadingState = () => {
        // Mostrar estado de carga en los contenedores de gráficos más grandes
        const loadingHTML = `
            <div class="d-flex justify-content-center align-items-center" style="height: 100%; min-height: 300px;">
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status"></div>
                    <p class="mt-2 text-muted">Procesando datos...</p>
                </div>
            </div>`;
        
        ['#chart-evolucion-ventas', '#chart-ranking-productos', '#chart-flujo-caja', 
         '#chart-comportamiento-pago', '#chart-atraso-linea', '#chart-bucket-mora', 
         '#chart-salud-cartera', '#chart-demografico', '#chart-top-morosos', 
         '#chart-top-pagadores', '#chart-proyeccion-liquidez'].forEach(selector => {
            const el = document.querySelector(selector);
            if(el) el.innerHTML = loadingHTML;
        });
    };

    /**
     * Gráfico Dinero Fresco vs Refinanciación
     */
    const renderDineroFresco = (monthlyData) => {
        document.querySelector("#chart-dinero-fresco").innerHTML = "";

        const categories = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const seriesCash = categories.map((_, i) => monthlyData[i]?.cash || 0);
        const seriesRefinanced = categories.map((_, i) => monthlyData[i]?.refinanced || 0);

        const options = {
            chart: { type: 'bar', height: 350, stacked: true, toolbar: { show: false } },
            series: [
                { name: 'Dinero Fresco', data: seriesCash },
                { name: 'Refinanciación', data: seriesRefinanced }
            ],
            colors: ['#2ab57d', '#f1b44c'],
            xaxis: { categories },
            dataLabels: { enabled: false },
            yaxis: { labels: { formatter: (val) => "$" + (val/1000).toFixed(0) + "k" } },
            tooltip: { y: { formatter: (val) => "$" + val.toLocaleString('es-AR') } }
        };

        if (charts.dineroFresco) charts.dineroFresco.destroy();
        charts.dineroFresco = new ApexCharts(document.querySelector("#chart-dinero-fresco"), options);
        charts.dineroFresco.render();
    };

    /**
     * Gráfico Composición de Cartera (100% Stacked)
     */
    const renderComposicionCartera = (composition) => {
        document.querySelector("#chart-composicion-cartera").innerHTML = "";

        const seriesData = Object.values(composition);
        const total = seriesData.reduce((a, b) => a + b, 0) || 1;
        const series = seriesData.map(val => ((val / total) * 100).toFixed(1));

        const options = {
            chart: { type: 'donut', height: 350 },
            series: series.map(Number),
            labels: Object.keys(composition),
            colors: ['#2ab57d', '#f1b44c', '#fd625e', '#f46a6a'], // Verde, Amarillo, Naranja, Rojo
            legend: { position: 'bottom' },
            plotOptions: { pie: { donut: { size: '65%' } } },
            dataLabels: { enabled: true, formatter: (val) => val.toFixed(1) + "%" },
            tooltip: { 
                y: { 
                    formatter: (val, { seriesIndex, w }) => {
                        const amount = seriesData[seriesIndex];
                        return "$" + amount.toLocaleString('es-AR') + " (" + val + "%)";
                    } 
                } 
            }
        };

        if (charts.composicion) charts.composicion.destroy();
        charts.composicion = new ApexCharts(document.querySelector("#chart-composicion-cartera"), options);
        charts.composicion.render();
    };

    /**
     * Gráfico Demora Promedio por Proveedor
     */
    const renderDemoraProveedor = (providerData) => {
        document.querySelector("#chart-demora-proveedor").innerHTML = "";

        const sortedProviders = Object.keys(providerData).sort((a, b) => {
            const delayA = providerData[a].totalDelay / (providerData[a].count || 1);
            const delayB = providerData[b].totalDelay / (providerData[b].count || 1);
            return delayB - delayA; // Mayor demora primero
        }).slice(0, 10); // Top 10

        const series = sortedProviders.map(prov => (providerData[prov].totalDelay / (providerData[prov].count || 1)).toFixed(1));

        const options = {
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            series: [{ name: 'Días de Atraso Prom.', data: series }],
            colors: ['#fd625e'],
            plotOptions: { bar: { horizontal: true } },
            xaxis: { categories: sortedProviders },
            dataLabels: { enabled: true, formatter: (val) => val + " días" }
        };

        if (charts.demoraProv) charts.demoraProv.destroy();
        charts.demoraProv = new ApexCharts(document.querySelector("#chart-demora-proveedor"), options);
        charts.demoraProv.render();
    };

    /**
     * Gráfico Perfil de Riesgo por Edad
     */
    const renderRiesgoEdad = (ageData) => {
        document.querySelector("#chart-riesgo-edad").innerHTML = "";

        const categories = Object.keys(ageData);
        // Tasa de Mora = 1 - (Pagado / Esperado). Si pagado > esperado (adelantado), mora es 0.
        // O mejor: Tasa de Cobro = Pagado / Esperado.
        const efficiencySeries = categories.map(cat => {
            const exp = ageData[cat].exp || 1;
            const pd = ageData[cat].paid || 0;
            return ((pd / exp) * 100).toFixed(1);
        });

        const options = {
            chart: { type: 'radar', height: 350, toolbar: { show: false } },
            series: [{ name: 'Efectividad de Cobro %', data: efficiencySeries }],
            labels: categories,
            colors: ['#5156be'],
            yaxis: { max: 100, min: 0, tickAmount: 4 },
            fill: { opacity: 0.2 },
            markers: { size: 4 },
            tooltip: { y: { formatter: (val) => val + "%" } }
        };

        if (charts.riesgoEdad) charts.riesgoEdad.destroy();
        charts.riesgoEdad = new ApexCharts(document.querySelector("#chart-riesgo-edad"), options);
        charts.riesgoEdad.render();
    };

    const loadDashboard = async () => {
        btnApply.prop('disabled', true).html('<i class="bx bx-loader bx-spin me-1"></i> Actualizando...');
        showLoadingState();
        
        let startDate, endDate;
        if (filterStart.val() && filterEnd.val()) {
            startDate = new Date(filterStart.val() + 'T00:00:00');
            endDate = new Date(filterEnd.val() + 'T23:59:59');
        } else {
            const range = getRangeByPeriod(filterYear.val(), filterPeriod.val());
            startDate = range.start;
            endDate = range.end;
            endDate.setHours(23, 59, 59, 999);
        }

        try {
            // Optimización: Carga en paralelo
            const [_, fetchedData] = await Promise.all([
                preloadClientCache(),
                fetchData(startDate, endDate)
            ]);
            
            // Optimización: Procesar datos UNA sola vez
            const p = processDashboardData(fetchedData);

            updateKPIs(p.kpis);
            
            // Update Saturacion KPI
            const totalOps = (p.paymentStates['PAGADO'] + p.paymentStates['PARCIAL'] + p.paymentStates['IMPAGO']) || 1;
            const saturacion = ((p.paymentStates['PARCIAL'] / totalOps) * 100).toFixed(1);
            $('#kpi-saturacion').text(saturacion);

            // Tab 1: Rentabilidad
            renderEvolucion(p.monthlyEvolucion);
            renderRanking(p.productsRanking);
            renderDineroFresco(p.monthlyRefinancing);
            renderFlujo(p.monthlyFlujo);
            renderProyeccionLiquidez(); // Note: Projection is future, mostly static logic but re-render is fine.
            renderTopPagadores(p.paymentsByClient);
            
            // Tab 2: Riesgo
            // renderPago(p.paymentStates); // Replaced by Composicion
            renderComposicionCartera(p.portfolioComposition);
            renderDemoraProveedor(p.providerDelay);
            renderSaludCartera(p.lineHealth);
            renderRiesgoEdad(p.ageRisk);
            renderGlobalMoraMetrics(); // Bucket & Modosos (Global)

        } catch (error) {
            console.error("Error cargando dashboard:", error);
        } finally {
            btnApply.prop('disabled', false).html('<i class="bx bx-filter-alt me-1"></i> Aplicar');
        }
    };

    // Events
    btnApply.on('click', loadDashboard);
    filterPeriod.on('change', () => {
        if (filterPeriod.val()) {
            filterStart.val('');
            filterEnd.val('');
        }
    });

    // Start
    initFilters();
    loadDashboard();
});
