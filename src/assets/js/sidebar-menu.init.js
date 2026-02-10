/**
 * sidebar-menu.init.js
 * Inyección dinámica del menú lateral basada en el rol del usuario.
 */

import { subscribeAuth } from './auth-context.js';
import { getMenuByRole } from './MenuConfig.js';

let menuInitialized = false;

subscribeAuth((state) => {
    if (state.loading || menuInitialized) return;
    if (!state.user) return;

    const role = state.role || 'asistente'; // Default si no hay rol
    const menuItems = getMenuByRole(role);
    renderSideMenu(menuItems);
    menuInitialized = true;
});

function renderSideMenu(menuItems) {
    const sideMenuUl = document.getElementById('side-menu');
    if (!sideMenuUl) return;

    // Limpiar menú existente y dejar solo el título
    sideMenuUl.innerHTML = '<li class="menu-title" data-key="t-menu">Menu</li>';

    menuItems.forEach(item => {

        const li = document.createElement('li');
        li.id = item.id;

        let html = '';
        if (item.subItems && item.subItems.length > 0) {
            html = `
                <a href="javascript: void(0);" class="has-arrow">
                    <i data-feather="${item.icon}"></i>
                    <span>${item.label}</span>
                </a>
                <ul class="sub-menu" aria-expanded="false">
                    ${item.subItems.map(sub => `
                        <li><a href="${sub.link}">${sub.label}</a></li>
                    `).join('')}
                </ul>
            `;
        } else {
            html = `
                <a href="${item.link}">
                    <i data-feather="${item.icon}"></i>
                    <span>${item.label}</span>
                </a>
            `;
        }

        li.innerHTML = html;
        sideMenuUl.appendChild(li);
    });

    // Re-inicializar MetisMenu y Feather Icons si existen
    if (window.jQuery && $.fn.metisMenu) {
        $("#side-menu").metisMenu('dispose');
        $("#side-menu").metisMenu();
    }
    if (window.feather) {
        feather.replace();
    }
}
