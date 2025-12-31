const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const path = require("path");

function setupExpressApp() {
    const app = express();

    // Middlewares
    app.use(fileUpload({ createParentPath: true }));
    app.use(cors());
    app.use(bodyParser.json({ limit: "50mb" }));
    app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
    
    // IMPORTANTE: Servir archivos estáticos desde client
    app.use(express.static(path.join(__dirname, "..", "client")));

    return app;
}

module.exports = { setupExpressApp };