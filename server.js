const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para leer JSON
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Conexión Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Endpoint para crear bot
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

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});