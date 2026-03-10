import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseInstance = null;

export function getSupabase() {
    if (!supabaseInstance && supabaseUrl && supabaseUrl !== 'YOUR_SUPABASE_URL') {
        try {
            supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
        } catch (e) {
            console.error('Supabase init error:', e);
        }
    }
    return supabaseInstance;
}
