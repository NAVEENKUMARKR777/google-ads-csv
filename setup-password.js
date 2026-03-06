#!/usr/bin/env node

/**
 * Setup script to hash a password and prepare it for insertion into Supabase
 * Run this script with: node setup-password.js
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Get password from command line argument or prompt
const password = process.argv[2] || process.env.SETUP_PASSWORD;

if (!password) {
  console.log('Usage: node setup-password.js <password>');
  console.log('Or set SETUP_PASSWORD environment variable');
  process.exit(1);
}

async function hashPassword() {
  try {
    // Generate a strong salt
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    console.log('\n=== PASSWORD SETUP ===\n');
    console.log('Plain password:', password);
    console.log('Hashed password:', passwordHash);
    console.log('\n=== SQL FOR SUPABASE ===\n');
    console.log('-- First, create the auth table in Supabase SQL Editor:');
    console.log('CREATE TABLE auth (');
    console.log('  id INTEGER PRIMARY KEY DEFAULT 1,');
    console.log('  password_hash TEXT NOT NULL');
    console.log(');');
    console.log('\n-- Then insert the hashed password:');
    console.log(`INSERT INTO auth (id, password_hash) VALUES (1, '${passwordHash}');`);
    console.log('\n=== ENVIRONMENT VARIABLES ===\n');
    console.log('Add these to your Netlify site environment variables:');
    console.log('SUPABASE_URL=https://your-project-id.supabase.co');
    console.log('SUPABASE_KEY=your-supabase-anon-key');
    console.log('JWT_SECRET=' + crypto.randomBytes(64).toString('hex'));
    console.log('\n=== SETUP COMPLETE ===\n');
    console.log('1. Create the auth table in Supabase SQL Editor');
    console.log('2. Insert the hashed password using the SQL above');
    console.log('3. Set environment variables in Netlify dashboard');
    console.log('4. Deploy your site');
    
  } catch (error) {
    console.error('Error hashing password:', error);
    process.exit(1);
  }
}

hashPassword();
