const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL dan SUPABASE_ANON_KEY harus diatur di file .env");
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

// Client tanpa sesi bersama untuk health check / operasi publik.
const supabase = createClient(supabaseUrl, supabaseKey, clientOptions);

// Client baru per request. Jika token disediakan, query database dan Storage
// berjalan dengan konteks pengguna sehingga RLS Supabase dapat membatasi akses.
function createAuthClient(accessToken = "") {
  const options = { ...clientOptions };
  if (accessToken) {
    options.global = { headers: { Authorization: `Bearer ${accessToken}` } };
  }
  return createClient(supabaseUrl, supabaseKey, options);
}

module.exports = { supabase, createAuthClient };
