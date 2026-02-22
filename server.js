const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});