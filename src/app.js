const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const { supabase } = require("./config/supabase");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'"],
      },
    },
  })
);
const allowedOrigin = process.env.APP_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin.split(',').map((value) => value.trim()).filter(Boolean) } : { origin: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/documents", require("./routes/documents"));
app.use("/api/officer", require("./routes/officer"));
app.use("/api/citizen", require("./routes/citizen-recovery"));
app.use(express.static(path.join(__dirname, "../public")));


// =========================================
// LOCAL API HEALTH CHECK
// =========================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Docura API is running.",
    timestamp: new Date().toISOString(),
  });
});


// =========================================
// SUPABASE CONNECTION CHECK
// =========================================

app.get("/api/health/supabase", async (req, res) => {
  try {
    const { error } = await supabase
      .from("citizens")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Supabase error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });

      return res.status(503).json({
        success: false,
        message: "Supabase query failed.",
        errorCode: error.code || null,
      });
    }

    return res.json({
      success: true,
      message: "Supabase connection successful.",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Supabase request error:", error.message);

    return res.status(503).json({
      success: false,
      message: "Unable to complete Supabase request.",
    });
  }
});


module.exports = app;