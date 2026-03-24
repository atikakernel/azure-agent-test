import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";
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
// Configuración de Azure AI
// ==========================================
const endpoint = process.env.AZURE_PROJECT_ENDPOINT;
const agentName = process.env.AZURE_AGENT_NAME;
const agentVersion = process.env.AZURE_AGENT_VERSION;

let projectClient;

try {
    if (endpoint) {
        // Inicializamos el cliente SIN llaves, usando la identidad de Azure (Managed Identity)
        projectClient = new AIProjectClient(endpoint.trim(), new DefaultAzureCredential());
        console.log("✅ Cliente de Azure AI configurado con éxito usando DefaultAzureCredential.");
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
        res.status(500).json({ error: "Fallo de comunicación con la IA." });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
