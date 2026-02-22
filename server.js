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

// 🔹 Memoria temporal conversaciones
let conversations = {};


// =============================
// ENDPOINT EXISTENTE
// =============================
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


// =============================
// NUEVO ENDPOINT IA
// =============================
app.post("/ai-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!conversations[sessionId]) {
      conversations[sessionId] = [
        {
          role: "system",
          content: `
Eres Like AI PRO, consultor experto en automatización con IA.
Debes identificar negocio, problema y objetivo.
Responde siempre en JSON:

{
  "reply": "mensaje",
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

    const parsed = JSON.parse(aiResponse);

    res.json(parsed);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      reply: "Hubo un error procesando tu mensaje.",
      stage: "error"
    });
  }
});


// =============================
// SERVER LISTEN SIEMPRE AL FINAL
// =============================
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});