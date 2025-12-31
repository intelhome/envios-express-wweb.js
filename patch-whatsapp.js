// patch-whatsapp.js
const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

console.log('🔧 Aplicando patch a whatsapp-web.js...');

try {
    let content = fs.readFileSync(clientPath, 'utf8');

    // Buscar y comentar la línea de setUserAgent
    const originalLine = "await this.pupPage.setUserAgent(this.options.userAgent || 'WhatsApp/2.2407.0 Chrome/120.0.0.0');";
    const patchedLine = "// PATCHED: await this.pupPage.setUserAgent(this.options.userAgent || 'WhatsApp/2.2407.0 Chrome/120.0.0.0');";

    if (content.includes(originalLine)) {
        content = content.replace(originalLine, patchedLine);
        fs.writeFileSync(clientPath, content, 'utf8');
        console.log('✅ Patch aplicado correctamente');
    } else if (content.includes(patchedLine)) {
        console.log('✅ Patch ya estaba aplicado');
    } else {
        console.log('⚠️ No se encontró la línea a patchear - puede que la versión sea diferente');
    }
} catch (error) {
    console.error('❌ Error aplicando patch:', error.message);
}