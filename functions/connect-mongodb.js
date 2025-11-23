const { MongoClient } = require("mongodb");

const config = require("../config.js");

let mongo_collection = process.env.MONGO_DB_NAME || "whatsapp_db";

// Conectar a MongoDB
const connectToMongoDB = async () => {
  try {
    const mongoClient = new MongoClient(config.mongoose.url, {
      //   useNewUrlParser: true,
      //   useUnifiedTopology: true,
    });

    await mongoClient.connect();
    console.log("✅ Conectado a MongoDB");

    const db = mongoClient.db(mongo_collection);

    return db;
  } catch (error) {
    console.error("Error al conectar a MongoDB:", error);
  }
};


module.exports = connectToMongoDB;
