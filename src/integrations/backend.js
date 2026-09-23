import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly"
].join(" ");

export function createRookBackend(config) {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) return null;
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey);
  let user = null;
  let providerToken = sessionStorage.getItem("rook.googleAccessToken");

  client.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    if (session?.provider_token) {
      providerToken = session.provider_token;
      sessionStorage.setItem("rook.googleAccessToken", providerToken);
    }
    if (!session) sessionStorage.removeItem("rook.googleAccessToken");
  });

  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    user = data.user;
    return user;
  }

  return {
    async connect() { return requireUser(); },
    async signInWithGoogle() {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href, scopes: GOOGLE_SCOPES }
      });
      if (error) throw error;
    },
    async signOut() { await client.auth.signOut(); },
    getGoogleAccessToken() { return providerToken; },
    async loadProperties() {
      const account = await requireUser();
      const { data, error } = await client.from("rook_properties").select("data").eq("user_id", account.id).order("updated_at", { ascending: false });
      if (error) throw error;
      return data.map(row => row.data);
    },
    async saveProperties(properties) {
      const account = await requireUser();
      const rows = properties.map(property => ({ user_id: account.id, id: property.id, data: property, updated_at: new Date().toISOString() }));
      if (!rows.length) return;
      const { error } = await client.from("rook_properties").upsert(rows, { onConflict: "user_id,id" });
      if (error) throw error;
    },
    async saveExternalEvents(events) {
      const account = await requireUser();
      if (!events.length) return;
      const { error } = await client.from("rook_external_events").upsert(events.map(event => ({ ...event, user_id: account.id })), { onConflict: "user_id,source,external_id" });
      if (error) throw error;
    }
  };
}
