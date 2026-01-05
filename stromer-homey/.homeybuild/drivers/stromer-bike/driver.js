'use strict';

const Homey = require('homey');

class StromerBikeDriver extends Homey.Driver {
  async onInit() {
    this.log('StromerBikeDriver has been initialized');
  }

  formatDebugError(error) {
    const debugLog = error.debugLog || '';
    const separator = '\n\n========== DEBUG LOG (copy this) ==========\n';
    const endSeparator = '\n============================================';
    
    if (debugLog) {
      return `${error.message}${separator}${debugLog}${endSeparator}`;
    }
    return error.message;
  }

  async onPair(session) {
    const authService = this.homey.app.getAuthService();
    let bikes = [];

    session.setHandler('list_devices', async () => {
      try {
        if (!authService.isAuthenticated) {
          const api = authService.getAPI();
          let debugInfo = '';
          if (api) {
            debugInfo = api.getDebugLog();
          }
          
          const errorMsg = 'Please configure your Stromer account credentials in App Settings first and save to authenticate';
          if (debugInfo) {
            throw new Error(`${errorMsg}\n\n========== DEBUG LOG (copy this) ==========\n${debugInfo}\n============================================`);
          }
          throw new Error(errorMsg);
        }

        this.log('Fetching bikes from authenticated session...');
        
        try {
          bikes = await authService.getBikes();
        } catch (fetchError) {
          this.error('Error fetching bikes:', fetchError.message);
          throw new Error(this.formatDebugError(fetchError));
        }
        
        if (!bikes || bikes.length === 0) {
          const api = authService.getAPI();
          let debugInfo = '';
          if (api) {
            debugInfo = api.getDebugLog();
          }
          
          const errorMsg = 'No bikes found in your Stromer account. Please verify your bike is linked in the official Stromer app.';
          if (debugInfo) {
            throw new Error(`${errorMsg}\n\n========== DEBUG LOG (copy this) ==========\n${debugInfo}\n============================================`);
          }
          throw new Error(errorMsg);
        }

        this.log(`Found ${bikes.length} bike(s)`);

        return bikes.map(bike => {
          const bikeName = bike.nickname || bike.name || `Stromer ${bike.biketype || 'Bike'}`;
          const bikeId = bike.bikeid || bike.id;
          
          return {
            name: bikeName,
            data: {
              id: String(bikeId)
            },
            store: {
              nickname: bike.nickname,
              biketype: bike.biketype,
              color: bike.color,
              bikenumber: bike.bikenumber
            }
          };
        });
      } catch (error) {
        this.error('Error during pairing:', error.message);
        if (error.debugLog) {
          throw new Error(this.formatDebugError(error));
        }
        throw error;
      }
    });
  }

  async onRepair(session, device) {
    session.setHandler('list_devices', async () => {
      try {
        const authService = this.homey.app.getAuthService();
        
        if (!authService.isAuthenticated) {
          const api = authService.getAPI();
          let debugInfo = '';
          if (api) {
            debugInfo = api.getDebugLog();
          }
          
          const errorMsg = 'Please configure your Stromer account credentials in App Settings first and save to authenticate';
          if (debugInfo) {
            throw new Error(`${errorMsg}\n\n========== DEBUG LOG (copy this) ==========\n${debugInfo}\n============================================`);
          }
          throw new Error(errorMsg);
        }

        this.log('Re-initializing device with existing session...');
        await device.onInit();
        
        this.log('Device repaired successfully');
        return true;
      } catch (error) {
        this.error('Repair failed:', error.message);
        if (error.debugLog) {
          throw new Error(this.formatDebugError(error));
        }
        throw new Error(`Repair failed: ${error.message}`);
      }
    });
  }
}

module.exports = StromerBikeDriver;
