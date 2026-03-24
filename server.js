import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";
import { AzureKeyCredential } from "@azure/core-auth";
import { AzureOpenAI } from "openai";
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
        console.log(`[AUTH] Usando endpoint: ${endpoint}`);
        console.log("[AUTH] Intentando inicialización oficial con Managed Identity...");
        
        // El AIProjectClient es obligatorio para usar Conversations y Responses (Stateful Agents)
        projectClient = new AIProjectClient(endpoint.trim(), new DefaultAzureCredential());
        
        console.log("✅ Cliente de Azure AI (Project) inicializado con éxito.");
    } else {
        console.error("⚠️ ERROR: Falta AZURE_PROJECT_ENDPOINT.");
    }
} catch (error) {
    console.error("❌ Error CRÍTICO inicializando cliente:", error.message);
}

app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message || "Hola";

    // 1. INTENTO OFICIAL (SDK + Identity)
    if (projectClient) {
        try {
            console.log(`[CHAT] Intento oficial con SDK (MI)...`);
            const openAIClient = projectClient.getOpenAIClient();
            const conversation = await openAIClient.conversations.create({
                items: [{ type: "message", role: "user", content: userMessage }]
            });
            const response = await openAIClient.responses.create(
                { conversation: conversation.id },
                { body: { agent: { name: agentName, version: agentVersion, type: "agent_reference" } } }
            );
            return res.json({ response: response.output_text || "Sin respuesta." });
        } catch (error) {
            console.error("[CHAT] Falló SDK:", error.message);
            if (!apiKey) throw error; // Si no hay llave, no hay fallback posible
        }
    }

    // 2. FALLBACK REST (Directo con API Key usando el endpoint de OpenAI tradicional)
    if (apiKey) {
        try {
            console.log(`[CHAT] ⚠️ Iniciando FALLBACK REST con API Key y endpoint de OpenAI...`);
            
            // Usamos el endpoint de OpenAI tradicional que suele ser m??s estable para REST directo
            // Construido a partir del nombre del recurso que encontramos: dicastellanosr-1278-resource
            const openAIEndpoint = "https://dicastellanosr-1278-resource.openai.azure.com";
            const restUrl = `${openAIEndpoint}/openai/deployments/${agentName}/chat/completions?api-version=2024-02-15-preview`;
            
            console.log(`[CHAT] Consultando: ${restUrl}`);

            const restRes = await fetch(restUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey.trim()
                },
                body: JSON.stringify({
                    messages: [{ role: "user", content: userMessage }]
                })
            });

            if (!restRes.ok) {
                const errData = await restRes.json();
                console.error("[CHAT] Error en REST:", JSON.stringify(errData));
                throw new Error(errData.error?.message || `Error HTTP ${restRes.status}`);
            }

            const data = await restRes.json();
            return res.json({ response: data.choices[0].message.content });
        } catch (fallbackError) {
            console.error("[CHAT] También falló Fallback REST:", fallbackError.message);
            res.status(500).json({ error: "No se pudo contactar con la IA por ninguna vía.", details: fallbackError.message });
        }
    } else {
        res.status(500).json({ error: "Servicio no disponible y sin API Key configurada." });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
