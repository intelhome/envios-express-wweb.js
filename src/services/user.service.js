const { getCollection } = require('../config/database');

const COLLECTION_NAME = 'registros_whatsapp';

/**
 * Crear un nuevo usuario
 */
exports.createUser = async (userData) => {
    const collection = getCollection(COLLECTION_NAME);

    const newUser = {
        ...userData,
        fechaCreacion: new Date(),
        estado: 'creado'
    };

    await collection.insertOne(newUser);

    return newUser;
};

/**
 * Obtener usuario por ID externo
 */
exports.getUserByIdExterno = async (id_externo) => {
    const collection = getCollection(COLLECTION_NAME);
    return await collection.findOne({ id_externo });
};

/**
 * Obtener todos los usuarios
 */
exports.getAllUsers = async () => {
    const collection = getCollection(COLLECTION_NAME);
    return await collection.find().toArray();
};

/**
 * Actualizar usuario
 */
exports.updateUser = async (id_externo, updatedFields) => {
    const collection = getCollection(COLLECTION_NAME);

    return await collection.updateOne(
        { id_externo },
        {
            $set: {
                ...updatedFields,
                updatedAt: new Date()
            }
        }
    );
};

/**
 * Eliminar usuario
 */
exports.deleteUser = async (id_externo) => {
    const collection = getCollection(COLLECTION_NAME);
    return await collection.deleteOne({ id_externo });
};

/**
 * Actualizar estado de conexión
 */
exports.updateConnectionStatus = async (id_externo, receive_messages, estado) => {
    const collection = getCollection(COLLECTION_NAME);

    const user = await collection.findOne({ id_externo });
    if (!user) {
        console.warn(`Usuario ${id_externo} no encontrado`);
        return;
    }

    return await collection.updateOne(
        { id_externo },
        {
            $set: {
                estado: estado,
                receive_messages: receive_messages,
                updatedAt: new Date(),
            },
        }
    );
};