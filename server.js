const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 🔹 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 🔹 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🔹 Memoria temporal conversaciones consultor
let conversations = {};

// 🔹 Memoria temporal bots demo personalizados
let demoBots = {};


// ==================================================
// ENDPOINT EXISTENTE - CREAR BOT EN BASE DE DATOS
// ==================================================
app.post("/create-bot", async (req, res) => {
  try {
    const {
      user_email,
      business_name,
      business_type,
      whatsapp_number,
      bot_objective,
      tone
    } = req.body;

    const { data, error } = await supabase
      .from("bots")
      .insert([
        {
          user_email,
          business_name,
          business_type,
          whatsapp_number,
          bot_objective,
          tone
        }
      ]);

    if (error) throw error;

    res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==================================================
// ENDPOINT IA CONSULTOR
// ==================================================
app.post("/ai-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!conversations[sessionId]) {
      conversations[sessionId] = [
        {
          role: "system",
          content: `
Eres Like AI PRO, consultor experto en automatización con IA.

Tu misión:
1. Identificar tipo de negocio
2. Detectar principal problema
3. Detectar objetivo del negocio
4. Calificar qué tan preparado está para automatizar

Responde SIEMPRE en JSON válido:

{
  "reply": "mensaje natural al usuario",
  "business_type": "",
  "main_problem": "",
  "goal": "",
  "lead_score": 0,
  "stage": "discovery | qualification | impact | closing"
}
`
        }
      ];
    }

    conversations[sessionId].push({
      role: "user",
      content: message
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[sessionId],
      temperature: 0.7
    });

    const aiResponse = completion.choices[0].message.content;

    conversations[sessionId].push({
      role: "assistant",
      content: aiResponse
    });

    // 🔹 Parse seguro
    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch (e) {
      parsed = {
        reply: aiResponse,
        stage: "error"
      };
    }

    res.json(parsed);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      reply: "Hubo un error procesando tu mensaje.",
      stage: "error"
    });
  }
});


// ==================================================
// GENERAR BOT DEMO PERSONALIZADO
// ==================================================
app.post("/generate-demo-bot", async (req, res) => {
  try {
    const { sessionId, business_type, main_problem, goal } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false });
    }

    const prompt = `
Eres el asistente virtual oficial de un negocio tipo ${business_type}.

Objetivo principal:
${goal}

Problema principal que debe resolver:
${main_problem}

Comportamiento obligatorio:
- Responder como bot real en producción
- Ser profesional pero cercano
- Hacer preguntas de calificación
- Detectar intención de compra
- Intentar cerrar cita o venta
- No mencionar que eres una demo
`;

    demoBots[sessionId] = [
      { role: "system", content: prompt }
    ];

    res.json({ success: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});


// ==================================================
// CHAT DEMO (SIMULADOR DE BOT REAL)
// ==================================================
app.post("/demo-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!demoBots[sessionId]) {
      return res.status(400).json({
        reply: "Bot demo no inicializado."
      });
    }

    demoBots[sessionId].push({
      role: "user",
      content: message
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: demoBots[sessionId],
      temperature: 0.7
    });

    const aiReply = completion.choices[0].message.content;

    demoBots[sessionId].push({
      role: "assistant",
      content: aiReply
    });

    res.json({ reply: aiReply });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      reply: "Error en demo."
    });
  }
});


// ==================================================
// SERVER LISTEN SIEMPRE AL FINAL
// ==================================================
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});