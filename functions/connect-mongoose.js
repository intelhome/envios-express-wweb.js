const mongoose = require("mongoose");

let mongo_collection = process.env.MONGO_DB_NAME || "whatsapp_db";

// Conectar con Mongoose
const connectMongoose = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL, {
      dbName: mongo_collection,
    });

    console.log("✅ Conectado a Mongoose (WhatsApp Sessions)");
  } catch (error) {
    console.error("❌ Error conectando Mongoose:", error);
    throw error;
  }
};

module.exports = connectMongoose;
