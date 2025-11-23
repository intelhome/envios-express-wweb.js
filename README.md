# tools

-node version 22.9.0

# install project

npm install || npm install --force

# run project

npm start

# port default 8000

## Crear sesion para usuario (POST)

http://localhost:4010/crear-usuario

{
    "nombre": "Prueba registro whatsapp",
    "id_externo": "[id_externo]",
    "descripcion": "Este es un ejemplo de registro",
    "receive_messages": false
}

# Enviar mensaje (POST)

http://localhost:4010/send-message/[id_externo]

{
    "tempMessage": "Mensaje de test",
    "number": "986553331"
}