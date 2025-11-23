'use strict';

const Homey = require('homey');

class StromerBikeDriver extends Homey.Driver {
  async onInit() {
    this.log('StromerBikeDriver has been initialized');
  }

  async onPair(session) {
    const authService = this.homey.app.getAuthService();
    let bikes = [];

    session.setHandler('list_devices', async () => {
      try {
        const email = this.homey.settings.get('stromer_email');
        const password = this.homey.settings.get('stromer_password');
        const clientId = this.homey.settings.get('stromer_client_id');

        if (!email || !password || !clientId) {
          throw new Error('Please configure your Stromer account credentials in App Settings first');
        }

        this.log('Authenticating and fetching bikes...');
        bikes = await authService.getBikes();
        
        if (!bikes || bikes.length === 0) {
          throw new Error('No bikes found in your account');
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
        throw error;
      }
    });
  }

  async onRepair(session, device) {
    session.setHandler('list_devices', async () => {
      try {
        const email = this.homey.settings.get('stromer_email');
        const password = this.homey.settings.get('stromer_password');
        const clientId = this.homey.settings.get('stromer_client_id');

        if (!email || !password || !clientId) {
          throw new Error('Please configure your Stromer account credentials in App Settings first');
        }

        this.log('Re-authenticating...');
        const authService = this.homey.app.getAuthService();
        await authService.authenticateFromSettings();
        
        await device.onInit();
        
        this.log('Device repaired successfully');
        return true;
      } catch (error) {
        this.error('Repair failed:', error.message);
        throw new Error(`Re-authentication failed: ${error.message}`);
      }
    });
  }
}

module.exports = StromerBikeDriver;
