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
const DEMO_LIMIT = 6; 

// ==================================================
// 1. EL WIZARD: CONSULTOR EXPERTO EN ESTRATEGIA
// ==================================================
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
    if (session.demoActive) return res.json({ ready_for_demo: true, reply: "Tu demo ya está activa, ¡adelante!" });

    session.wizardMessages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres el Consultor Senior de Automatización en Like AI PRO. 
          Tu misión no es solo pedir datos, sino asesorar al cliente para que vea el valor de la IA.
          
          PERSONALIDAD:
          - Profesional, visionario y experto.
          - Usas un tono que genera confianza (ej: "Entiendo perfectamente, esa es una gran oportunidad para automatizar").
          - Eres eficiente: haces una pregunta a la vez para no abrumar.

          FLUJO DE DIAGNÓSTICO:
          1. Nombre y Email (con elegancia).
          2. Nombre del Negocio y Giro (mostrando interés en su sector).
          3. Canal de implementación (WhatsApp, Telegram o Web).
          4. El "Pain Point": ¿Qué problema real vamos a solucionar? (Agendar, responder FAQs, capturar leads).
          5. Branding: ¿Cómo se llamará el bot?

          REGLA DE CIERRE:
          Cuando detectes que tienes todos los puntos, pon "ready_for_demo": true.
          No redactes el resumen tú mismo, el sistema lo hará. Solo despídete como el consultor que entrega las llaves de una herramienta poderosa.

          Responde SIEMPRE en este formato JSON:
          {
            "reply": "Tu respuesta como consultor experto",
            "extracted_data": { "name":..., "email":..., "business_name":..., "industry":..., "platform":..., "problem":..., "bot_name":... },
            "ready_for_demo": true/false
          }`
        },
        ...session.wizardMessages
      ],
      response_format: { type: "json_object" }
    });

    let aiResponse = JSON.parse(completion.choices[0].message.content);
    
    // Sincronización de datos extraídos
    if (aiResponse.extracted_data) {
      Object.keys(aiResponse.extracted_data).forEach(key => {
        if (aiResponse.extracted_data[key]) session.data[key] = aiResponse.extracted_data[key];
      });
    }

    // CONSTRUCCIÓN DEL RESUMEN ESTRATÉGICO (FORZADO)
    if (aiResponse.ready_for_demo) {
      aiResponse.reply = `¡Magnífico! He diseñado la arquitectura de tu asistente basándome en lo que me compartiste. Aquí tienes el resumen de configuración de Like AI PRO:
      
      👤 Responsable: ${session.data.name}
      📧 Contacto: ${session.data.email}
      🏢 Negocio: ${session.data.business_name} (${session.data.industry})
      📱 Canal: ${session.data.platform}
      🎯 Objetivo: ${session.data.problem}
      🤖 Identidad: ${session.data.bot_name || 'Asistente Virtual'}

      Todo está listo. A continuación, tomaré un paso atrás y dejaré que interactúes directamente con la tecnología que acabamos de configurar. ¡Disfruta la experiencia!`;

      // Guardar Lead en Supabase
      await supabase.from("leads").insert([session.data]);
      session.demoActive = true;
    }

    session.wizardMessages.push({ role: "assistant", content: aiResponse.reply });
    res.json(aiResponse);

  } catch (error) {
    console.error("Error Wizard:", error);
    res.status(500).json({ reply: "Lo siento, tuvimos un detalle técnico en la consultoría. ¿Podemos retomar?" });
  }
});

// ==================================================
// 2. LA DEMO: EL ASISTENTE PERSONALIZADO
// ==================================================
app.post("/demo-chat", async (req, res) => {
  const { sessionId, message } = req.body;
  const session = sessions[sessionId];

  if (!session || !session.demoActive) return res.status(400).json({ reply: "Configura tu bot primero." });

  if (session.demoCount >= DEMO_LIMIT) {
    return res.json({ 
      reply: `La sesión de prueba para ${session.data.business_name} ha concluido con éxito. Para implementar este asistente en tu canal oficial y escalar tu negocio, es momento de activar el plan completo.`, 
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
          content: `Eres ${session.data.bot_name || 'Asistente Virtual'}. Trabajas para ${session.data.business_name}, una empresa en el sector de ${session.data.industry}. 
          Tu objetivo principal es: ${session.data.problem}.
          Eres extremadamente servicial, conoces bien tu negocio y buscas siempre ayudar al usuario. 
          Eres un bot de producción, no menciones que eres una IA o una prueba.` 
        },
        ...session.demoMessages.slice(-6)
      ]
    });

    const reply = completion.choices[0].message.content;
    session.demoMessages.push({ role: "assistant", content: reply });

    res.json({ 
      reply, 
      messagesLeft: DEMO_LIMIT - session.demoCount, 
      locked: (DEMO_LIMIT - session.demoCount) <= 0 
    });

  } catch (error) {
    console.error("Error Demo:", error);
    res.status(500).json({ reply: "El asistente tuvo un pequeño hipo técnico." });
  }
});

app.listen(PORT, () => console.log(`🚀 Consultor de Like AI PRO activo en puerto ${PORT}`));