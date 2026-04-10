-- Unified Database Schema for Betting Bread (Supabase Compatible)

-- 1. Profiles Table (Synchronized with Discord Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  avatar TEXT,
  email TEXT,
  trial_used BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Memberships Table
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT UNIQUE NOT NULL REFERENCES profiles(discord_id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('free_trial', 'weekly', 'pro_monthly', 'lifetime')),
  status TEXT NOT NULL DEFAULT 'active', -- active, cancelled, expired
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  expiry_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Transactions Table (Payment History)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES profiles(discord_id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE NOT NULL,
  amount_total INTEGER NOT NULL, -- in cents
  currency TEXT NOT NULL DEFAULT 'usd',
  tier TEXT NOT NULL,
  status TEXT NOT NULL, -- complete, pending, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Discord Token Store (Optional/Future for Bot sessions)
CREATE TABLE IF NOT EXISTS discord_auth (
  discord_id TEXT PRIMARY KEY REFERENCES profiles(discord_id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 5. Sessions Table (for Express connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
) WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_auth ENABLE ROW LEVEL SECURITY;

-- 7. Audit Logs Table (Append-Only Event Tracking)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES profiles(discord_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('signup', 'login', 'logout', 'free_trial', 'purchase', 'expiration', 'revoked', 'admin_action', 'role_grant', 'role_revoke')),
  tier TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);


ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies (Assuming auth.uid() check if using Supabase Auth, otherwise manual enforcement in Express)
-- For this Express-centric approach, the server role will bypass RLS.
