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
        if (apiKey && apiKey.trim() !== "") {
            console.log(`[AUTH] Usando API Key (longitud: ${apiKey.length})`);
            // Usamos el cliente de OpenAI directamente con la versión de API requerida por Foundry Agents
            directOpenAIClient = new AzureOpenAI({
                endpoint: endpoint.trim(),
                apiKey: apiKey.trim(),
                apiVersion: "2024-12-01-preview", // Versión estable para Agents en Foundry
                azureADTokenProvider: undefined 
            });
            console.log("✅ Cliente Azure OpenAI configurado con API Key (Fallback direct).");
        }
        
        // También inicializamos el Proyect Client para otras funciones si es necesario
        console.log("[AUTH] Inicializando con Managed Identity (DefaultAzureCredential)...");
        projectClient = new AIProjectClient(endpoint.trim(), new DefaultAzureCredential());
        console.log("✅ Cliente de Azure AI (Project) configurado.");
    } else {
        console.error("⚠️ ERROR: Falta AZURE_PROJECT_ENDPOINT.");
    }
} catch (error) {
    console.error("❌ Error inicializando cliente de Azure AI:", error.message);
}

app.post('/api/chat', async (req, res) => {
    if (!projectClient && !directOpenAIClient) {
        return res.status(500).json({ error: "Servicio de IA no disponible en este momento." });
    }
    try {
        const userMessage = req.body.message || "Hola";
        
        // Priorizamos el cliente directo (Key) si está disponible, sino el del proyecto (MI)
        const openAIClient = directOpenAIClient || projectClient.getOpenAIClient();
        
        console.log(`[CHAT] Iniciando conversación usando: ${directOpenAIClient ? 'API Key' : 'Managed Identity'}`);
        
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
