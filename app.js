'use strict';

const Homey = require('homey');
const StromerAPI = require('./lib/StromerAPI');

class StromerApp extends Homey.App {
  async onInit() {
    this.log('Stromer app has been initialized');

    this.authService = new StromerAuthService(this);
    await this.authService.initialize();

    this.registerFlowCards();
    this.registerSettingsListeners();

    this.log('Flow cards registered');
  }

  registerFlowCards() {
    this.homey.flow.getDeviceTriggerCard('battery_low')
      .registerRunListener(async (args, state) => {
        return args.threshold >= state.threshold;
      });

    this.homey.flow.getDeviceTriggerCard('battery_health_low')
      .registerRunListener(async (args, state) => {
        return args.threshold >= state.threshold;
      });

    this.homey.flow.getDeviceTriggerCard('trip_distance_exceeds')
      .registerRunListener(async (args, state) => {
        return state.distance >= args.distance;
      });

    this.homey.flow.getDeviceTriggerCard('trip_speed_exceeds')
      .registerRunListener(async (args, state) => {
        return state.speed >= args.speed;
      });

    this.homey.flow.getActionCard('reset_trip_distance')
      .registerRunListener(async (args) => {
        return args.device.resetTripDistance();
      });

    this.homey.flow.getActionCard('toggle_light')
      .registerRunListener(async (args) => {
        return args.device.setLight(args.light_mode);
      });

    this.homey.flow.getActionCard('lock_bike')
      .registerRunListener(async (args) => {
        return args.device.setLock(true);
      });

    this.homey.flow.getActionCard('unlock_bike')
      .registerRunListener(async (args) => {
        return args.device.setLock(false);
      });

    this.homey.flow.getActionCard('send_bike_notification')
      .registerRunListener(async (args) => {
        const device = args.device;
        const battery = device.getCapabilityValue('measure_battery') || 0;
        const tripDistance = device.getCapabilityValue('stromer_trip_distance') || 0;
        const message = `${device.getName()}: Battery ${battery}%, Trip ${tripDistance}km`;
        await this.homey.notifications.createNotification({
          excerpt: message
        });
        return true;
      });

    this.homey.flow.getConditionCard('battery_above')
      .registerRunListener(async (args) => {
        const battery = args.device.getCapabilityValue('measure_battery');
        return battery > args.threshold;
      });

    this.homey.flow.getConditionCard('battery_health_above')
      .registerRunListener(async (args) => {
        const health = args.device.getCapabilityValue('stromer_battery_health');
        return health > args.threshold;
      });

    this.homey.flow.getConditionCard('is_locked')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('locked');
      });

    this.homey.flow.getConditionCard('light_on')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('onoff');
      });

    this.homey.flow.getConditionCard('theft_active')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('alarm_theft');
      });

    this.homey.flow.getConditionCard('temp_in_range')
      .registerRunListener(async (args) => {
        const temp = args.sensor === 'motor' 
          ? args.device.getCapabilityValue('stromer_motor_temp_c')
          : args.device.getCapabilityValue('stromer_battery_temp_c');
        return temp >= args.min && temp <= args.max;
      });
  }

  registerSettingsListeners() {
    let settingsTimeout = null;

    this.homey.settings.on('set', async (key) => {
      if (key === 'stromer_email' || key === 'stromer_password' || key === 'stromer_client_id') {
        if (settingsTimeout) {
          this.homey.clearTimeout(settingsTimeout);
        }

        settingsTimeout = this.homey.setTimeout(async () => {
          const password = this.homey.settings.get('stromer_password');
          
          if (password === '') {
            this.homey.settings.unset('stromer_password');
            this.log('Password explicitly cleared by user');
            await this.homey.notifications.createNotification({
              excerpt: 'Stromer password cleared successfully.'
            });
            settingsTimeout = null;
            return;
          }
          
          this.log('Stromer credentials updated, re-authenticating...');
          try {
            await this.authService.authenticateFromSettings();
            
            const currentPassword = this.homey.settings.get('stromer_password');
            if (currentPassword) {
              this.homey.settings.unset('stromer_password');
              this.log('Password cleared after successful authentication');
            }
            
            const bikes = await this.authService.getBikes();
            await this.homey.notifications.createNotification({
              excerpt: `Stromer authentication successful! Found ${bikes.length} bike(s) in your account.`
            });
          } catch (error) {
            this.error('Authentication failed:', error);
            await this.homey.notifications.createNotification({
              excerpt: `Stromer authentication failed: ${error.message}`
            });
          }
          settingsTimeout = null;
        }, 1000);
      }
    });

    this.homey.on('unload', () => {
      this.log('App is unloading, cleaning up auth service');
      if (settingsTimeout) {
        this.homey.clearTimeout(settingsTimeout);
      }
      if (this.authService) {
        this.authService.destroy();
      }
    });
  }

  getAuthService() {
    return this.authService;
  }
}

class StromerAuthService {
  constructor(app) {
    this.app = app;
    this.homey = app.homey;
    this.log = app.log.bind(app);
    this.error = app.error.bind(app);
    
    this.stromerAPI = null;
    this.refreshPromise = null;
    this.isAuthenticated = false;
  }

  async initialize() {
    this.log('Initializing StromerAuthService');
    
    try {
      await this.checkForMigration();
      
      const tokens = this.homey.settings.get('stromer_tokens');
      const clientId = this.homey.settings.get('stromer_client_id');
      
      if (tokens && clientId) {
        this.log('Found existing tokens, restoring session');
        this.stromerAPI = new StromerAPI(this.log);
        this.stromerAPI.clientId = clientId;
        this.stromerAPI.setTokens(tokens);
        this.isAuthenticated = true;
        
        try {
          await this.stromerAPI.getBikes();
          this.log('Token validation successful');
        } catch (error) {
          this.log('Stored tokens invalid, will need re-authentication');
          this.isAuthenticated = false;
        }
      } else {
        this.log('No stored tokens found, authentication required');
      }
    } catch (error) {
      this.error('Error initializing auth service:', error);
    }
  }

  async checkForMigration() {
    try {
      const hasAppSettings = this.homey.settings.get('stromer_email') || 
                             this.homey.settings.get('stromer_client_id');
      
      if (hasAppSettings) {
        this.log('App settings already configured, skipping migration check');
        return;
      }

      const driver = this.homey.drivers.getDriver('stromer-bike');
      const devices = driver.getDevices();
      
      if (devices && devices.length > 0) {
        this.log(`Found ${devices.length} existing device(s), checking for migration...`);
        
        const firstDevice = devices[0];
        const store = firstDevice.getStore();
        
        if (store && store.tokens && store.client_id) {
          this.log('Migrating credentials from device to app settings');
          
          this.homey.settings.set('stromer_tokens', store.tokens);
          this.homey.settings.set('stromer_client_id', store.client_id);
          
          await this.homey.notifications.createNotification({
            excerpt: 'Stromer app updated! Credentials migrated to App Settings. You can now configure your Stromer account in App Settings.'
          });
          
          this.log('Migration complete');
        } else {
          this.log('No credentials found in devices, manual configuration required');
          
          await this.homey.notifications.createNotification({
            excerpt: 'Stromer app updated! Please configure your credentials in App Settings before adding bikes.'
          });
        }
      }
    } catch (error) {
      this.error('Migration check failed:', error);
    }
  }

  async authenticateFromSettings() {
    const email = this.homey.settings.get('stromer_email');
    const password = this.homey.settings.get('stromer_password');
    const clientId = this.homey.settings.get('stromer_client_id');

    if (!email || !password || !clientId) {
      throw new Error('Email, password, and client ID are required');
    }

    this.log('Authenticating with Stromer API...');
    this.stromerAPI = new StromerAPI(this.log);
    
    await this.stromerAPI.authenticate(email, password, clientId, null);
    
    const tokens = this.stromerAPI.getTokens();
    this.homey.settings.set('stromer_tokens', tokens);
    this.homey.settings.set('stromer_client_id', clientId);
    
    this.isAuthenticated = true;
    this.log('Authentication successful, tokens saved');
    
    return true;
  }

  async ensureAuthenticated() {
    if (!this.isAuthenticated) {
      await this.authenticateFromSettings();
    }
  }

  async getValidTokens() {
    await this.ensureAuthenticated();
    
    if (this.refreshPromise) {
      this.log('Token refresh already in progress, waiting...');
      await this.refreshPromise;
    }

    const tokens = this.stromerAPI.getTokens();
    
    if (!tokens || !tokens.access_token) {
      throw new Error('No valid tokens available');
    }

    return tokens;
  }

  async refreshTokens() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        this.log('Refreshing tokens...');
        
        if (!this.stromerAPI || !this.stromerAPI.tokens || !this.stromerAPI.tokens.refresh_token) {
          throw new Error('No refresh token available');
        }

        await this.stromerAPI.refreshToken();
        
        const newTokens = this.stromerAPI.getTokens();
        this.homey.settings.set('stromer_tokens', newTokens);
        
        this.log('Token refresh successful');
        return newTokens;
      } catch (error) {
        this.error('Token refresh failed:', error);
        this.isAuthenticated = false;
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async getBikes() {
    await this.ensureAuthenticated();
    const bikes = await this.stromerAPI.getBikes();
    await this.saveTokens();
    return bikes;
  }

  async getBikeState(bikeId) {
    await this.ensureAuthenticated();
    const state = await this.stromerAPI.getBikeState(bikeId);
    await this.saveTokens();
    return state;
  }

  async getBikePosition(bikeId) {
    await this.ensureAuthenticated();
    const position = await this.stromerAPI.getBikePosition(bikeId);
    await this.saveTokens();
    return position;
  }

  async setBikeLight(bikeId, state) {
    await this.ensureAuthenticated();
    const result = await this.stromerAPI.setBikeLight(bikeId, state);
    await this.saveTokens();
    return result;
  }

  async setBikeLock(bikeId, state) {
    await this.ensureAuthenticated();
    const result = await this.stromerAPI.setBikeLock(bikeId, state);
    await this.saveTokens();
    return result;
  }

  async resetTripData(bikeId) {
    await this.ensureAuthenticated();
    const result = await this.stromerAPI.resetTripData(bikeId);
    await this.saveTokens();
    return result;
  }

  async getBikeDetails(bikeId) {
    await this.ensureAuthenticated();
    const details = await this.stromerAPI.getBikeDetails(bikeId);
    await this.saveTokens();
    return details;
  }

  async getYearStatistics(bikeId) {
    await this.ensureAuthenticated();
    const stats = await this.stromerAPI.getYearStatistics(bikeId);
    await this.saveTokens();
    return stats;
  }

  async getMonthStatistics(bikeId) {
    await this.ensureAuthenticated();
    const stats = await this.stromerAPI.getMonthStatistics(bikeId);
    await this.saveTokens();
    return stats;
  }

  async getDayStatistics(bikeId) {
    await this.ensureAuthenticated();
    const stats = await this.stromerAPI.getDayStatistics(bikeId);
    await this.saveTokens();
    return stats;
  }

  async saveTokens() {
    if (this.stromerAPI && this.stromerAPI.tokens) {
      this.homey.settings.set('stromer_tokens', this.stromerAPI.getTokens());
    }
  }

  getAPI() {
    return this.stromerAPI;
  }

  destroy() {
    this.stromerAPI = null;
    this.refreshPromise = null;
    this.isAuthenticated = false;
  }
}

module.exports = StromerApp;
