const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Supabase configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { password } = JSON.parse(event.body);

    if (!password) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Password is required' })
      };
    }

    // Fetch stored password hash from Supabase
    const authResponse = await fetch(`${SUPABASE_URL}/rest/v1/auth?id=eq.1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!authResponse.ok) {
      throw new Error('Failed to fetch auth data');
    }

    const authData = await authResponse.json();
    
    if (!authData || authData.length === 0) {
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Authentication system not configured' })
      };
    }

    const storedHash = authData[0].password_hash;
    
    // Verify password
    const isValid = await bcrypt.compare(password, storedHash);
    
    if (!isValid) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Invalid password' })
      };
    }

    // Generate JWT token
    const token = jwt.sign(
      { authenticated: true, timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: true, 
        token: token,
        message: 'Authentication successful'
      })
    };

  } catch (error) {
    console.error('Auth error details:', error);
    console.error('Error stack:', error.stack);
    console.error('Environment variables:', {
      SUPABASE_URL: SUPABASE_URL ? 'Set' : 'Missing',
      SUPABASE_KEY: SUPABASE_KEY ? 'Set' : 'Missing',
      JWT_SECRET: JWT_SECRET ? 'Set' : 'Missing'
    });
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
