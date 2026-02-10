/**
 * Cloud Functions para el Sistema Mutual
 * Last Update: 2026-02-10 09:20
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Función para registrar un usuario Validando un código de invitación.
 */
exports.registerUserWithCode = functions.https.onCall(async (request, context) => {
    // Soporte para 1ra Gen (data) y 2da Gen (request.data)
    const data = (request && request.data) ? request.data : request;
    const { email, password, nombre, invitationCode } = data || {};

    if (!email || !password || !nombre || !invitationCode) {
        throw new functions.https.HttpsError("invalid-argument", "Todos los campos son obligatorios.");
    }

    try {
        // 1. Validar código de invitación
        const invRef = admin.firestore().collection("invitaciones").doc(invitationCode);
        const invDoc = await invRef.get();

        if (!invDoc.exists || invDoc.data().used) {
            throw new functions.https.HttpsError("not-found", "El código de invitación no existe o ya ha sido usado.");
        }

        const role = invDoc.data().role;

        // 2. Crear usuario en Auth
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: nombre,
        });

        // 3. Asignar Custom Claim de Rol
        await admin.auth().setCustomUserClaims(userRecord.uid, { role });

        // 4. Marcar código como usado
        await invRef.update({
            used: true,
            usedBy: userRecord.uid,
            usedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 5. Crear documento de usuario en Firestore
        await admin.firestore().collection("usuarios").doc(userRecord.uid).set({
            nombre,
            email,
            role,
            status: "active",
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, uid: userRecord.uid };

    } catch (error) {
        console.error("Error en registro:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Cambiar el rol de un usuario (Solo Super Admin)
 */
exports.setUserRole = functions.https.onCall(async (request, context) => {
    // Soporte para 1ra y 2da Gen
    const data = (request && request.data) ? request.data : request;
    const ctx = (request && request.auth) ? request : context;

    // Validar que el que llama sea Super Admin
    if (!ctx.auth || ctx.auth.token.role !== "super_admin") {
        throw new functions.https.HttpsError("permission-denied", "Solo el Super Admin puede cambiar roles.");
    }

    const { uid, newRole } = data;
    const validRoles = ["super_admin", "admin", "administrativo", "asistente"];

    if (!validRoles.includes(newRole)) {
        throw new functions.https.HttpsError("invalid-argument", "Rol no válido.");
    }

    try {
        await admin.auth().setCustomUserClaims(uid, { role: newRole });
        await admin.firestore().collection("usuarios").doc(uid).update({ role: newRole });
        return { success: true };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Activar/Desactivar usuario (Solo Super Admin)
 */
exports.toggleUserStatus = functions.https.onCall(async (request, context) => {
    // Soporte para 1ra y 2da Gen
    const data = (request && request.data) ? request.data : request;
    const ctx = (request && request.auth) ? request : context;

    if (!ctx.auth || ctx.auth.token.role !== "super_admin") {
        throw new functions.https.HttpsError("permission-denied", "Acceso denegado.");
    }

    const { uid, disabled } = data;

    try {
        await admin.auth().updateUser(uid, { disabled });
        await admin.firestore().collection("usuarios").doc(uid).update({ 
            status: disabled ? "inactive" : "active" 
        });
        return { success: true };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Eliminar usuario (Solo Super Admin)
 */
exports.deleteUser = functions.https.onCall(async (request, context) => {
    // Soporte para 1ra y 2da Gen
    const data = (request && request.data) ? request.data : request;
    const ctx = (request && request.auth) ? request : context;

    if (!ctx.auth || ctx.auth.token.role !== "super_admin") {
        throw new functions.https.HttpsError("permission-denied", "Acceso denegado.");
    }

    const { uid } = data;

    try {
        await admin.auth().deleteUser(uid);
        await admin.firestore().collection("usuarios").doc(uid).delete();
        return { success: true };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});
