// js/supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://kfbtgndqlecpgknxtreo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmYnRnbmRxbGVjcGdrbnh0cmVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3NTYzOTEsImV4cCI6MjA3NTMzMjM5MX0.AtOtnL-4jurWpuMuEbQCUcok6GVQ8QXzvNiTtOHNJeQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);