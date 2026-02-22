require("dotenv").config(); // Carga variables de entorno localmente
const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Clientes
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_ANON_KEY
);
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

// Almacenamiento en memoria (Se limpia si el servidor se reinicia)
let sessions = {}; 
const DEMO_LIMIT = 10;

// ==================================================
// 1. WIZARD: CAPTURA DE DATOS
// ==================================================
app.post("/ai-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        wizardMessages: [], // Historial del wizard
        demoMessages: [],   // Historial de la demo (vacío al inicio)
        data: {
          name: null, email: null, business_name: null, 
          industry: null, platform: null, problem: null, bot_name: null
        },
        demoCount: 0,
        demoActive: false
      };
    }

    const session = sessions[sessionId];

    // Si la demo ya está activa, avisar al frontend
    if (session.demoActive) {
      return res.json({ ready_for_demo: true, reply: "Tu demo ya está lista." });
    }

    session.wizardMessages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres el consultor experto de Like AI PRO. Tu objetivo es configurar un asistente para el cliente.
          DEBES seguir este orden estricto de preguntas:
          1. Nombre del cliente y Correo electrónico.
          2. Nombre de su negocio y Giro (ej. Clínica, Restaurante).
          3. Canal de implementación (WhatsApp, Telegram o Web).
          4. ¿Cuál es el problema principal que busca resolver?
          5. ¿Nombre para el bot o genérico?

          Responde SIEMPRE en este formato JSON:
          {
            "reply": "Tu respuesta amable al usuario",
            "extracted_data": { "name":..., "email":..., "business_name":..., "industry":..., "platform":..., "problem":..., "bot_name":... },
            "ready_for_demo": true/false
          }`
        },
        ...session.wizardMessages
      ],
      response_format: { type: "json_object" }
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    
    // Actualizar datos de sesión con lo que la IA haya extraído
    if (aiResponse.extracted_data) {
      Object.keys(aiResponse.extracted_data).forEach(key => {
        if (aiResponse.extracted_data[key]) {
          session.data[key] = aiResponse.extracted_data[key];
        }
      });
    }

    session.wizardMessages.push({ role: "assistant", content: aiResponse.reply });

    // Guardar en Supabase y activar demo si todo está listo
    if (aiResponse.ready_for_demo) {
      try {
        await supabase.from("leads").insert([{
          email: session.data.email,
          name: session.data.name,
          business: session.data.business_name,
          industry: session.data.industry,
          platform: session.data.platform,
          problem: session.data.problem,
          bot_custom_name: session.data.bot_name
        }]);
        session.demoActive = true;
      } catch (dbError) {
        console.error("Error guardando en Supabase:", dbError);
      }
    }

    res.json(aiResponse);

  } catch (error) {
    console.error("Error en Wizard:", error);
    res.status(500).json({ reply: "Hubo un error configurando tu asistente." });
  }
});

// ==================================================
// 2. DEMO: CHAT PERSONALIZADO
// ==================================================
app.post("/demo-chat", async (req, res) => {
  const { sessionId, message } = req.body;
  const session = sessions[sessionId];

  if (!session || !session.demoActive) {
    return res.status(400).json({ reply: "Debes completar la configuración primero." });
  }

  // Verificar límite de mensajes
  if (session.demoCount >= DEMO_LIMIT) {
    return res.json({
      reply: `🛑 **Demo Finalizada.** Has usado tus 10 mensajes. Tu bot para ${session.data.platform} está listo para ser instalado. ¡Paga el plan completo para continuar!`,
      locked: true,
      messagesLeft: 0
    });
  }

  try {
    session.demoCount++;
    session.demoMessages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres ${session.data.bot_name || 'un Asistente Virtual'}. 
          Trabajas para ${session.data.business_name} del sector ${session.data.industry}.
          Tu misión es: ${session.data.problem}.
          Eres amable y eficiente. No menciones que eres una demo ni que eres una IA de OpenAI.` 
        },
        ...session.demoMessages.slice(-6) // Solo enviamos los últimos mensajes para contexto
      ]
    });

    const reply = completion.choices[0].message.content;
    session.demoMessages.push({ role: "assistant", content: reply });

    res.json({
      reply: reply,
      messagesLeft: DEMO_LIMIT - session.demoCount,
      locked: (DEMO_LIMIT - session.demoCount) <= 0
    });

  } catch (error) {
    console.error("Error en Demo:", error);
    res.status(500).json({ reply: "La demo tuvo un problema técnico." });
  }
});

app.listen(PORT, () => console.log(`🚀 Servidor Like AI PRO corriendo en puerto ${PORT}`));