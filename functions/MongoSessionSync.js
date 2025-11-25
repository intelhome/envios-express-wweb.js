const fs = require("fs").promises;
const path = require("path");

/**
 * Clase para sincronizar sesiones de LocalAuth con MongoDB
 */
class MongoSessionSync {
  constructor(mongoose, clientId, dataPath = "./.wwebjs_auth") {
    this.mongoose = mongoose;
    this.clientId = clientId;
    this.collectionName = `session_auth_info_${this.clientId}`;
    this.sessionPath = path.join(dataPath, `session-${this.clientId}`);
    this.autoSaveInterval = null;
  }

  /**
   * Restaura la sesión desde MongoDB a archivos locales
   */
  async restoreSession() {
    try {
      const collection = this.mongoose.connection.db.collection(
        this.collectionName
      );
      const sessionDoc = await collection.findOne({ key: "session_data" });

      if (sessionDoc && sessionDoc.value) {
        console.log(
          `📦 Restaurando sesión desde MongoDB para: ${this.clientId}`
        );

        const sessionData = JSON.parse(sessionDoc.value);

        // Crear directorio
        await fs.mkdir(this.sessionPath, { recursive: true });

        // Restaurar cada archivo
        for (const [fileName, content] of Object.entries(sessionData)) {
          const filePath = path.join(this.sessionPath, fileName);

          if (typeof content === "string" && content.startsWith("base64:")) {
            // Es base64
            const buffer = Buffer.from(content.substring(7), "base64");
            await fs.writeFile(filePath, buffer);
          } else {
            // Es texto
            await fs.writeFile(filePath, content, "utf-8");
          }
        }

        console.log(`✅ Sesión restaurada para: ${this.clientId}`);
        return true;
      }

      console.log(
        `⚠️ No hay sesión guardada en MongoDB para: ${this.clientId}`
      );
      return false;
    } catch (error) {
      console.error(
        `Error restaurando sesión para ${this.clientId}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Guarda la sesión desde archivos locales a MongoDB
   */
  async saveSession() {
    try {
      // Verificar que el directorio existe
      try {
        await fs.access(this.sessionPath);
      } catch {
        console.log(`⚠️ No hay sesión local para guardar: ${this.clientId}`);
        return false;
      }

      // Leer todos los archivos
      const files = await fs.readdir(this.sessionPath, { withFileTypes: true });
      const sessionData = {};

      for (const file of files) {
        if (file.isFile()) {
          const filePath = path.join(this.sessionPath, file.name);

          try {
            // Intentar como texto
            const content = await fs.readFile(filePath, "utf-8");
            sessionData[file.name] = content;
          } catch {
            // Como binario
            const content = await fs.readFile(filePath);
            sessionData[file.name] = "base64:" + content.toString("base64");
          }
        }
      }

      if (Object.keys(sessionData).length === 0) {
        console.log(`⚠️ No hay datos de sesión para guardar: ${this.clientId}`);
        return false;
      }

      // Guardar en MongoDB
      const collection = this.mongoose.connection.db.collection(
        this.collectionName
      );

      await collection.updateOne(
        { key: "session_data" },
        {
          $set: {
            key: "session_data",
            value: JSON.stringify(sessionData),
            clientId: this.clientId,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      console.log(
        `💾 Sesión guardada en MongoDB para: ${this.clientId} (${
          Object.keys(sessionData).length
        } archivos)`
      );
      return true;
    } catch (error) {
      console.error(
        `Error guardando sesión para ${this.clientId}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Inicia el guardado automático cada 30 segundos
   */
  startAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      await this.saveSession();
    }, 30000); // Cada 30 segundos

    console.log(`⏰ Auto-guardado iniciado para: ${this.clientId}`);
  }

  /**
   * Detiene el guardado automático
   */
  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      console.log(`⏹️ Auto-guardado detenido para: ${this.clientId}`);
    }
  }

  /**
   * Elimina la sesión de MongoDB
   */
  async deleteSession() {
    try {
      const collection = this.mongoose.connection.db.collection(
        this.collectionName
      );
      await collection.deleteMany({});

      // También eliminar archivos locales
      try {
        await fs.rm(this.sessionPath, { recursive: true, force: true });
      } catch (error) {
        // Ignorar si no existe
      }

      console.log(`🗑️ Sesión eliminada para: ${this.clientId}`);
      return true;
    } catch (error) {
      console.error(`Error eliminando sesión para ${this.clientId}:`, error);
      return false;
    }
  }
}

module.exports = MongoSessionSync;
