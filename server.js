import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";
import { AzureKeyCredential } from "@azure/core-auth";
import dns from 'node:dns';

const app = express();
app.use(cors({ origin: '*', methods: '*' }));
app.use(express.json());
app.use(express.static('public'));

// ==========================================
// CONFIGURACIÓN DE RED (Bypass DNS)
// ==========================================
const AZURE_HOST = process.env.AZURE_HOST;
const AZURE_IP = process.env.AZURE_IP;

if (AZURE_HOST && AZURE_IP) {
  const originalLookup = dns.lookup;
  dns.lookup = (hostname, options, callback) => {
    let actualOptions = options;
    let actualCallback = callback;
    if (typeof options === 'function') {
      actualCallback = options;
      actualOptions = {};
    }

    if (hostname === AZURE_HOST) {
      console.log(`[DNS Bypass] Forzando ${hostname} -> ${AZURE_IP}`);
      if (actualOptions.all) {
        return actualCallback(null, [{ address: AZURE_IP, family: 4 }]);
      }
      return actualCallback(null, AZURE_IP, 4);
    }
    return originalLookup(hostname, options, callback);
  };
}

// ==========================================
// CONFIGURACIÓN DE AZURE AI
// ==========================================

const endpoint = process.env.AZURE_PROJECT_ENDPOINT;
const apiKey = process.env.AZURE_AI_API_KEY;
const agentName = process.env.AZURE_AGENT_NAME;
const agentVersion = process.env.AZURE_AGENT_VERSION;

let projectClient;

try {
    if (endpoint) {
        console.log(`[DEBUG] Endpoint: ${endpoint}`);
        console.log(`[DEBUG] API Key present: ${apiKey ? 'SÍ (longitud ' + apiKey.length + ')' : 'NO'}`);

        if (apiKey && apiKey.trim() !== "") {
            // Si hay una API Key, la usamos (es más fiable si el RBAC falla)
            projectClient = new AIProjectClient(endpoint.trim(), new AzureKeyCredential(apiKey.trim()));
            console.log("✅ Cliente de Azure AI configurado usando API Key.");
        } else {
            // Si no hay llave, usamos la identidad de Azure
            projectClient = new AIProjectClient(endpoint.trim(), new DefaultAzureCredential());
            console.log("✅ Cliente de Azure AI configurado usando DefaultAzureCredential.");
        }
    } else {
        console.error("⚠️ ERROR: Falta AZURE_PROJECT_ENDPOINT.");
    }
} catch (error) {
    console.error("❌ Error inicializando cliente de Azure AI:", error.message);
}

app.post('/api/chat', async (req, res) => {
    if (!projectClient) {
        return res.status(500).json({ error: "Servicio de IA no disponible en este momento." });
    }
    try {
        const userMessage = req.body.message || "Hola";
        const openAIClient = projectClient.getOpenAIClient();
        
        const conversation = await openAIClient.conversations.create({
            items: [{ type: "message", role: "user", content: userMessage }]
        });
        
        const response = await openAIClient.responses.create(
            { conversation: conversation.id },
            { body: { agent: { name: agentName, version: agentVersion, type: "agent_reference" } } }
        );
        
        const outputText = response.output_text || "Sin respuesta del agente.";
        res.json({ response: outputText });
    } catch (error) {
        console.error("Error en Chat:", error.message);
        
        // Diagnóstico detallado para el usuario
        if (error.message.includes("401") || error.message.includes("principal lacks")) {
            console.error("🔍 DIAGNÓSTICO: Error de permisos (RBAC). La identidad no tiene acceso al agente.");
            console.error("Asegúrate de que la Managed Identity tenga el rol 'Azure AI Developer'.");
        } else if (error.message.includes("ENOTFOUND")) {
            console.error("🔍 DIAGNÓSTICO: Error de red/DNS. No se puede resolver el host de Azure.");
        }
        
        res.status(500).json({ 
            error: "Fallo de comunicación con la IA.",
            details: error.message.includes("401") ? "Error de permisos en Azure (RBAC)." : error.message
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
