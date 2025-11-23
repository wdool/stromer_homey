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
  }

  async authenticate(username, password, clientId, clientSecret = null) {
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

    this.log('[StromerAPI] Starting authentication with CSRF token flow');
    this.log(`  - API Version: ${apiVersion}`);
    this.log(`  - Username: ${username}`);
    this.log(`  - Client ID: ${clientId}`);
    this.log(`  - Password: ${password ? '***' + password.slice(-3) : 'NOT SET'}`);

    try {
      this.log('[StromerAPI] Step 1: GET login page to obtain CSRF token and session');
      const getResponse = await fetch(loginUrl, {
        method: 'GET',
        redirect: 'manual'
      });

      const rawSetCookies = getResponse.headers.raw?.()['set-cookie'] ?? [];
      if (rawSetCookies.length === 0) {
        const singleCookie = getResponse.headers.get('set-cookie');
        if (singleCookie) {
          rawSetCookies.push(singleCookie);
        }
      }
      
      if (rawSetCookies.length === 0) {
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
        throw new Error('CSRF token not found in Set-Cookie header');
      }
      const csrftoken = cookieJar.csrftoken;
      this.log(`[StromerAPI] Cookies extracted: ${Object.keys(cookieJar).join(', ')}`);

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

      this.log('[StromerAPI] Step 2: POST credentials with CSRF token and session');
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
        this.log(`[StromerAPI] Updated cookies: ${Object.keys(cookieJar).join(', ')}`);
      }

      const nextLocation = postResponse.headers.get('location');
      if (!nextLocation) {
        const errorBody = await postResponse.text();
        this.error('[StromerAPI] No redirect after login. Response:', errorBody.substring(0, 500));
        throw new Error('Authentication failed: No redirect location received. Check username/password.');
      }

      this.log(`[StromerAPI] Step 3: Follow redirect to authorization endpoint`);
      const authorizeUrl = nextLocation.startsWith('http') 
        ? nextLocation 
        : `${this.baseUrl}${nextLocation}`;

      const updatedCookieString = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');

      const authorizeResponse = await fetch(authorizeUrl, {
        method: 'GET',
        headers: {
          'Cookie': updatedCookieString
        },
        redirect: 'manual'
      });

      const codeLocation = authorizeResponse.headers.get('location');
      if (!codeLocation) {
        throw new Error('No authorization code redirect received');
      }

      const codeMatch = codeLocation.match(/[?&]code=([^&]+)/);
      if (!codeMatch) {
        throw new Error('Authorization code not found in redirect URL');
      }
      const authCode = codeMatch[1];
      this.log(`[StromerAPI] Authorization code obtained: ${authCode.substring(0, 8)}...`);

      this.log('[StromerAPI] Step 4: Exchange authorization code for access token');
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

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        this.error('[StromerAPI] Token exchange failed:', errorText);
        throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorText.substring(0, 200)}`);
      }

      const tokenData = await tokenResponse.json();
      this.log('[StromerAPI] Access token received successfully');
      
      this.tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in || 3600,
        expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000)
      };

      this.log('[StromerAPI] Authentication successful');
      return this.tokens;
    } catch (error) {
      this.error('[StromerAPI] Authentication failed:', error.message);
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
