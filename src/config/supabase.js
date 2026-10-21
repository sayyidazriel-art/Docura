const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function createServiceClient() {
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY wajib dikonfigurasi di environment server untuk operasi WebAuthn. Jangan pernah mengirimnya ke browser.');
  return createClient(supabaseUrl, serviceRoleKey, clientOptions);
}

module.exports = { supabase, createAuthClient, createServiceClient };
