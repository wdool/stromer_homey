'use strict';

// Use built-in fetch (Node.js 18+) or dynamic import for node-fetch

class StromerAuthTester {
  constructor() {
    this.baseUrl = 'https://api3.stromer-portal.ch';
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  error(message) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
  }

  async testAuthentication(username, password, clientId, clientSecret = null) {
    this.log('='.repeat(60));
    this.log('STROMER API AUTHENTICATION TEST');
    this.log('='.repeat(60));
    this.log(`Username: ${username}`);
    this.log(`Client ID: ${clientId.substring(0, 10)}...`);
    this.log(`Password: ***${password.slice(-3)}`);
    this.log(`API Version: ${clientSecret ? 'v3' : 'v4'}`);
    this.log('');

    const apiVersion = clientSecret ? 'v3' : 'v4';
    const loginUrl = apiVersion === 'v4'
      ? `${this.baseUrl}/mobile/v4/login/`
      : `${this.baseUrl}/users/login/`;
    
    const tokenUrl = apiVersion === 'v4'
      ? `${this.baseUrl}/mobile/v4/o/token/`
      : `${this.baseUrl}/o/token/`;

    try {
      // STEP 1: Get login page for CSRF token
      this.log('STEP 1: Getting login page for CSRF token...');
      this.log(`  URL: ${loginUrl}`);
      
      const getResponse = await fetch(loginUrl, {
        method: 'GET',
        redirect: 'manual'
      });

      this.log(`  Status: ${getResponse.status} ${getResponse.statusText}`);

      const rawSetCookies = getResponse.headers.raw?.()['set-cookie'] ?? [];
      if (rawSetCookies.length === 0) {
        const singleCookie = getResponse.headers.get('set-cookie');
        if (singleCookie) {
          rawSetCookies.push(singleCookie);
        }
      }

      if (rawSetCookies.length === 0) {
        this.error('No Set-Cookie header received from login page');
        this.error('This could mean:');
        this.error('  - The Stromer API is down');
        this.error('  - Network/firewall issue');
        return { success: false, step: 1, error: 'No cookies received from login page' };
      }

      const cookieJar = {};
      for (const cookieHeader of rawSetCookies) {
        const match = cookieHeader.match(/^([^=]+)=([^;]+)/);
        if (match) {
          cookieJar[match[1]] = match[2];
        }
      }

      if (!cookieJar.csrftoken) {
        this.error('CSRF token not found in cookies');
        this.error(`Cookies received: ${Object.keys(cookieJar).join(', ') || 'none'}`);
        return { success: false, step: 1, error: 'CSRF token not in cookies' };
      }

      const csrftoken = cookieJar.csrftoken;
      this.log(`  CSRF Token: ${csrftoken.substring(0, 20)}...`);
      this.log(`  Cookies: ${Object.keys(cookieJar).join(', ')}`);
      this.log('  ✓ Step 1 successful');
      this.log('');

      // STEP 2: POST credentials with CSRF token
      this.log('STEP 2: Posting credentials...');
      
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

      this.log(`  Status: ${postResponse.status} ${postResponse.statusText}`);

      // Update cookies from POST response
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

      const nextLocation = postResponse.headers.get('location');
      if (!nextLocation) {
        const errorBody = await postResponse.text();
        this.error('No redirect after login - credentials may be wrong');
        
        // Look for specific error messages in the HTML
        const errorMatch = errorBody.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)/i);
        const alertMatch = errorBody.match(/class="[^"]*alert[^"]*"[^>]*>([^<]+)/i);
        const formErrorMatch = errorBody.match(/errorlist[^>]*>.*?<li>([^<]+)/is);
        
        if (errorMatch) {
          this.error(`Error message found: ${errorMatch[1].trim()}`);
        }
        if (alertMatch) {
          this.error(`Alert message found: ${alertMatch[1].trim()}`);
        }
        if (formErrorMatch) {
          this.error(`Form error found: ${formErrorMatch[1].trim()}`);
        }
        
        // Check for common error indicators
        if (errorBody.includes('incorrect') || errorBody.includes('Invalid') || errorBody.includes('invalid')) {
          this.error('>>> INVALID USERNAME OR PASSWORD <<<');
          return { success: false, step: 2, error: 'Invalid username or password' };
        }
        if (errorBody.includes('Please enter a correct')) {
          this.error('>>> INVALID CREDENTIALS - Stromer rejected login <<<');
          return { success: false, step: 2, error: 'Invalid username or password (Stromer message)' };
        }
        if (errorBody.includes('csrf') || errorBody.includes('CSRF')) {
          return { success: false, step: 2, error: 'CSRF validation failed' };
        }
        
        this.error(`Response body (first 1500 chars): ${errorBody.substring(0, 1500)}`);
        return { success: false, step: 2, error: 'No redirect after login. Check username/password.' };
      }

      this.log(`  Redirect to: ${nextLocation.substring(0, 80)}...`);
      this.log('  ✓ Step 2 successful - credentials accepted');
      this.log('');

      // STEP 3: Follow redirect to get authorization code
      this.log('STEP 3: Getting authorization code...');
      
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

      this.log(`  Status: ${authorizeResponse.status} ${authorizeResponse.statusText}`);

      const codeLocation = authorizeResponse.headers.get('location');
      if (!codeLocation) {
        this.error('No authorization code redirect received');
        return { success: false, step: 3, error: 'No authorization code redirect' };
      }

      const codeMatch = codeLocation.match(/[?&]code=([^&]+)/);
      if (!codeMatch) {
        this.error(`Authorization code not found in: ${codeLocation}`);
        return { success: false, step: 3, error: 'Authorization code not in redirect URL' };
      }
      
      const authCode = codeMatch[1];
      this.log(`  Auth Code: ${authCode.substring(0, 15)}...`);
      this.log('  ✓ Step 3 successful');
      this.log('');

      // STEP 4: Exchange code for token
      this.log('STEP 4: Exchanging code for access token...');
      
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

      this.log(`  Status: ${tokenResponse.status} ${tokenResponse.statusText}`);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        this.error(`Token exchange failed: ${errorText.substring(0, 300)}`);
        return { success: false, step: 4, error: `Token exchange failed (${tokenResponse.status})` };
      }

      const tokenData = await tokenResponse.json();
      this.log(`  Access Token: ${tokenData.access_token.substring(0, 20)}...`);
      this.log(`  Refresh Token: ${tokenData.refresh_token ? tokenData.refresh_token.substring(0, 20) + '...' : 'N/A'}`);
      this.log(`  Expires In: ${tokenData.expires_in} seconds`);
      this.log('  ✓ Step 4 successful');
      this.log('');

      // STEP 5: List bikes
      this.log('STEP 5: Fetching bike list...');
      
      const bikeApiVersion = clientSecret ? 'v2' : 'v4.1';
      const bikeEndpoint = `${this.baseUrl}/rapi/mobile/${bikeApiVersion}/bike/`;
      
      const bikeResponse = await fetch(bikeEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `${tokenData.token_type || 'Bearer'} ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      this.log(`  Status: ${bikeResponse.status} ${bikeResponse.statusText}`);

      if (!bikeResponse.ok) {
        const errorText = await bikeResponse.text();
        this.error(`Failed to fetch bikes: ${errorText.substring(0, 300)}`);
        return { success: true, step: 5, error: 'Auth successful but bike fetch failed', token: tokenData };
      }

      const bikeData = await bikeResponse.json();
      const bikes = bikeData.data || [];
      
      this.log(`  Found ${bikes.length} bike(s)`);
      this.log('');

      if (bikes.length === 0) {
        this.log('⚠️  NO BIKES FOUND ON THIS ACCOUNT');
        this.log('   The user needs to:');
        this.log('   1. Check if bike is linked in official Stromer app');
        this.log('   2. Verify they are using the correct account');
        return { success: true, step: 5, bikes: [], message: 'No bikes linked to account' };
      }

      this.log('BIKES FOUND:');
      this.log('-'.repeat(60));
      
      for (const bike of bikes) {
        this.log(`  Bike ID: ${bike.bikeid || bike.id}`);
        this.log(`  Name: ${bike.bikename || bike.name || 'N/A'}`);
        this.log(`  Nickname: ${bike.nickname || 'N/A'}`);
        this.log(`  Serial: ${bike.serial || 'N/A'}`);
        this.log(`  Model: ${bike.biketype || bike.type || 'N/A'}`);
        this.log('-'.repeat(60));
      }

      this.log('');
      this.log('='.repeat(60));
      this.log('✓ ALL TESTS PASSED - AUTHENTICATION WORKING');
      this.log('='.repeat(60));

      return { success: true, bikes: bikes, token: tokenData };

    } catch (error) {
      this.error(`Unexpected error: ${error.message}`);
      this.error(`Stack: ${error.stack}`);
      return { success: false, error: error.message };
    }
  }
}

// Main execution
async function main() {
  const username = process.env.STROMER_USERNAME;
  const password = process.env.STROMER_PASSWORD;
  const clientId = process.env.STROMER_CLIENT_ID;
  const clientSecret = process.env.STROMER_CLIENT_SECRET || null;

  if (!username || !password || !clientId) {
    console.error('');
    console.error('ERROR: Missing required environment variables!');
    console.error('');
    console.error('Please set the following secrets in Replit:');
    console.error('  STROMER_USERNAME  - User\'s Stromer email');
    console.error('  STROMER_PASSWORD  - User\'s Stromer password');
    console.error('  STROMER_CLIENT_ID - Client ID from MITM capture');
    console.error('  STROMER_CLIENT_SECRET - (Optional, only for v3 API)');
    console.error('');
    process.exit(1);
  }

  const tester = new StromerAuthTester();
  const result = await tester.testAuthentication(username, password, clientId, clientSecret);
  
  if (!result.success) {
    console.error('');
    console.error('DIAGNOSIS:');
    console.error(`  Failed at: Step ${result.step || 'unknown'}`);
    console.error(`  Error: ${result.error}`);
    console.error('');
    console.error('COMMON FIXES:');
    console.error('  1. Verify username/password work in Stromer mobile app');
    console.error('  2. Check if Client ID is correct (from MITM capture)');
    console.error('  3. Ensure account has bikes linked in Stromer app');
    process.exit(1);
  }
}

main().catch(console.error);
