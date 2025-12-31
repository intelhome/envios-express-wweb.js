const { MongoClient } = require("mongodb");
const mongoose = require("mongoose");
const config = require("../../config");

let mongo_collection = process.env.MONGO_DB_NAME || "whatsapp_db";

// Variables globales para mantener las conexiones
let client = null;
let db = null;

// Conectar a MongoDB (driver nativo)
const connectToMongoDB = async () => {
    try {
        client = new MongoClient(config.mongoose.url, {
            // useNewUrlParser y useUnifiedTopology ya no son necesarios en versiones nuevas
        });

        await client.connect();
        console.log("✅ Conectado a MongoDB");

        db = client.db(mongo_collection);

        return db;
    } catch (error) {
        console.error("❌ Error al conectar a MongoDB:", error);
        throw error; // Es importante lanzar el error para que se maneje en server.js
    }
};

// Conectar con Mongoose
const connectMongoose = async () => {
    try {
        await mongoose.connect(config.mongoose.url, {
            dbName: mongo_collection,
        });

        console.log("✅ Conectado a Mongoose");
    } catch (error) {
        console.error("❌ Error conectando Mongoose:", error);
        throw error;
    }
};

// Obtener colección (requiere que connectToMongoDB haya sido llamado primero)
function getCollection(collectionName) {
    if (!db) {
        throw new Error('Database no inicializada. Llama a connectToMongoDB() primero');
    }
    return db.collection(collectionName);
}

// Cerrar todas las conexiones
async function closeConnections() {
    try {
        // Cerrar conexión de MongoDB nativo
        if (client) {
            await client.close();
            console.log('✅ MongoDB (driver nativo) desconectado');
        }

        // Cerrar conexión de Mongoose
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
            console.log('✅ Mongoose desconectado');
        }
    } catch (error) {
        console.error('❌ Error cerrando conexiones:', error);
    }
}

module.exports = {
    connectToMongoDB,
    connectMongoose,
    getCollection,
    closeConnections
};