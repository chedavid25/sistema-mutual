/**
 * MenuConfig.js
 * Configuración centralizada de la navegación basada en roles.
 */

export const menuConfig = [
    {
        id: "mm-mutual",
        label: "Mutual",
        icon: "pie-chart", // Icono de Feather
        roles: ["super_admin", "admin", "administrativo", "asistente"],
        subItems: [
            {
                label: "Importar Archivo",
                link: "apps-prestamos-importar.html",
                roles: ["super_admin", "admin"]
            },
            {
                label: "Dashboard de Gráficos",
                link: "apps-prestamos-dashboard.html",
                roles: ["super_admin", "admin", "administrativo", "asistente"]
            },
            {
                label: "Cartera de Clientes",
                link: "apps-clientes.html",
                roles: ["super_admin", "admin", "administrativo", "asistente"]
            }
        ]
    },
    {
        id: "mm-admin",
        label: "Administración",
        icon: "shield", // Icono de Feather
        roles: ["super_admin"],
        subItems: [
            {
                label: "Gestión de Usuarios",
                link: "admin-users.html",
                roles: ["super_admin"]
            }
        ]
    }
];

export const getMenuByRole = (role) => {
    return menuConfig.filter(item => {
        const hasRole = item.roles.includes(role);
        if (hasRole && item.subItems) {
            item.subItems = item.subItems.filter(sub => sub.roles.includes(role));
        }
        return hasRole;
    });
};
