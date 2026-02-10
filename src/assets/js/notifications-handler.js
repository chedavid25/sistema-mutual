import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    orderBy, 
    limit, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const notiBadge = document.querySelector('#page-header-notifications-dropdown .badge');
const notiList = document.querySelector('#page-header-notifications-dropdown + .dropdown-menu .simplebar-content-wrapper') || 
                 document.querySelector('#page-header-notifications-dropdown + .dropdown-menu [data-simplebar]');

// Ajuste para encontrar el contenedor correcto dependiendo de la estructura de SimpleBar
const getListContainer = () => {
    const simplebar = document.querySelector('#page-header-notifications-dropdown + .dropdown-menu [data-simplebar]');
    if (simplebar) {
        // Si SimpleBar ya inicializó, buscamos .simplebar-content
        const content = simplebar.querySelector('.simplebar-content');
        return content || simplebar;
    }
    return document.querySelector('#page-header-notifications-dropdown + .dropdown-menu');
};

const q = query(
    collection(db, "notifications"),
    orderBy("date", "desc"),
    limit(5)
);

onSnapshot(q, (snapshot) => {
    const listContainer = getListContainer();
    if (!listContainer) return;

    let unreadCount = 0;
    let html = '';

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (!data.read) unreadCount++;

        // Formatear fecha
        let timeAgo = 'Justo ahora';
        if (data.date) {
            const date = data.date.toDate ? data.date.toDate() : new Date(data.date);
            const diff = new Date() - date;
            const minutes = Math.floor(diff / 60000);
            if (minutes < 60) timeAgo = `Hace ${minutes} min`;
            else if (minutes < 1440) timeAgo = `Hace ${Math.floor(minutes/60)} horas`;
            else timeAgo = date.toLocaleDateString();
        }

        const iconClass = data.type === 'success' ? 'bx-check-circle' : 'bx-info-circle';
        const bgClass = data.type === 'success' ? 'bg-success' : 'bg-primary';

        html += `
        <a href="javascript:void(0);" class="text-reset notification-item">
            <div class="d-flex">
                <div class="flex-shrink-0 avatar-sm me-3">
                    <span class="avatar-title ${bgClass} rounded-circle font-size-16">
                        <i class="bx ${iconClass}"></i>
                    </span>
                </div>
                <div class="flex-grow-1">
                    <h6 class="mb-1">${data.title}</h6>
                    <div class="font-size-13 text-muted">
                        <p class="mb-1">${data.message}</p>
                        <p class="mb-0"><i class="mdi mdi-clock-outline"></i> <span>${timeAgo}</span></p>
                    </div>
                </div>
            </div>
        </a>`;
    });

    if (snapshot.empty) {
        html = '<div class="p-4 text-center text-muted">No hay notificaciones</div>';
    }

    if (listContainer) listContainer.innerHTML = html;
    
    if (notiBadge) {
        if (unreadCount > 0) {
            notiBadge.textContent = unreadCount;
            notiBadge.classList.remove('d-none');
        } else {
            notiBadge.classList.add('d-none');
        }
    }
});
