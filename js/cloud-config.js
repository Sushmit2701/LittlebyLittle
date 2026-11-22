// Sync uses the same Supabase project as Bibliophile, so one account works for both apps.
// The publishable key is meant to be public: row-level security means each signed-in person
// can only read or change their own rows. Leave both empty to switch sync off entirely.
export const CLOUD = {
  url: 'https://tghjhzjelcdtrxckpodl.supabase.co',
  anonKey: 'sb_publishable_ZYPmsHZKv5qvhpqh03bGXQ_y-Rlmceq',
};
