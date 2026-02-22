require("dotenv").config();
const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let sessions = {}; 
const DEMO_LIMIT = 6; // Sincronizado con el frontend

app.post("/ai-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        wizardMessages: [],
        demoMessages: [],
        data: { name: null, email: null, business_name: null, industry: null, platform: null, problem: null, bot_name: null },
        demoCount: 0,
        demoActive: false
      };
    }

    const session = sessions[sessionId];
    if (session.demoActive) return res.json({ ready_for_demo: true, reply: "Tu demo ya está activa." });

    session.wizardMessages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres el consultor de Like AI PRO. Configura el asistente preguntando: 1.Nombre/Email, 2.Negocio/Giro, 3.Canal(WhatsApp/Web), 4.Problema, 5.Nombre del bot. 
          Cuando tengas TODO, pon "ready_for_demo": true.
          Responde SIEMPRE en JSON: {"reply": "...", "extracted_data": {...}, "ready_for_demo": false/true}`
        },
        ...session.wizardMessages
      ],
      response_format: { type: "json_object" }
    });

    let aiResponse = JSON.parse(completion.choices[0].message.content);
    
    // Actualizar datos
    if (aiResponse.extracted_data) {
      Object.keys(aiResponse.extracted_data).forEach(key => {
        if (aiResponse.extracted_data[key]) session.data[key] = aiResponse.extracted_data[key];
      });
    }

    // SI LA IA TERMINÓ, CONSTRUIMOS EL RESUMEN MANUALMENTE PARA QUE NO FALLE
    if (aiResponse.ready_for_demo) {
      aiResponse.reply = `¡Excelente! He configurado todo. Aquí tienes tu resumen:
      - Nombre: ${session.data.name || 'No provisto'}
      - Correo: ${session.data.email || 'No provisto'}
      - Negocio: ${session.data.business_name || 'No provisto'}
      - Giro: ${session.data.industry || 'No provisto'}
      - Canal: ${session.data.platform || 'No provisto'}
      - Problema: ${session.data.problem || 'No provisto'}
      - Nombre del bot: ${session.data.bot_name || 'Asistente Virtual'}
      
      A continuación, se activará la demo. ¡Pruébame!`;

      await supabase.from("leads").insert([session.data]);
      session.demoActive = true;
    }

    session.wizardMessages.push({ role: "assistant", content: aiResponse.reply });
    res.json(aiResponse);

  } catch (error) {
    res.status(500).json({ reply: "Error en el servidor." });
  }
});

// Endpoint de demo (sin cambios significativos, solo asegurar límites)
app.post("/demo-chat", async (req, res) => {
  const { sessionId, message } = req.body;
  const session = sessions[sessionId];
  if (!session || !session.demoActive) return res.status(400).json({ reply: "Completa el wizard." });

  if (session.demoCount >= DEMO_LIMIT) {
    return res.json({ reply: "🛑 Demo finalizada. Suscríbete para continuar.", locked: true, messagesLeft: 0 });
  }

  try {
    session.demoCount++;
    session.demoMessages.push({ role: "user", content: message });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Eres ${session.data.bot_name || 'Asistente'}. Trabajas para ${session.data.business_name}. Misión: ${session.data.problem}.` },
        ...session.demoMessages.slice(-6)
      ]
    });
    const reply = completion.choices[0].message.content;
    session.demoMessages.push({ role: "assistant", content: reply });
    res.json({ reply, messagesLeft: DEMO_LIMIT - session.demoCount, locked: (DEMO_LIMIT - session.demoCount) <= 0 });
  } catch (e) { res.status(500).json({ reply: "Error en demo." }); }
});

app.listen(PORT, () => console.log(`🚀 Puerto ${PORT}`));