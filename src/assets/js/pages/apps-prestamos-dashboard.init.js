/**
 * apps-prestamos-dashboard.init.js
 * Versión ULTRA-RÁPIDA: Carga única de métricas globales + Cacheo inteligente.
 */

import { db } from '../firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

$(document).ready(function() {

    // 1. Configuración UI
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    const filterYear = $('#filter-year');
    const filterPeriod = $('#filter-period');
    const filterStart = $('#filter-start-date');
    const filterEnd = $('#filter-end-date');
    const btnApply = $('#btn-apply-filters');

    // 2. Instancias de Gráficos
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

    // 3. Caché Local
    let cuitNames = {}; 

    // --- FUNCIONES UTILITARIAS ---

    const initFilters = () => {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear; i >= currentYear - 5; i--) {
            filterYear.append(`<option value="${i}">${i}</option>`);
        }
    };

    const getRangeByPeriod = (year, period) => {
        let start, end;
        const now = new Date();
        const y = parseInt(year);

        if (!isNaN(parseInt(period))) {
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
                case 'year': start = new Date(y, 0, 1); end = new Date(y, 11, 31); break;
                default: start = new Date(y, 0, 1); end = new Date(y, 11, 31);
            }
        }
        return { start, end };
    };

    const calculateAge = (birthDate, todayDate) => {
        if (!birthDate) return null;
        const birth = birthDate.toDate ? birthDate.toDate() : new Date(birthDate);
        let age = todayDate.getFullYear() - birth.getFullYear();
        const m = todayDate.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && todayDate.getDate() < birth.getDate())) age--;
        return age;
    };

    // --- DATA FETCHING ---

    const fetchData = async (startDate, endDate) => {
        const loansRef = collection(db, "loans_installments");
        const q = query(
            loansRef, 
            where("dueDate", ">=", startDate),
            where("dueDate", "<=", endDate)
        );
        const querySnapshot = await getDocs(q);
        const results = [];
        querySnapshot.forEach((doc) => results.push(doc.data()));
        return results;
    };

    // --- PROCESAMIENTO PRINCIPAL (Ventas, Flujo, Riesgo de Periodo) ---
    const processDashboardData = (data) => {
        // Inicializadores
        const kpis = { expected: 0, paid: 0, mora: 0, totalDelayedDays: 0, delayedItemsCount: 0 };
        const monthlyEvolucion = {};
        const productsRanking = {};
        const monthlyFlujo = {};
        const paymentStates = { 'PAGADO': 0, 'PARCIAL': 0, 'IMPAGO': 0 };
        const lineDelay = {};
        const lineHealth = {};
        const paymentsByClient = {};
        const monthlyRefinancing = {}; 
        const seenLoans = new Set(); 
        const providerDelay = {}; 
        const portfolioComposition = { 'Vigente': 0, 'Mora 30': 0, 'Mora 60': 0, 'Mora 90+': 0 };
        const ageRisk = { '18-25': { exp: 0, paid: 0 }, '26-35': { exp: 0, paid: 0 }, '36-45': { exp: 0, paid: 0 }, '46-60': { exp: 0, paid: 0 }, '+60': { exp: 0, paid: 0 }, 'N/D': { exp: 0, paid: 0 } };

        const today = new Date(); 

        data.forEach(item => {
            const date = item.dueDate.toDate ? item.dueDate.toDate() : new Date(item.dueDate);
            const month = date.getMonth();
            const line = (item.productLine || 'Otros').trim().toUpperCase();
            const provider = item.provider || 'Mutual';
            const capital = item.expectedAmount || 0;
            const paid = Math.abs(item.paidAmount || 0);
            const debt = item.remainingBalance || 0;
            const isNewSale = parseInt(item.installmentNumber) === 1; 
            
            // Cacheo de nombres
            if (item.clientCuit && item.clientName) cuitNames[item.clientCuit] = item.clientName;

            // 2. Dinero Fresco (Agrupado por Préstamo Único en este set de datos)
            // Si detectamos un préstamo, sumamos su capital a su mes de emisión.
            // Usamos un Set externo para evitar duplicados si vienen varias cuotas del mismo préstamo.
            if (!seenLoans.has(item.loanId)) {
                seenLoans.add(item.loanId);
                
                const issueDate = item.issueDate ? (item.issueDate.toDate ? item.issueDate.toDate() : new Date(item.issueDate)) : date;
                const saleMonth = issueDate.getMonth();
                const loanRefinanced = item.refinancedAmount || 0; 
                const totalDisbursed = item.disbursedAmount || 0; 
                const loanCash = Math.max(0, totalDisbursed - loanRefinanced);

                if (!monthlyRefinancing[saleMonth]) monthlyRefinancing[saleMonth] = { cash: 0, refinanced: 0 };
                monthlyRefinancing[saleMonth].refinanced += loanRefinanced;
                monthlyRefinancing[saleMonth].cash += loanCash;
            }

            // 2. KPIs y Flujo
            kpis.expected += Number(capital.toFixed(2));
            kpis.paid += Number(paid.toFixed(2));
            
            const isUnpaid = item.status === 'IMPAGO' || item.status === 'PARCIAL' || (debt > 10 && !item.status);
            if (isUnpaid) kpis.mora += Number(debt.toFixed(2));
            if (item.daysDelayed > 0) {
                kpis.totalDelayedDays += item.daysDelayed;
                kpis.delayedItemsCount++;
            }

            // Evolución Vencimientos
            if (!monthlyEvolucion[month]) monthlyEvolucion[month] = { amount: 0, count: 0 };
            monthlyEvolucion[month].amount += capital;
            monthlyEvolucion[month].count += 1;

            // Ranking y Flujo
            productsRanking[line] = (productsRanking[line] || 0) + capital;
            if (!monthlyFlujo[month]) monthlyFlujo[month] = { expected: 0, paid: 0 };
            monthlyFlujo[month].expected += capital;
            monthlyFlujo[month].paid += paid;

            // Estados y Proveedores
            const status = (item.status || 'IMPAGO').toUpperCase();
            if (paymentStates[status] !== undefined) paymentStates[status]++;

            if (!providerDelay[provider]) providerDelay[provider] = { totalDelay: 0, count: 0, amount: 0 };
            providerDelay[provider].amount += capital;

            // Cálculo Mora Puntual
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
                lineDelay[line] = lineDelay[line] || { totalDelay: 0, count: 0 };
                providerDelay[provider].totalDelay += currentDelay;
                providerDelay[provider].count++;
            }
            
            // Salud de Cartera: SOLO cuotas vencidas o del día (filtro fecha futura)
            // O si ya hubo un pago (para no penalizar adelantos)
            if (date <= today || paid > 0) {
                if (!lineHealth[line]) lineHealth[line] = { expected: 0, paid: 0 };
                lineHealth[line].expected += capital;
                lineHealth[line].paid += paid;
            }

            if (lineDelay[line]) {
                 lineDelay[line].count = (lineDelay[line].count || 0) + 1;
            } else if (currentDelay > 0) {
                 lineDelay[line] = { totalDelay: currentDelay, count: 1 };
            }

            if (currentDelay <= 5) portfolioComposition['Vigente'] += capital;
            else if (currentDelay <= 30) portfolioComposition['Mora 30'] += capital;
            else if (currentDelay <= 60) portfolioComposition['Mora 60'] += capital;
            else portfolioComposition['Mora 90+'] += capital;

            // Riesgo Edad
            if (item.clientCuit) {
                 if (paid > 0) paymentsByClient[item.clientCuit] = (paymentsByClient[item.clientCuit] || 0) + paid;
                 
                 let ageGroup = 'N/D';
                 if (item.clientBirthDate) {
                     const age = calculateAge(item.clientBirthDate, date);
                     if (age >= 18 && age <= 25) ageGroup = '18-25';
                     else if (age >= 26 && age <= 35) ageGroup = '26-35';
                     else if (age >= 36 && age <= 45) ageGroup = '36-45';
                     else if (age >= 46 && age <= 60) ageGroup = '46-60';
                     else if (age > 60) ageGroup = '+60';
                 }
                 // Sumar al esperado si venció O si hubo pago (aunque sea adelantado)
                 if (date <= today || paid > 0) {
                    ageRisk[ageGroup].exp += capital;
                 }
                 ageRisk[ageGroup].paid += paid;
            }
        });

        return {
            kpis, monthlyEvolucion, productsRanking, monthlyFlujo, paymentStates, 
            lineDelay, lineHealth, paymentsByClient,
            monthlyRefinancing, providerDelay, portfolioComposition, ageRisk
        };
    };

    // --- ACTUALIZACIÓN UI ---

    const updateKPIs = (kpis) => {
        const effectiveRate = kpis.expected > 0 ? (kpis.paid / kpis.expected) * 100 : 0;
        const avgDelay = kpis.delayedItemsCount > 0 ? (kpis.totalDelayedDays / kpis.delayedItemsCount) : 0;
        $('#kpi-capital').text(kpis.expected.toLocaleString('es-AR', { minimumFractionDigits: 2 }));
        $('#kpi-efectividad').text(effectiveRate.toFixed(1));
        $('#kpi-atraso').text(avgDelay.toFixed(1));
    };

    // --- RENDERIZADORES ---

    const renderEvolucion = (monthlyData) => {
        document.querySelector("#chart-evolucion-ventas").innerHTML = "";
        const categories = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const seriesAmount = categories.map((_, i) => monthlyData[i]?.amount || 0);
        const seriesCount = categories.map((_, i) => monthlyData[i]?.count || 0);

        const options = {
            chart: { height: 350, type: 'line', toolbar: { show: false } },
            stroke: { width: [0, 4] },
            series: [{ name: 'Monto Vencimiento', type: 'column', data: seriesAmount }, { name: 'Cantidad Cuotas', type: 'line', data: seriesCount }],
            colors: ['#5156be', '#2ab57d'],
            xaxis: { categories },
            yaxis: [{ title: { text: 'Monto ($)' }, labels: { formatter: (val) => '$' + val.toLocaleString('es-AR') } }, { opposite: true, title: { text: 'Cantidad' } }],
            tooltip: { y: { formatter: function (val, { seriesIndex }) { if (seriesIndex === 0) return "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2 }); return val; } } }
        };
        if (charts.evolucion) charts.evolucion.destroy();
        charts.evolucion = new ApexCharts(document.querySelector("#chart-evolucion-ventas"), options);
        charts.evolucion.render();
    };

    const renderRanking = (products) => {
        document.querySelector("#chart-ranking-productos").innerHTML = "";
        const options = {
            chart: { type: 'donut', height: 350 },
            series: Object.values(products),
            labels: Object.keys(products),
            colors: ['#5156be', '#2ab57d', '#fd625e', '#ffbf53', '#4ba6ef'],
            legend: { position: 'bottom' },
            tooltip: { y: { formatter: (val) => "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2 }) } }
        };
        if (charts.ranking) charts.ranking.destroy();
        charts.ranking = new ApexCharts(document.querySelector("#chart-ranking-productos"), options);
        charts.ranking.render();
    };

    const renderFlujo = (monthly) => {
        document.querySelector("#chart-flujo-caja").innerHTML = "";
        const categories = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const seriesExpected = categories.map((_, i) => monthly[i]?.expected || 0);
        const seriesPaid = categories.map((_, i) => monthly[i]?.paid || 0);

        const options = {
            chart: { height: 350, type: 'area', toolbar: { show: false } },
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth', width: 2 },
            series: [{ name: 'Dinero Cobrado', data: seriesPaid }, { name: 'Dinero Esperado', data: seriesExpected }],
            colors: ['#2ab57d', '#74788d'],
            xaxis: { categories },
            yaxis: { labels: { formatter: (val) => val >= 1000 ? "$" + (val / 1000).toFixed(0) + "k" : "$" + val.toFixed(0) } },
            tooltip: { y: { formatter: (val) => "$" + val.toLocaleString('es-AR', { maximumFractionDigits: 0 }) } }
        };
        if (charts.flujo) charts.flujo.destroy();
        charts.flujo = new ApexCharts(document.querySelector("#chart-flujo-caja"), options);
        charts.flujo.render();
    };

    const renderDineroFresco = (monthlyData) => {
        document.querySelector("#chart-dinero-fresco").innerHTML = "";
        const categories = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const seriesCash = categories.map((_, i) => monthlyData[i]?.cash || 0);
        const seriesRefinanced = categories.map((_, i) => monthlyData[i]?.refinanced || 0);

        const options = {
            chart: { type: 'bar', height: 350, stacked: true, toolbar: { show: false } },
            series: [{ name: 'Dinero Fresco', data: seriesCash }, { name: 'Refinanciación', data: seriesRefinanced }],
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

    const renderComposicionCartera = (composition) => {
        document.querySelector("#chart-composicion-cartera").innerHTML = "";
        const seriesData = Object.values(composition);
        const total = seriesData.reduce((a, b) => a + b, 0) || 1;
        const series = seriesData.map(val => ((val / total) * 100).toFixed(1));

        const options = {
            chart: { type: 'donut', height: 350 },
            series: series.map(Number),
            labels: Object.keys(composition),
            colors: ['#2ab57d', '#f1b44c', '#fd625e', '#f46a6a'],
            legend: { position: 'bottom' },
            plotOptions: { pie: { donut: { size: '65%' } } },
            dataLabels: { enabled: true, formatter: (val) => val.toFixed(1) + "%" },
            tooltip: { y: { formatter: (val, { seriesIndex }) => "$" + seriesData[seriesIndex].toLocaleString('es-AR') + " (" + val + "%)" } }
        };
        if (charts.composicion) charts.composicion.destroy();
        charts.composicion = new ApexCharts(document.querySelector("#chart-composicion-cartera"), options);
        charts.composicion.render();
    };

    const renderDemoraProveedor = (providerData) => {
        document.querySelector("#chart-demora-proveedor").innerHTML = "";
        const sortedProviders = Object.keys(providerData).sort((a, b) => {
            const delayA = providerData[a].totalDelay / (providerData[a].count || 1);
            const delayB = providerData[b].totalDelay / (providerData[b].count || 1);
            return delayB - delayA;
        }).slice(0, 10);
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

    const renderSaludCartera = (lineData) => {
        document.querySelector("#chart-salud-cartera").innerHTML = "";
        const sortedLines = Object.keys(lineData).sort((a, b) => {
            const ratioA = lineData[a].paid / (lineData[a].expected || 1);
            const ratioB = lineData[b].paid / (lineData[b].expected || 1);
            return ratioB - ratioA;
        });
        const series = sortedLines.map(cat => Math.min(100, (lineData[cat].paid / (lineData[cat].expected || 1)) * 100).toFixed(1));

        const options = {
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            series: [{ name: '% Cobranza Real', data: series }],
            plotOptions: { bar: { horizontal: true, barHeight: '50%' } },
            xaxis: { categories: sortedLines, max: 100, labels: { formatter: (val) => val + '%' } },
            colors: ['#2ab57d'],
            dataLabels: { enabled: true, formatter: (val) => val + '%', style: { colors: ['#FFFFFF'] } }
        };
        if (charts.salud) charts.salud.destroy();
        charts.salud = new ApexCharts(document.querySelector("#chart-salud-cartera"), options);
        charts.salud.render();
    };

    const renderRiesgoEdad = (ageData) => {
        document.querySelector("#chart-riesgo-edad").innerHTML = "";
        const categories = Object.keys(ageData);
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

    const renderTopPagadores = (clientPayments) => {
        const sortedPayers = Object.entries(clientPayments).sort(([,a], [,b]) => b - a).slice(0, 10);
        if (sortedPayers.length === 0) {
            document.querySelector("#chart-top-pagadores").innerHTML = '<div class="alert alert-warning text-center">Sin pagos en este periodo.</div>';
            return;
        }
        // USAMOS EL MAPA 'cuitNames' que llenamos en el bucle principal
        const payerData = sortedPayers.map(([cuit, amount]) => {
            const name = cuitNames[cuit] || `CUIT ${cuit}`;
            return { name: name, amount: amount };
        });
        const options = {
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            series: [{ name: 'Pagado', data: payerData.map(d => d.amount) }],
            colors: ['#2ab57d'],
            plotOptions: { bar: { horizontal: true } },
            xaxis: { categories: payerData.map(d => d.name) },
            dataLabels: { enabled: true, formatter: (val) => "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), style: { colors: ['#fff'] } },
            tooltip: { y: { formatter: (val) => "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) } }
        };
        if (charts.topPagadores) charts.topPagadores.destroy();
        document.querySelector("#chart-top-pagadores").innerHTML = "";
        charts.topPagadores = new ApexCharts(document.querySelector("#chart-top-pagadores"), options);
        charts.topPagadores.render();
    };

    /**
     * Métricas Globales de Mora (Ejecución Independiente)
     */
    const renderGlobalMoraMetrics = async () => {
        try {
            // Loading state local
             document.querySelector("#chart-bucket-mora").innerHTML = '<div class="d-flex justify-content-center align-items-center" style="height: 100%; min-height: 300px;"><div class="text-center"><div class="spinner-border text-primary" role="status"></div></div></div>';
             document.querySelector("#chart-top-morosos").innerHTML = '<div class="d-flex justify-content-center align-items-center" style="height: 100%; min-height: 300px;"><div class="text-center"><div class="spinner-border text-primary" role="status"></div></div></div>';

            const today = new Date();
            // Optimización: Solo traer lo que realmente es deuda
            const q = query(collection(db, "loans_installments"), where("status", "in", ["IMPAGO", "PARCIAL"]));
            
            const snap = await getDocs(q);
            console.log(`GlobalMetrics: Analizando ${snap.size} cuotas impagas.`);

            const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
            const clientDebt = {};
            const localCuitNames = {}; // Mapa local para este contexto

            snap.forEach(doc => {
                const data = doc.data();
                const due = data.dueDate.toDate ? data.dueDate.toDate() : new Date(data.dueDate);
                if (due >= today) return; 

                const debt = data.remainingBalance || 0;
                if (debt <= 0) return;

                const diffTime = Math.abs(today - due);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

                if (diffDays <= 30) buckets['0-30'] += debt;
                else if (diffDays <= 60) buckets['31-60'] += debt;
                else if (diffDays <= 90) buckets['61-90'] += debt;
                else buckets['90+'] += debt;

                if (data.clientCuit) {
                    if (!clientDebt[data.clientCuit]) clientDebt[data.clientCuit] = 0;
                    clientDebt[data.clientCuit] += debt;
                    // Guardar nombre si existe en la cuota (desnormalizado)
                    if (data.clientName) localCuitNames[data.clientCuit] = data.clientName;
                }
            });

            // Render Bucket
            document.querySelector("#chart-bucket-mora").innerHTML = "";
            const bucketOptions = {
                chart: { type: 'bar', height: 350, toolbar: { show: false } },
                series: [{ name: 'Deuda Vencida ($)', data: Object.values(buckets) }],
                colors: ['#f46a6a'],
                plotOptions: { bar: { borderRadius: 4, horizontal: false } },
                xaxis: { categories: Object.keys(buckets), title: { text: 'Días de Atraso' } },
                dataLabels: { enabled: true, formatter: (val) => "$" + (val/1000).toFixed(0) + "k", style: { colors: ['#fff'] } },
                yaxis: { labels: { formatter: (val) => "$" + val.toLocaleString('es-AR') } }
            };
            if (charts.bucket) charts.bucket.destroy();
            charts.bucket = new ApexCharts(document.querySelector("#chart-bucket-mora"), bucketOptions);
            charts.bucket.render();

             // Render Top Morosos
            const sortedDebtors = Object.entries(clientDebt).sort(([,a], [,b]) => b - a).slice(0, 10);
            if (sortedDebtors.length > 0) {
                 const debtorData = sortedDebtors.map(([cuit, amount]) => {
                    const name = localCuitNames[cuit] || `CUIT ${cuit}`; // Usar nombre local
                    return { name: name, amount: amount };
                });
                const topMorososOptions = {
                    chart: { type: 'bar', height: 350, toolbar: { show: false } },
                    series: [{ name: 'Deuda Total', data: debtorData.map(d => d.amount) }],
                    colors: ['#343a40'],
                    plotOptions: { bar: { horizontal: true } },
                    xaxis: { categories: debtorData.map(d => d.name) },
                    dataLabels: { enabled: true, formatter: (val) => "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), style: { colors: ['#fff'] } },
                    tooltip: { y: { formatter: (val) => "$" + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) } }
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
     * Proyección de Liquidez (Ejecución Independiente)
     */
    const renderProyeccionLiquidez = async () => {
        try {
            document.querySelector("#chart-proyeccion-liquidez").innerHTML = '<div class="d-flex justify-content-center align-items-center" style="height: 100%; min-height: 300px;"><div class="text-center"><div class="spinner-border text-primary" role="status"></div></div></div>';

            const today = new Date();
            const future = new Date();
            future.setMonth(today.getMonth() + 6);

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

    const showLoadingState = () => {
        const loadingHTML = `
            <div class="d-flex justify-content-center align-items-center" style="height: 100%; min-height: 300px;">
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status"></div>
                    <p class="mt-2 text-muted">Procesando...</p>
                </div>
            </div>`;
        
        ['#chart-evolucion-ventas', '#chart-ranking-productos', '#chart-flujo-caja', 
         '#chart-comportamiento-pago', '#chart-atraso-linea', 
         '#chart-salud-cartera', '#chart-demografico', 
         '#chart-top-pagadores', '#chart-dinero-fresco', '#chart-composicion-cartera', '#chart-demora-proveedor', '#chart-riesgo-edad'].forEach(selector => {
            const el = document.querySelector(selector);
            if(el) el.innerHTML = loadingHTML;
        });
    };

    /**
     * CARGA PRINCIPAL (Optimizado al Máximo)
     */
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
            // SOLO descargamos los préstamos (ya tienen nombres y fechas adentro)
            // Adiós a la descarga masiva de clientes.
            const fetchedData = await fetchData(startDate, endDate);
            
            // Procesar
            const p = processDashboardData(fetchedData);

            updateKPIs(p.kpis);
            
            // KPI Saturacion
            const totalOps = (p.paymentStates['PAGADO'] + p.paymentStates['PARCIAL'] + p.paymentStates['IMPAGO']) || 1;
            const saturacion = ((p.paymentStates['PARCIAL'] / totalOps) * 100).toFixed(1);
            $('#kpi-saturacion').text(saturacion);

            // Renderizar gráficos ligeros INMEDIATAMENTE
            renderEvolucion(p.monthlyEvolucion);
            renderRanking(p.productsRanking);
            renderDineroFresco(p.monthlyRefinancing);
            renderFlujo(p.monthlyFlujo);
            renderTopPagadores(p.paymentsByClient);
            renderComposicionCartera(p.portfolioComposition);
            renderDemoraProveedor(p.providerDelay);
            renderSaludCartera(p.lineHealth);
            renderRiesgoEdad(p.ageRisk);

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
    loadDashboard(); // Carga de datos dependientes del filtro
    
    // Carga de datos GLOBALES (Singleton - Solo una vez)
    renderProyeccionLiquidez(); 
    renderGlobalMoraMetrics();
});
