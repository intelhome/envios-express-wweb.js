/**
 * Middleware de manejo de errores global
 */
exports.errorHandler = (err, req, res, next) => {
    console.error('❌ Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    // Errores de validación
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            result: false,
            status: false,
            error: 'Error de validación',
            details: err.message
        });
    }

    // Errores de MongoDB
    if (err.name === 'MongoError' || err.name === 'MongoServerError') {
        return res.status(500).json({
            result: false,
            status: false,
            error: 'Error de base de datos',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

    // Errores de WhatsApp
    if (err.message && err.message.includes('Session')) {
        return res.status(503).json({
            result: false,
            status: false,
            error: 'Error de sesión de WhatsApp',
            details: err.message
        });
    }

    // Error genérico
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        result: false,
        status: false,
        error: err.message || 'Error interno del servidor',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

/**
 * Middleware para rutas no encontradas
 */
exports.notFound = (req, res) => {
    res.status(404).json({
        result: false,
        error: `Ruta no encontrada: ${req.method} ${req.path}`
    });
};