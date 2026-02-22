const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let conversations = {};
let demoBots = {};
let sessions = {}; // 🔥 control total por sesión

// ==================================================
// VALIDAR EMAIL
// ==================================================
function isValidEmail(email) {
  return /\S+@\S+\.\S+/.test(email);
}

// ==================================================
// IA CONSULTOR + EMAIL GATE + SAVE LEAD
// ==================================================
app.post("/ai-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        messages: [],
        metrics: {},
        impactCalculated: false,
        emailRequested: false,
        emailSaved: false
      };
    }

    const session = sessions[sessionId];

    // =============================================
    // SI YA CALCULAMOS IMPACTO Y PEDIMOS EMAIL
    // =============================================
    if (session.emailRequested && !session.emailSaved) {
      if (!isValidEmail(message)) {
        return res.json({
          reply: "Por favor escribe un email válido para continuar.",
          stage: "email_capture"
        });
      }

      session.email = message;
      session.emailSaved = true;

      // 🔥 GUARDAR LEAD EN SUPABASE
      await supabase.from("leads").insert({
        name: session.name || null,
        business: session.business || null,
        industry: session.business_type || null,
        monthly_leads: session.metrics.firstNumber || null,
        lost_leads: session.metrics.firstNumber || null,
        ticket_value: session.metrics.secondNumber || null,
        estimated_loss: session.monthlyLoss || null,
        email: session.email
      });

      return res.json({
        reply: `Perfecto ✅

Ya guardé tu análisis y te lo enviaré por correo.

Ahora puedes probar el asistente en modo demo.`,
        demoActivated: true,
        stage: "demo"
      });
    }

    // =============================================
    // FLUJO NORMAL IA
    // =============================================
    session.messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Eres Like AI PRO.

Solo trabajas con:
Gym, Clínica dental, Restaurante, Hotel, Barbería o Estética.

Guía paso a paso:
1. Nombre
2. Negocio
3. Confirmar giro
4. Tipo clientes
5. Problema principal
6. Luego pide números para calcular pérdidas reales.

Cuando tengas números suficientes,
stage debe ser "impact".

Responde SIEMPRE en JSON:

{
  "reply": "",
  "business_type": "",
  "main_problem": "",
  "goal": "",
  "lead_score": 0,
  "stage": "discovery | qualification | metrics | impact"
}
`
        },
        ...session.messages
      ]
    });

    let aiResponse = completion.choices[0].message.content;

    session.messages.push({ role: "assistant", content: aiResponse });

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      parsed = {
        reply: aiResponse,
        stage: "discovery",
        lead_score: 0
      };
    }

    // =============================================
    // CAPTURA DE DATOS CLAVE
    // =============================================
    if (parsed.business_type) {
      session.business_type = parsed.business_type;
    }

    if (!session.name && parsed.stage === "discovery") {
      session.name = message;
    }

    // Captura números
    const numberMatch = message.match(/\d+/);

    if (numberMatch) {
      const number = parseInt(numberMatch[0]);

      if (!session.metrics.firstNumber) {
        session.metrics.firstNumber = number;
      } else if (!session.metrics.secondNumber) {
        session.metrics.secondNumber = number;
      }
    }

    // =============================================
    // CALCULAR IMPACTO
    // =============================================
    if (
      session.metrics.firstNumber &&
      session.metrics.secondNumber &&
      !session.impactCalculated
    ) {
      const lost = session.metrics.firstNumber;
      const ticket = session.metrics.secondNumber;

      const monthlyLoss = lost * ticket;
      session.monthlyLoss = monthlyLoss;
      session.impactCalculated = true;

      parsed.stage = "impact";
      parsed.lead_score = 95;

      parsed.reply += `

📉 Con los datos que me compartiste:

Estás perdiendo aproximadamente $${monthlyLoss.toLocaleString()} al mes por falta de automatización.

Antes de mostrarte el demo personalizado necesito tu email para enviarte el análisis completo.

¿Cuál es tu mejor correo?`;

      session.emailRequested = true;

      return res.json(parsed);
    }

    res.json(parsed);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      reply: "Error procesando mensaje.",
      stage: "error"
    });
  }
});

// ==================================================
// GENERAR BOT DEMO
// ==================================================
app.post("/generate-demo-bot", async (req, res) => {
  try {
    const { sessionId, business_type, goal } = req.body;

    const prompt = `
Eres el chatbot oficial de un ${business_type}.

Tu objetivo es:
${goal}

Debes:
- Atender clientes
- Agendar citas o reservas
- Confirmar disponibilidad
- Intentar cerrar interacción

No mencionar que eres demo.
`;

    demoBots[sessionId] = [
      { role: "system", content: prompt }
    ];

    res.json({ success: true });

  } catch {
    res.status(500).json({ success: false });
  }
});

// ==================================================
app.post("/demo-chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!demoBots[sessionId]) {
      return res.status(400).json({ reply: "Demo no inicializada." });
    }

    demoBots[sessionId].push({
      role: "user",
      content: message
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: demoBots[sessionId]
    });

    const aiReply = completion.choices[0].message.content;

    demoBots[sessionId].push({
      role: "assistant",
      content: aiReply
    });

    res.json({ reply: aiReply });

  } catch {
    res.status(500).json({ reply: "Error en demo." });
  }
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});