'use strict';

const fetch = require('node-fetch');

class StromerAPI {
  constructor(log) {
    this.log = log || console.log;
    this.error = log ? log.bind(null, '[ERROR]') : console.error;
    
    this.baseUrl = 'https://api3.stromer-portal.ch';
    this.tokens = null;
    this.clientId = null;
    this.clientSecret = null;
    this.username = null;
    this.password = null;
    this.lastDebugLog = [];
  }

  debugLog(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;
    this.lastDebugLog.push(logLine);
    this.log(message);
  }

  getDebugLog() {
    return this.lastDebugLog.join('\n');
  }

  clearDebugLog() {
    this.lastDebugLog = [];
  }

  async authenticate(username, password, clientId, clientSecret = null) {
    this.clearDebugLog();
    this.username = username;
    this.password = password;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    
    const apiVersion = clientSecret ? 'v3' : 'v4';
    const loginUrl = apiVersion === 'v4'
      ? `${this.baseUrl}/mobile/v4/login/`
      : `${this.baseUrl}/users/login/`;
    
    const tokenUrl = apiVersion === 'v4'
      ? `${this.baseUrl}/mobile/v4/o/token/`
      : `${this.baseUrl}/o/token/`;

    this.debugLog('=== STROMER AUTHENTICATION DEBUG LOG ===');
    this.debugLog(`API Version: ${apiVersion}`);
    this.debugLog(`Username: ${username}`);
    this.debugLog(`Client ID: ${clientId}`);
    this.debugLog(`Password: ${password ? '***' + password.slice(-3) : 'NOT SET'}');
    this.debugLog(`Login URL: ${loginUrl}`);
    this.debugLog('');

    try {
      this.debugLog('STEP 1: GET login page to obtain CSRF token');
      this.debugLog(`  Request: GET ${loginUrl}`);
      const getResponse = await fetch(loginUrl, {
        method: 'GET',
        redirect: 'manual'
      });
      this.debugLog(`  Response Status: ${getResponse.status} ${getResponse.statusText}`);

      const rawSetCookies = getResponse.headers.raw?.()['set-cookie'] ?? [];
      if (rawSetCookies.length === 0) {
        const singleCookie = getResponse.headers.get('set-cookie');
        if (singleCookie) {
          rawSetCookies.push(singleCookie);
        }
      }
      
      if (rawSetCookies.length === 0) {
        this.debugLog('  ERROR: No Set-Cookie header received');
        throw new Error('No Set-Cookie header received from login page');
      }

      const cookieJar = {};
      for (const cookieHeader of rawSetCookies) {
        const match = cookieHeader.match(/^([^=]+)=([^;]+)/);
        if (match) {
          cookieJar[match[1]] = match[2];
        }
      }

      if (!cookieJar.csrftoken) {
        this.debugLog('  ERROR: CSRF token not in cookies');
        this.debugLog(`  Cookies received: ${Object.keys(cookieJar).join(', ') || 'none'}`);
        throw new Error('CSRF token not found in Set-Cookie header');
      }
      const csrftoken = cookieJar.csrftoken;
      this.debugLog(`  CSRF Token: ${csrftoken.substring(0, 20)}...`);
      this.debugLog(`  Cookies: ${Object.keys(cookieJar).join(', ')}`);
      this.debugLog('  Step 1: SUCCESS');
      this.debugLog('');

      const oauthParams = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'bikeposition bikestatus bikeconfiguration bikelock biketheft bikedata bikepin bikeblink userprofile'
      });

      if (apiVersion === 'v4') {
        oauthParams.append('redirect_url', 'stromerauth://auth');
      } else {
        oauthParams.append('redirect_uri', 'stromerauth://auth');
      }

      const nextUrl = apiVersion === 'v4'
        ? `/mobile/v4/o/authorize/?${oauthParams.toString()}`
        : `/o/authorize/?${oauthParams.toString()}`;

      const formData = new URLSearchParams({
        username: username,
        password: password,
        csrfmiddlewaretoken: csrftoken,
        next: nextUrl
      });

      const cookieString = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');

      this.debugLog('STEP 2: POST credentials with CSRF token');
      this.debugLog(`  Request: POST ${loginUrl}`);
      const postResponse = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': loginUrl,
          'Cookie': cookieString
        },
        body: formData.toString(),
        redirect: 'manual'
      });
      this.debugLog(`  Response Status: ${postResponse.status} ${postResponse.statusText}`);

      const rawPostCookies = postResponse.headers.raw?.()['set-cookie'] ?? [];
      if (rawPostCookies.length === 0) {
        const singleCookie = postResponse.headers.get('set-cookie');
        if (singleCookie) {
          rawPostCookies.push(singleCookie);
        }
      }
      
      for (const cookieHeader of rawPostCookies) {
        const match = cookieHeader.match(/^([^=]+)=([^;]+)/);
        if (match) {
          cookieJar[match[1]] = match[2];
        }
      }
      
      if (rawPostCookies.length > 0) {
        this.debugLog(`  Updated cookies: ${Object.keys(cookieJar).join(', ')}`);
      }

      const nextLocation = postResponse.headers.get('location');
      if (!nextLocation) {
        const errorBody = await postResponse.text();
        this.debugLog('  ERROR: No redirect after login');
        this.debugLog(`  Response body (first 2000 chars):`);
        this.debugLog(errorBody.substring(0, 2000));
        
        let errorMessage = 'Authentication failed';
        
        if (errorBody.includes('Please enter a correct')) {
          errorMessage = 'Invalid username or password. Please check your Stromer credentials.';
          this.debugLog('  >>> STROMER REJECTED CREDENTIALS <<<');
        } else if (errorBody.includes('invalid') || errorBody.includes('Invalid') || errorBody.includes('incorrect')) {
          errorMessage = 'Invalid credentials. Please verify your email and password work in the Stromer app.';
        } else if (errorBody.includes('CSRF') || errorBody.includes('csrf')) {
          errorMessage = 'Session validation failed. Please try again.';
        } else if (errorBody.includes('locked') || errorBody.includes('disabled')) {
          errorMessage = 'Account may be locked or disabled. Please contact Stromer support.';
        } else {
          errorMessage = 'Login failed. Please verify your credentials work in the official Stromer app.';
        }
        
        this.debugLog('');
        this.debugLog(`FINAL ERROR: ${errorMessage}`);
        this.debugLog('=== END OF DEBUG LOG ===');
        
        const debugError = new Error(errorMessage);
        debugError.debugLog = this.getDebugLog();
        throw debugError;
      }

      this.debugLog(`  Redirect Location: ${nextLocation.substring(0, 80)}...`);
      this.debugLog('  Step 2: SUCCESS');
      this.debugLog('');

      this.debugLog('STEP 3: Follow redirect to get authorization code');
      const authorizeUrl = nextLocation.startsWith('http') 
        ? nextLocation 
        : `${this.baseUrl}${nextLocation}`;
      this.debugLog(`  Request: GET ${authorizeUrl.substring(0, 80)}...`);

      const updatedCookieString = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');

      const authorizeResponse = await fetch(authorizeUrl, {
        method: 'GET',
        headers: {
          'Cookie': updatedCookieString
        },
        redirect: 'manual'
      });
      this.debugLog(`  Response Status: ${authorizeResponse.status} ${authorizeResponse.statusText}`);

      const codeLocation = authorizeResponse.headers.get('location');
      if (!codeLocation) {
        this.debugLog('  ERROR: No authorization code redirect');
        this.debugLog('=== END OF DEBUG LOG ===');
        const debugError = new Error('No authorization code redirect received');
        debugError.debugLog = this.getDebugLog();
        throw debugError;
      }

      const codeMatch = codeLocation.match(/[?&]code=([^&]+)/);
      if (!codeMatch) {
        this.debugLog(`  ERROR: Auth code not in redirect: ${codeLocation}`);
        this.debugLog('=== END OF DEBUG LOG ===');
        const debugError = new Error('Authorization code not found in redirect URL');
        debugError.debugLog = this.getDebugLog();
        throw debugError;
      }
      const authCode = codeMatch[1];
      this.debugLog(`  Authorization Code: ${authCode.substring(0, 15)}...`);
      this.debugLog('  Step 3: SUCCESS');
      this.debugLog('');

      this.debugLog('STEP 4: Exchange code for access token');
      this.debugLog(`  Request: POST ${tokenUrl}`);
      const tokenFormData = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: authCode,
        redirect_uri: apiVersion === 'v4' ? 'stromer://auth' : 'stromerauth://auth'
      });

      if (clientSecret) {
        tokenFormData.append('client_secret', clientSecret);
      }

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenFormData.toString()
      });
      this.debugLog(`  Response Status: ${tokenResponse.status} ${tokenResponse.statusText}`);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        this.debugLog(`  ERROR: Token exchange failed`);
        this.debugLog(`  Response: ${errorText}`);
        this.debugLog('=== END OF DEBUG LOG ===');
        const debugError = new Error(`Token exchange failed (${tokenResponse.status}): ${errorText.substring(0, 200)}`);
        debugError.debugLog = this.getDebugLog();
        throw debugError;
      }

      const tokenData = await tokenResponse.json();
      this.debugLog(`  Access Token: ${tokenData.access_token.substring(0, 20)}...`);
      this.debugLog(`  Expires In: ${tokenData.expires_in} seconds`);
      this.debugLog('  Step 4: SUCCESS');
      this.debugLog('');
      this.debugLog('=== AUTHENTICATION COMPLETE ===');
      
      this.tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in || 3600,
        expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000)
      };

      return this.tokens;
    } catch (error) {
      if (!error.debugLog) {
        this.debugLog(`UNEXPECTED ERROR: ${error.message}`);
        this.debugLog('=== END OF DEBUG LOG ===');
        error.debugLog = this.getDebugLog();
      }
      throw error;
    }
  }

  async refreshToken() {
    if (!this.tokens || !this.tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    const apiVersion = this.clientSecret ? 'v3' : 'v4';
    const tokenUrl = apiVersion === 'v4'
      ? `${this.baseUrl}/mobile/v4/o/token/`
      : `${this.baseUrl}/o/token/`;

    try {
      const tokenFormData = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token,
        client_id: this.clientId
      });

      if (this.clientSecret) {
        tokenFormData.append('client_secret', this.clientSecret);
      }

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenFormData.toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch (e) {
          error = { error: errorText };
        }
        throw new Error(error.error_description || error.error || 'Token refresh failed');
      }

      const tokenData = await tokenResponse.json();
      
      this.tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || this.tokens.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in || 3600,
        expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000)
      };

      this.log('[StromerAPI] Token refreshed successfully');
      return this.tokens;
    } catch (error) {
      this.error('[StromerAPI] Token refresh failed:', error.message);
      throw error;
    }
  }

  async ensureValidToken() {
    if (!this.tokens) {
      throw new Error('Not authenticated');
    }

    const expiryBuffer = 5 * 60 * 1000;
    if (this.tokens.expires_at - Date.now() < expiryBuffer) {
      await this.refreshToken();
    }
  }

  async apiCall(endpoint, method = 'GET', body = null) {
    await this.ensureValidToken();

    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `${this.tokens.token_type} ${this.tokens.access_token}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (response.status === 401) {
        this.log('[StromerAPI] Token expired, refreshing...');
        await this.refreshToken();
        options.headers['Authorization'] = `${this.tokens.token_type} ${this.tokens.access_token}`;
        const retryResponse = await fetch(url, options);
        
        if (!retryResponse.ok) {
          throw new Error(`API call failed with status ${retryResponse.status}`);
        }
        
        return await retryResponse.json();
      }

      if (!response.ok) {
        throw new Error(`API call failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.error(`[StromerAPI] API call to ${endpoint} failed:`, error.message);
      throw error;
    }
  }

  async getBikes() {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const endpoint = `/rapi/mobile/${apiVersion}/bike/`;
    const response = await this.apiCall(endpoint);
    
    if (response && response.data && Array.isArray(response.data)) {
      return response.data;
    }
    
    this.error('[StromerAPI] Unexpected bike list response format:', response);
    return [];
  }

  async getBikeState(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const response = await this.apiCall(`/rapi/mobile/${apiVersion}/bike/${bikeId}/state/`);
    return response?.data?.[0] || response;
  }

  async getBikePosition(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const response = await this.apiCall(`/rapi/mobile/${apiVersion}/bike/${bikeId}/position/`);
    return response?.data?.[0] || response;
  }

  async getBikeDetails(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const response = await this.apiCall(`/rapi/mobile/${apiVersion}/bike/${bikeId}/`);
    return response?.data?.[0] || response;
  }

  async setBikeLock(bikeId, lock) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    return await this.apiCall(
      `/rapi/mobile/${apiVersion}/bike/${bikeId}/settings/`,
      'POST',
      { lock: lock }
    );
  }

  async setBikeLight(bikeId, mode) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    return await this.apiCall(
      `/rapi/mobile/${apiVersion}/bike/${bikeId}/light/`,
      'POST',
      { mode: mode }
    );
  }

  async resetTripData(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const url = `${this.baseUrl}/rapi/mobile/${apiVersion}/bike/id/${bikeId}/trip_data/`;
    
    await this.ensureValidToken();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const options = {
      method: 'DELETE',
      headers: {
        'Authorization': `${this.tokens.token_type} ${this.tokens.access_token}`,
      },
      signal: controller.signal,
    };

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);
      
      if (response.status === 401) {
        this.log('[StromerAPI] Token expired, refreshing...');
        await this.refreshToken();
        options.headers['Authorization'] = `${this.tokens.token_type} ${this.tokens.access_token}`;
        
        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
        options.signal = retryController.signal;
        
        const retryResponse = await fetch(url, options);
        clearTimeout(retryTimeoutId);
        
        if (!retryResponse.ok && retryResponse.status !== 204) {
          throw new Error(`Trip reset failed with status ${retryResponse.status}`);
        }
        return;
      }

      if (!response.ok && response.status !== 204) {
        throw new Error(`Trip reset failed with status ${response.status}`);
      }
      
      this.log('[StromerAPI] Trip data reset successfully');
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        this.error(`[StromerAPI] Trip reset timed out after 30 seconds`);
        throw new Error('Trip reset request timed out. The bike may be offline or the API is slow. Please try again.');
      }
      this.error(`[StromerAPI] Trip reset failed:`, error.message);
      throw error;
    }
  }

  async getYearStatistics(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const currentYear = new Date().getFullYear();
    try {
      const response = await this.apiCall(
        `/rapi/mobile/${apiVersion}/bike/${bikeId}/statistics/${currentYear}/1/`
      );
      return response?.data?.[0] || response;
    } catch (error) {
      this.error(`[StromerAPI] Failed to get year statistics:`, error.message);
      return null;
    }
  }

  async getMonthStatistics(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    try {
      const response = await this.apiCall(
        `/rapi/mobile/${apiVersion}/bike/${bikeId}/statistics/${year}/${month}/1/`
      );
      return response?.data?.[0] || response;
    } catch (error) {
      this.error(`[StromerAPI] Failed to get month statistics:`, error.message);
      return null;
    }
  }

  async getDayStatistics(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    try {
      const response = await this.apiCall(
        `/rapi/mobile/${apiVersion}/bike/${bikeId}/statistics/${year}/${month}/${day}/1/`
      );
      return response?.data?.[0] || response;
    } catch (error) {
      this.error(`[StromerAPI] Failed to get day statistics:`, error.message);
      return null;
    }
  }

  async getBikeDetails(bikeId) {
    const apiVersion = this.clientSecret ? 'v2' : 'v4.1';
    try {
      const response = await this.apiCall(`/rapi/mobile/${apiVersion}/bike/${bikeId}/`);
      return response?.data?.[0] || response;
    } catch (error) {
      this.error(`[StromerAPI] Failed to get bike details:`, error.message);
      return null;
    }
  }

  setTokens(tokens) {
    this.tokens = tokens;
  }

  setCredentials(username, password, clientId, clientSecret = null) {
    this.username = username;
    this.password = password;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  getTokens() {
    return this.tokens;
  }
}

module.exports = StromerAPI;
