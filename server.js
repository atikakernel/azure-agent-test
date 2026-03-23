import 'dotenv/config';
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
const projectEndpoint = process.env.AZURE_PROJECT_ENDPOINT;
const agentName = process.env.AZURE_AGENT_NAME;
const agentVersion = process.env.AZURE_AGENT_VERSION;

// Cliente de Azure con credenciales de identidad
const projectClient = new AIProjectClient(projectEndpoint, new DefaultAzureCredential());

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message || "Hola";
        console.log(`\n💬 Usuario: ${userMessage}`);
        
        const openAIClient = projectClient.getOpenAIClient();
        
        console.log("➡️ Creando conversación...");
        const conversation = await openAIClient.conversations.create({
            items: [{ type: "message", role: "user", content: userMessage }]
        });
        
        console.log(`➡️ Generando respuesta de Papales...`);
        const response = await openAIClient.responses.create(
            { conversation: conversation.id },
            { body: { agent: { name: agentName, version: agentVersion, type: "agent_reference" } } }
        );
        
        const outputText = response.output_text || "El agente no devolvió texto.";
        console.log(`🤖 Papales: ${outputText}`);
        
        res.json({ response: outputText });
    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({ error: "Fallo de conexión: " + error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n================================`);
    console.log(`Papales listo en el puerto ${PORT}`);
    console.log(`================================\n`);
});
