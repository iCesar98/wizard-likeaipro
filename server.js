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

const DEMO_LIMIT = 10;

// ==================================================
// IA CONSULTOR (WIZARD DE VENTAS)
// ==================================================
app.post("/ai-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        messages: [],
        stage: "collecting_data",
        data: {
          name: null,
          email: null,
          business_name: null,
          industry: null,
          platform: null,
          problem: null,
          bot_name: null
        },
        demoCount: 0,
        demoActive: false
      };
    }

    const session = sessions[sessionId];

    // Si ya terminó el wizard, lo mandamos a la demo directamente
    if (session.demoActive) {
      return res.json({ redirect: "demo", messagesLeft: DEMO_LIMIT - session.demoCount });
    }

    session.messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres el consultor experto de Like AI PRO. Tu objetivo es configurar un asistente para el cliente.
          DEBES seguir este orden estricto de preguntas (una por una):
          1. Nombre del cliente y Correo electrónico.
          2. Nombre de su negocio y Giro (ej. Clínica, Restaurante).
          3. Canal de implementación (WhatsApp, Telegram o Web).
          4. ¿Cuál es el problema principal que busca resolver? (ej. agendar citas, responder FAQs).
          5. ¿Quiere un nombre específico para su bot o prefiere uno genérico (Asistente Virtual)?

          Cuando tengas TODO, responde con un JSON que incluya "ready_for_demo": true.
          Si falta algo, sigue preguntando amablemente.
          
          Responde SIEMPRE en este formato JSON:
          {
            "reply": "Tu respuesta al usuario",
            "extracted_data": { "name":..., "email":..., "business_name":..., "industry":..., "platform":..., "problem":..., "bot_name":... },
            "ready_for_demo": true/false
          }`
        },
        ...session.messages
      ],
      response_format: { type: "json_object" }
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    
    // Sincronizar datos extraídos por la IA al objeto de sesión
    session.data = { ...session.data, ...aiResponse.extracted_data };
    session.messages.push({ role: "assistant", content: aiResponse.reply });

    // Si la IA detecta que ya tiene todo, guardamos en Supabase y activamos demo
    if (aiResponse.ready_for_demo) {
      await supabase.from("leads").insert({
        email: session.data.email,
        name: session.data.name,
        business: session.data.business_name,
        industry: session.data.industry,
        platform: session.data.platform,
        problem: session.data.problem,
        bot_custom_name: session.data.bot_name
      });
      session.demoActive = true;
    }

    res.json(aiResponse);

  } catch (error) {
    console.error(error);
    res.status(500).json({ reply: "Error en el sistema." });
  }
});

// ==================================================
// CHAT DE DEMO (LIMITADO A 10 MENSAJES)
// ==================================================
app.post("/demo-chat", async (req, res) => {
  const { sessionId, message } = req.body;
  const session = sessions[sessionId];

  if (!session || !session.demoActive) {
    return res.status(400).json({ reply: "Primero completa el registro." });
  }

  // VALIDACIÓN DE LÍMITE
  if (session.demoCount >= DEMO_LIMIT) {
    return res.json({
      reply: `🛑 **Demo Finalizada.** Has alcanzado el límite de 10 mensajes. 
      Tu bot para ${session.data.platform} está listo para ser configurado profesionalmente. 
      Paga el plan completo para activarlo ahora.`,
      locked: true
    });
  }

  try {
    session.demoCount++;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres ${session.data.bot_name || 'un Asistente Virtual'}. 
          Trabajas para ${session.data.business_name} (${session.data.industry}).
          Tu misión es resolver: ${session.data.problem}.
          Eres amable, profesional y eficiente.` 
        },
        ...session.messages.slice(-6), // Enviamos contexto corto para ahorrar tokens
        { role: "user", content: message }
      ]
    });

    const reply = completion.choices[0].message.content;
    const messagesLeft = DEMO_LIMIT - session.demoCount;

    res.json({
      reply: reply,
      messagesLeft: messagesLeft,
      locked: messagesLeft <= 0
    });

  } catch (error) {
    res.status(500).json({ reply: "Error en la demo." });
  }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));