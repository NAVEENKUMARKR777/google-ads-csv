const jwt = require('jsonwebtoken');

// Supabase configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

exports.handler = async (event, context) => {
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Extract token from Authorization header
  const authHeader = event.headers.authorization || event.headers.Authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authorization token required' })
    };
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Invalid or expired token' })
    };
  }

  try {
    // Extract table name from the path
    // The path will be something like "/.netlify/functions/supabase-proxy/ad_metrics"
    const pathParts = event.path.split('/');
    const table = pathParts[pathParts.length - 1];
    
    if (!table || table === 'supabase-proxy') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Table name is required in URL path' })
      };
    }

    // Build the Supabase URL
    let supabaseUrl = `${SUPABASE_URL}/rest/v1/${table}`;
    
    // Add query parameters if they exist
    if (event.queryStringParameters) {
      const params = new URLSearchParams();
      Object.entries(event.queryStringParameters).forEach(([key, value]) => {
        params.append(key, value);
      });
      supabaseUrl += `?${params.toString()}`;
    }

    // Make the request to Supabase
    const requestOptions = {
      method: event.httpMethod,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    // Only add body for POST, PUT, PATCH requests
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD' && event.body) {
      requestOptions.body = event.body;
    }
    
    const supabaseResponse = await fetch(supabaseUrl, requestOptions);

    const responseText = await supabaseResponse.text();
    
    return {
      statusCode: supabaseResponse.status,
      headers: {
        ...headers,
        'Content-Type': supabaseResponse.headers.get('content-type') || 'application/json'
      },
      body: responseText
    };

  } catch (error) {
    console.error('Proxy error details:', error);
    console.error('Error stack:', error.stack);
    console.error('Environment variables:', {
      SUPABASE_URL: SUPABASE_URL ? 'Set' : 'Missing',
      SUPABASE_KEY: SUPABASE_KEY ? 'Set' : 'Missing',
      JWT_SECRET: JWT_SECRET ? 'Set' : 'Missing'
    });
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
