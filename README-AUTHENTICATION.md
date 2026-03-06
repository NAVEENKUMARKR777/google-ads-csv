# Google Ads CSV Viewer - Secure Authentication Setup

This document explains how to set up secure password-based authentication for your Google Ads CSV Viewer deployed on Netlify.

## 🔒 Security Problem Solved

**Before**: Supabase credentials were exposed in `dashboard.js`, making your database accessible to anyone.

**After**: Credentials are secured in server-side Netlify Functions with password-protected access.

## 🚀 Quick Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Password Hash
```bash
node setup-password.js "your-secure-password"
```

This will output:
- SQL commands to create the auth table
- Hashed password to insert
- Environment variables to configure

### 3. Set Up Supabase
1. Go to your Supabase project SQL Editor
2. Run the SQL commands from step 2 to create the `auth` table
3. Insert the hashed password using the provided INSERT statement

### 4. Configure Netlify Environment Variables
In your Netlify dashboard → Site settings → Environment variables, add:

```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-anon-key
JWT_SECRET=your-generated-jwt-secret
```

### 5. Deploy
```bash
netlify deploy --prod
```

## 🔧 How It Works

### Authentication Flow
1. User visits `/` → redirected to `/login` if not authenticated
2. User enters password → sent to Netlify Function (not directly to Supabase)
3. Function validates password against stored hash in Supabase
4. If valid, function returns JWT token stored in sessionStorage
5. Dashboard makes API calls through secure proxy function

### Security Features
- ✅ **No exposed credentials**: Supabase keys only exist in server-side functions
- ✅ **JWT tokens**: Secure session management with expiration
- ✅ **Password hashing**: bcrypt with 12 salt rounds
- ✅ **Token validation**: Every API call verifies the token
- ✅ **Automatic redirect**: Expired tokens redirect to login

## 📁 File Structure

```
├── netlify/
│   └── functions/
│       ├── auth.js              # Password validation endpoint
│       └── supabase-proxy.js    # Secure Supabase proxy
├── login.html                   # Login page
├── login.js                     # Login functionality
├── dashboard.js                 # Updated with secure API calls
├── netlify.toml                 # Netlify configuration
├── package.json                 # Function dependencies
├── setup-password.js            # Password setup utility
└── .env.example                 # Environment variable template
```

## 🔒 Security Best Practices Implemented

1. **Environment Variables**: All secrets stored securely
2. **JWT Expiration**: Tokens expire after 24 hours
3. **HTTPS Only**: All communications encrypted
4. **Input Validation**: All inputs sanitized
5. **Error Handling**: No sensitive information leaked
6. **CORS Headers**: Proper cross-origin security

## 🚨 Important Security Notes

- **Change the default password** before deploying
- **Use a strong JWT secret** (the setup script generates one)
- **Keep your Supabase keys private**
- **Regularly rotate your secrets**
- **Monitor access logs** in Netlify dashboard

## 🔄 Testing Locally

To test the authentication locally:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-key"
export JWT_SECRET="test-secret"

# Run local development server
netlify dev
```

Visit `http://localhost:8888` to test the authentication flow.

## 🛠️ Troubleshooting

### "Authentication system not configured"
- Ensure the `auth` table exists in Supabase
- Check that environment variables are set correctly

### "Invalid password"
- Verify the password hash was inserted correctly
- Make sure you're using the correct password

### "Invalid or expired token"
- Clear browser sessionStorage
- Token expires after 24 hours, login again

### "Internal server error"
- Check Netlify function logs
- Verify all environment variables are set
- Ensure dependencies are installed

## 📞 Support

If you encounter issues:
1. Check Netlify function logs
2. Verify Supabase table setup
3. Confirm environment variables
4. Test with the setup script output

---

**Your Google Ads CSV Viewer is now secure!** 🔐
