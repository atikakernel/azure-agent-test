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

    // 1. INTENTO CON OPCIÓN 1 DEL USUARIO (OpenAI SDK + Version M??gica)
    if (apiKey) {
        try {
            console.log(`[CHAT] Intentando OPCIÓN 1 (OpenAI SDK + v2024-02-15-preview)...`);
            
            const client = new AzureOpenAI({
                endpoint: endpoint.trim(),
                apiKey: apiKey.trim(),
                apiVersion: "2024-02-15-preview",
                deployment: agentName // Usamos el nombre del agente como deployment
            });

            const completion = await client.chat.completions.create({
                messages: [{ role: "user", content: userMessage }],
                model: "" // El deployment ya especifica el modelo
            });

            return res.json({ response: completion.choices[0].message.content });
        } catch (error) {
            console.error("[CHAT] Falló Opción 1:", error.message);
        }
    }

    // 2. FALLBACK AL SDK OFICIAL (Original)
    if (projectClient) {
        try {
            console.log(`[CHAT] Fallback al SDK Oficial (MI)...`);
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
            console.error("[CHAT] Falló también el SDK oficial:", error.message);
            res.status(500).json({ error: "Error en todas las vías de comunicación.", details: error.message });
        }
    } else {
        res.status(500).json({ error: "Servicio no inicializado." });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
