document.addEventListener('DOMContentLoaded', function() {
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const errorMessage = document.getElementById('errorMessage');
  const loading = document.querySelector('.loading');

  // Check if already authenticated
  const token = sessionStorage.getItem('authToken');
  if (token) {
    // Verify token is still valid by making a test request
    verifyTokenAndRedirect(token);
  }

  loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const password = passwordInput.value.trim();
    
    if (!password) {
      showError('Please enter a password');
      return;
    }

    setLoading(true);
    hideError();

    try {
      const response = await fetch('/.netlify/functions/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Store token in sessionStorage
        sessionStorage.setItem('authToken', data.token);
        
        // Redirect to dashboard
        window.location.href = '/';
      } else {
        showError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      showError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loading.style.display = isLoading ? 'inline' : 'none';
    loginBtn.textContent = isLoading ? 'Logging in...' : 'Login';
    if (isLoading) {
      loginBtn.appendChild(loading);
      loading.style.display = 'inline';
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
  }

  function hideError() {
    errorMessage.style.display = 'none';
  }

  async function verifyTokenAndRedirect(token) {
    try {
      const response = await fetch('/.netlify/functions/supabase-proxy/auth?id=eq.1', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        // Token is valid, redirect to dashboard
        window.location.href = '/';
      } else {
        // Token is invalid, remove it and continue with login
        sessionStorage.removeItem('authToken');
      }
    } catch (error) {
      // Error verifying token, remove it and continue with login
      sessionStorage.removeItem('authToken');
    }
  }

  // Focus on password input
  passwordInput.focus();
});
