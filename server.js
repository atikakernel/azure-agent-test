import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";
import { AzureKeyCredential } from "@azure/core-auth";
import { AzureOpenAI } from "openai";
import dns from 'node:dns';
import { sessionStore } from './lib/sessions.js';

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

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', activeSessions: sessionStore.size(), timestamp: new Date().toISOString() });
});

app.post('/api/chat/reset', (req, res) => {
    const { sessionId } = req.body || {};
    const cleared = sessionId ? sessionStore.clearSession(sessionId) : false;
    res.json({ cleared });
});

app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message || "Hola";
    const sessionId = typeof req.body.sessionId === 'string' && req.body.sessionId ? req.body.sessionId : null;
    const session = sessionId ? sessionStore.getOrCreateSession(sessionId) : null;
    if (session) sessionStore.appendHistory(sessionId, 'user', userMessage);

    // --- TIER 1: AGENT SDK (Camino oficial) ---
    if (projectClient) {
        try {
            console.log(`[CHAT] T1: Agente SDK (MI)...`);
            const openAIClient = projectClient.getOpenAIClient();
            let conversationId = session?.conversationId || null;
            let firstTurn = false;
            if (!conversationId) {
                const conversation = await openAIClient.conversations.create({
                    items: [{ type: "message", role: "user", content: userMessage }]
                });
                conversationId = conversation.id;
                firstTurn = true;
                if (session) sessionStore.setConversationId(sessionId, conversationId);
            }
            const response = await openAIClient.responses.create(
                firstTurn ? { conversation: conversationId } : { conversation: conversationId, input: userMessage },
                { body: { agent: { name: agentName, version: agentVersion, type: "agent_reference" } } }
            );
            const text = response.output_text;
            if (text) {
                if (session) sessionStore.appendHistory(sessionId, 'assistant', text);
                return res.json({ response: text, sessionId });
            }
            console.log("[CHAT] T1 devolvi?? vac??o, saltando a T2...");
        } catch (error) {
            console.error("[CHAT] T1 Fall??:", error.message);
        }
    }

    // --- TIER 2: MODELO SDK (Fallback con API Key) ---
    if (apiKey) {
        try {
            console.log(`[CHAT] T2: Modelo SDK (gpt-oss-120b)...`);
            const modelClient = new AzureOpenAI({
                endpoint: "https://dicastellanosr-1278-resource.openai.azure.com/",
                apiKey: apiKey.trim(),
                apiVersion: "2024-02-15-preview",
                deployment: "gpt-oss-120b"
            });
            const completion = await modelClient.chat.completions.create({
                messages: [
                    { role: "system", content: "Eres un experto de élite en Fórmula 1 (F1). Responde siempre con autoridad técnica. Si el usuario pide comparativos o estadísticas, debes incluir al final de tu respuesta un bloque de código JSON con este formato exacto: { \"action\": \"chart\", \"chartType\": \"bar\", \"title\": \"Título\", \"labels\": [\"A\", \"B\"], \"data\": [10, 20] }. No menciones el JSON en tu texto, solo agrégalo al final." },
                    ...(session ? session.history.map(({ role, content }) => ({ role, content })) : [{ role: "user", content: userMessage }])
                ],
                max_tokens: 800
            });
            const text = completion.choices[0]?.message?.content;
            console.log(`[CHAT] T2 Respuesta: ${text ? text.substring(0, 30) + "..." : "VAC??O"}`);
            if (text) {
                if (session) sessionStore.appendHistory(sessionId, 'assistant', text);
                return res.json({ reply: text, sessionId });
            }
        } catch (error) {
            console.error("[CHAT] T2 Fall??:", error.message);
        }
    }

    // --- TIER 4: FALLBACK FINAL (Si todo falla) ---
    res.status(200).json({ reply: "Lo siento, el servicio de IA está experimentando latencia, pero la conexión es exitosa. Por favor intenta de nuevo en unos segundos.", sessionId });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
