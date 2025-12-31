const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
    },
    id_externo: {
        type: String,
        required: true,
        unique: true,
    },
    descripcion: {
        type: String,
        default: "",
    },
    receive_messages: {
        type: Boolean,
        required: true,
        default: false,
    },
    estado: {
        type: String,
        enum: ["desconectado", "qr", "autenticado", "conectado", "error_autenticacion"],
        default: "desconectado",
    },
    // qr: {
    //     type: String,
    //     default: null,
    // },
    // sock: {
    //     connection: String,
    //     lastDisconnect: String,
    //     qr: String,
    // },
    fechaCreacion: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Actualizar fecha automáticamente
userSchema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model("User", userSchema);