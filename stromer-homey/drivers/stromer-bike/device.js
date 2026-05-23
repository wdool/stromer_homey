'use strict';

const Homey = require('homey');

class StromerBikeDevice extends Homey.Device {
  async onInit() {
    this.log('StromerBikeDevice has been initialized');

    this.authService = this.homey.app.getAuthService();

    const settings = this.getSettings();
    this.pollInterval = (settings.poll_interval || 10) * 60 * 1000;
    this.activePollInterval = (settings.active_poll_interval || 30) * 1000;
    this.isActive = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.lastStatsFetch = 0;
    this.statsInterval = 60 * 60 * 1000;
    
    this.lastResetCheck = null;
    this.previousSoc = null;
    this.wasRiding = false;
    this.wasCharging = false;
    this.maintenanceNotified = false;

    await this.setUnavailable('Connecting to Stromer...').catch(this.error);

    // Ensure new capabilities exist (for upgrades from older versions)
    const newCaps = ['stromer_bike_speed', 'stromer_assistance_level', 'stromer_atmospheric_pressure',
      'stromer_firmware', 'stromer_year_distance', 'stromer_month_distance', 'stromer_week_distance',
      'stromer_torque_sensitivity', 'stromer_recup_level', 'stromer_vin', 'stromer_charging',
      'stromer_riding', 'stromer_distance_since_service'];
    for (const cap of newCaps) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap).catch(this.error);
      }
    }

    await this.updateBikeData();

    this.startPolling();

    this.registerCapabilityListener('onoff', async (value) => {
      return this.setLight(value ? 'on' : 'off');
    });

    this.registerCapabilityListener('locked', async (value) => {
      return this.setLock(value);
    });

    this.registerCapabilityListener('stromer_torque_sensitivity', async (value) => {
      return this.setSensorTuning('user_torque_sensitivity', value);
    });

    this.registerCapabilityListener('stromer_recup_level', async (value) => {
      return this.setSensorTuning('recup_level_user_offset', value);
    });
  }

  async onDeleted() {
    this.log('StromerBikeDevice has been deleted');
    this.stopPolling();
  }

  async onUninit() {
    this.log('StromerBikeDevice has been uninited');
    this.stopPolling();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed');
    
    if (changedKeys.includes('poll_interval')) {
      this.pollInterval = newSettings.poll_interval * 60 * 1000;
    }
    
    if (changedKeys.includes('active_poll_interval')) {
      this.activePollInterval = newSettings.active_poll_interval * 1000;
    }

    if (changedKeys.includes('poll_interval') || changedKeys.includes('active_poll_interval')) {
      this.stopPolling();
      this.startPolling();
    }
    
    const baselineKeys = ['user_total_baseline', 'odometer_baseline', 'year_baseline', 'month_baseline', 'week_baseline', 'day_baseline'];
    if (changedKeys.some(key => baselineKeys.includes(key))) {
      this.log('Baselines changed, updating data');
      await this.updateBikeData();
    }

    if (changedKeys.includes('battery_size') || changedKeys.includes('charge_target')) {
      this.log('Charge settings changed, recalculating charge time');
      const soc = this.getCapabilityValue('measure_battery') || 0;
      await this.updateChargeTime(soc);
    }
  }

  calculateChargeTime(soc, batteryWh, chargeTarget) {
    const CHARGER_POWER = 240;
    const TAPER_FACTOR = 1.18;

    const socFraction = soc / 100;

    if (chargeTarget === 80) {
      const minutesTo80 = Math.max(0, (0.8 - socFraction) * batteryWh / CHARGER_POWER * 60);
      return Math.round(minutesTo80);
    } else {
      const minutesTo80 = Math.max(0, (0.8 - socFraction) * batteryWh / CHARGER_POWER * 60);
      const minutesTo100 = Math.round(minutesTo80 * TAPER_FACTOR);
      return minutesTo100;
    }
  }

  async updateChargeTime(soc) {
    const settings = this.getSettings();
    const batterySize = settings.battery_size || 'none';
    const chargeTargetStr = settings.charge_target || '100';
    const chargeTarget = parseInt(chargeTargetStr, 10);

    const BATTERY_WH = {
      'BQ618': 618,
      'BQ814': 814,
      'BQ983': 983,
      'BQ1440': 1440
    };

    if (batterySize === 'none' || !BATTERY_WH[batterySize]) {
      return;
    }

    const batteryWh = BATTERY_WH[batterySize];
    const chargeMinutes = this.calculateChargeTime(soc, batteryWh, chargeTarget);

    this.log(`[CHARGE] SOC: ${soc}%, Battery: ${batterySize} (${batteryWh}Wh), Target: ${chargeTarget}%, Result: ${chargeMinutes} min`);

    if (this.hasCapability('stromer_charge_time')) {
      await this.setCapabilityValue('stromer_charge_time', chargeMinutes).catch(this.error);
    }

    const chargeHoursDecimal = Math.round((chargeMinutes / 60) * 10) / 10;
    if (this.hasCapability('stromer_charge_time_hours')) {
      await this.setCapabilityValue('stromer_charge_time_hours', chargeHoursDecimal).catch(this.error);
    }

    const chargeHours = Math.ceil(chargeMinutes / 60);
    await this.homey.flow.getDeviceTriggerCard('charge_time_updated')
      .trigger(this, { charge_minutes: chargeMinutes, charge_hours: chargeHours }, {})
      .catch(() => {});
  }
  
  async checkAndResetBaselines(totalDistance) {
    const settings = this.getSettings();
    
    let yearBaseline = settings.year_baseline || 0;
    let monthBaseline = settings.month_baseline || 0;
    let weekBaseline = settings.week_baseline || 0;
    let dayBaseline = settings.day_baseline || 0;
    
    let yearDate = settings.year_date || null;
    let monthDate = settings.month_date || null;
    let weekDate = settings.week_date || null;
    let dayDate = settings.day_date || null;
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    const currentWeek = this.getWeekNumber(now);
    
    let updated = false;
    
    if (!yearDate || new Date(yearDate).getFullYear() !== currentYear) {
      this.log(`[AUTO-RESET] New year detected, resetting year baseline from ${yearBaseline} to ${totalDistance}`);
      yearBaseline = totalDistance;
      yearDate = now.toISOString();
      await this.setSettings({ year_baseline: yearBaseline, year_date: yearDate });
      updated = true;
    }
    
    if (!monthDate || new Date(monthDate).getMonth() !== currentMonth || new Date(monthDate).getFullYear() !== currentYear) {
      this.log(`[AUTO-RESET] New month detected, resetting month baseline from ${monthBaseline} to ${totalDistance}`);
      monthBaseline = totalDistance;
      monthDate = now.toISOString();
      await this.setSettings({ month_baseline: monthBaseline, month_date: monthDate });
      updated = true;
    }
    
    if (!weekDate || this.getWeekNumber(new Date(weekDate)) !== currentWeek || new Date(weekDate).getFullYear() !== currentYear) {
      this.log(`[AUTO-RESET] New week detected, resetting week baseline from ${weekBaseline} to ${totalDistance}`);
      weekBaseline = totalDistance;
      weekDate = now.toISOString();
      await this.setSettings({ week_baseline: weekBaseline, week_date: weekDate });
      updated = true;
    }
    
    if (!dayDate || new Date(dayDate).getDate() !== currentDay || new Date(dayDate).getMonth() !== currentMonth || new Date(dayDate).getFullYear() !== currentYear) {
      this.log(`[AUTO-RESET] New day detected, resetting day baseline from ${dayBaseline} to ${totalDistance}`);
      dayBaseline = totalDistance;
      dayDate = now.toISOString();
      await this.setSettings({ day_baseline: dayBaseline, day_date: dayDate });
      updated = true;
    }
    
    if (updated) {
      this.log('[AUTO-RESET] Baselines updated successfully');
    }
    
    return { yearBaseline, monthBaseline, weekBaseline, dayBaseline };
  }
  
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  startPolling() {
    this.stopPolling();
    
    const interval = this.isActive ? this.activePollInterval : this.pollInterval;
    this.log(`Starting polling with interval: ${interval}ms`);
    
    this.pollTimer = this.homey.setTimeout(async () => {
      await this.updateBikeData();
      this.startPolling();
    }, interval);
  }

  stopPolling() {
    if (this.pollTimer) {
      this.homey.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async updateBikeData() {
    try {
      const bikeId = this.getData().id;
      
      const [status, position, bikeDetails, sensors, serviceInfo] = await Promise.all([
        this.authService.getBikeState(bikeId).catch(err => {
          this.error('Failed to get bike status:', err);
          return null;
        }),
        this.authService.getBikePosition(bikeId).catch(err => {
          this.error('Failed to get bike position:', err);
          return null;
        }),
        this.authService.getBikeDetails(bikeId).catch(err => {
          this.error('Failed to get bike details:', err);
          return null;
        }),
        this.authService.getBikeSensors(bikeId).catch(err => {
          this.error('Failed to get bike sensors:', err);
          return null;
        }),
        this.authService.getServiceInfo(bikeId).catch(err => {
          this.error('Failed to get service info:', err);
          return null;
        })
      ]);

      if (!status && !position) {
        throw new Error('Failed to fetch bike data');
      }

      this.log('[DEBUG] Raw API status response:', JSON.stringify(status, null, 2));
      this.log('[DEBUG] Raw API position response:', JSON.stringify(position, null, 2));
      if (bikeDetails) this.log('[DEBUG] Raw API bike details:', JSON.stringify(bikeDetails, null, 2));

      this.retryCount = 0;

      if (status) {
        await this.updateStatusCapabilities(status);
      }

      if (position) {
        await this.updatePositionCapabilities(position);
      }

      if (bikeDetails) {
        await this.updateBikeDetailsCapabilities(bikeDetails);
      }

      if (sensors) {
        await this.updateSensorCapabilities(sensors);
      }

      if (serviceInfo) {
        await this.updateServiceInfo(serviceInfo);
      }

      const wasActive = this.isActive;
      this.isActive = this.checkIfActive(status);
      
      if (wasActive !== this.isActive) {
        this.log(`Bike activity changed to: ${this.isActive ? 'active' : 'inactive'}`);
        this.stopPolling();
        this.startPolling();
      }

      await this.setAvailable().catch(this.error);

    } catch (error) {
      this.error('Failed to update bike data:', error);
      
      if (error.message && (error.message.includes('credentials') || error.message.includes('authentication') || error.message.includes('401'))) {
        await this.setUnavailable('Authentication failed. Please check App Settings and update credentials.').catch(this.error);
        this.stopPolling();
        return;
      }
      
      this.retryCount++;
      
      if (this.retryCount >= this.maxRetries) {
        await this.setUnavailable(`Failed to connect to bike: ${error.message}`).catch(this.error);
      }
      
      const backoffDelay = Math.min(Math.pow(2, this.retryCount) * 1000, 60000);
      this.log(`Retry ${this.retryCount}/${this.maxRetries}, backing off ${backoffDelay}ms`);
      
      this.stopPolling();
      this.pollTimer = this.homey.setTimeout(async () => {
        await this.updateBikeData();
        this.startPolling();
      }, backoffDelay);
    }
  }

  async updatePositionCapabilities(position) {
    if (position && position.latitude != null && position.longitude != null) {
      const locationString = `${position.latitude}, ${position.longitude}`;
      await this.setCapabilityValue('stromer_location', locationString).catch(this.error);
    }
  }

  async updateBikeDetailsCapabilities(details) {
    this.log('[DEBUG] Raw bike details response:', JSON.stringify(details, null, 2));
  }

  async updateStatusCapabilities(status) {
    const oldBattery = this.getCapabilityValue('measure_battery');
    const oldBatteryHealth = this.getCapabilityValue('stromer_battery_health');
    const oldTheftFlag = this.getCapabilityValue('alarm_theft');
    const oldLocked = this.getCapabilityValue('locked');

    const totalDistance = status.total_distance || 0;
    
    const settings = this.getSettings();
    const userTotalBaseline = settings.user_total_baseline || 0;
    const odometerBaseline = settings.odometer_baseline || 0;
    
    const baselines = await this.checkAndResetBaselines(totalDistance);
    
    const userTotalDistance = userTotalBaseline + (totalDistance - odometerBaseline);
    
    this.log('[CALC] Total Distance:', totalDistance, 'User Total:', userTotalDistance);

    const capabilities = {
      'stromer_state_of_charge': status.battery_SOC || 0,
      'measure_battery': status.battery_SOC || 0,
      'stromer_battery_health': status.battery_health || 100,
      'alarm_theft': status.theft_flag || false,
      'stromer_motor_temp_c': status.motor_temp || 0,
      'stromer_battery_temp_c': status.battery_temp || 0,
      'onoff': status.light_on || status.light === 'on' || false,
      'locked': status.lock === 'locked' || status.lock_status === 'locked' || status.bike_lock === true || false,
      'stromer_trip_distance': status.trip_distance || 0,
      'stromer_average_speed_trip': status.average_speed_trip || 0,
      'stromer_distance_total': totalDistance,
      'stromer_distance_avg_speed': status.average_speed_total || 0,
      'stromer_avg_energy': status.average_energy_consumption || 0,
      'stromer_user_total_distance': userTotalDistance,
      'stromer_power_cycles': status.power_on_cycles || 0,
      'stromer_total_energy_consumption': status.total_energy_consumption || 0,
      'stromer_bike_speed': status.bike_speed || 0,
      'stromer_assistance_level': status.assistance_level || 0,
      'stromer_atmospheric_pressure': status.atmospheric_pressure || 0,
      'stromer_firmware': status.suiversion || 'Unknown'
    }

    for (const [capability, value] of Object.entries(capabilities)) {
      if (value !== undefined && value !== null && this.hasCapability(capability)) {
        await this.setCapabilityValue(capability, value).catch(err => {
          this.error(`Failed to set ${capability}:`, err);
        });
      }
    }

    const currentSoc = capabilities['measure_battery'] || 0;
    await this.updateChargeTime(currentSoc);

    if (capabilities.alarm_theft && !oldTheftFlag) {
      await this.homey.flow.getDeviceTriggerCard('theft_activated')
        .trigger(this, {}, {})
        .catch(this.error);
    }

    if (oldLocked && !capabilities.locked) {
      await this.homey.flow.getDeviceTriggerCard('bike_unlocked')
        .trigger(this, {}, {})
        .catch(this.error);
    }

    if (oldBattery !== null && capabilities.measure_battery < oldBattery) {
      await this.homey.flow.getDeviceTriggerCard('battery_low')
        .trigger(this, {}, { threshold: capabilities.measure_battery })
        .catch(this.error);
    }

    if (oldBatteryHealth !== null && capabilities.stromer_battery_health < oldBatteryHealth) {
      await this.homey.flow.getDeviceTriggerCard('battery_health_low')
        .trigger(this, {}, { threshold: capabilities.stromer_battery_health })
        .catch(this.error);
    }

    // Period distances
    const yearDistance = totalDistance - baselines.yearBaseline;
    const monthDistance = totalDistance - baselines.monthBaseline;
    const weekDistance = totalDistance - baselines.weekBaseline;
    
    if (this.hasCapability('stromer_year_distance')) {
      await this.setCapabilityValue('stromer_year_distance', Math.max(0, yearDistance)).catch(this.error);
    }
    if (this.hasCapability('stromer_month_distance')) {
      await this.setCapabilityValue('stromer_month_distance', Math.max(0, monthDistance)).catch(this.error);
    }
    if (this.hasCapability('stromer_week_distance')) {
      await this.setCapabilityValue('stromer_week_distance', Math.max(0, weekDistance)).catch(this.error);
    }

    // Ride detection (feature 9)
    const isRiding = !capabilities.locked && (status.bike_speed || 0) > 0;
    if (this.hasCapability('stromer_riding')) {
      await this.setCapabilityValue('stromer_riding', isRiding).catch(this.error);
    }
    if (isRiding && !this.wasRiding) {
      await this.homey.flow.getDeviceTriggerCard('ride_started')
        .trigger(this, {}, {}).catch(() => {});
    } else if (!isRiding && this.wasRiding) {
      await this.homey.flow.getDeviceTriggerCard('ride_ended')
        .trigger(this, {}, {}).catch(() => {});
    }
    this.wasRiding = isRiding;

    // Charge detection (feature 11)
    const currentSocValue = capabilities['measure_battery'] || 0;
    const isCharging = this.previousSoc !== null && currentSocValue > this.previousSoc && capabilities.locked;
    if (this.hasCapability('stromer_charging')) {
      await this.setCapabilityValue('stromer_charging', isCharging).catch(this.error);
    }
    if (isCharging && !this.wasCharging) {
      await this.homey.flow.getDeviceTriggerCard('charging_started')
        .trigger(this, {}, {}).catch(() => {});
    } else if (!isCharging && this.wasCharging) {
      await this.homey.flow.getDeviceTriggerCard('charging_stopped')
        .trigger(this, {}, {}).catch(() => {});
    }
    this.wasCharging = isCharging;

    // Charge target reached trigger
    if (this.previousSoc !== null && currentSocValue > this.previousSoc) {
      await this.homey.flow.getDeviceTriggerCard('charge_target_reached')
        .trigger(this, {}, { soc: currentSocValue }).catch(() => {});
    }
    this.previousSoc = currentSocValue;

    // Maintenance check (feature 10)
    const maintenanceSettings = this.getSettings();
    const lastServiceDist = maintenanceSettings.last_service_distance || 0;
    const maintenanceInterval = maintenanceSettings.maintenance_interval || 2000;
    const distanceSinceService = Math.max(0, totalDistance - lastServiceDist);
    
    if (this.hasCapability('stromer_distance_since_service')) {
      await this.setCapabilityValue('stromer_distance_since_service', Math.round(distanceSinceService)).catch(this.error);
    }
    
    if (distanceSinceService >= maintenanceInterval && !this.maintenanceNotified) {
      this.maintenanceNotified = true;
      await this.homey.flow.getDeviceTriggerCard('maintenance_due')
        .trigger(this, {}, {}).catch(() => {});
    } else if (distanceSinceService < maintenanceInterval) {
      this.maintenanceNotified = false;
    }
  }

  checkIfActive(status) {
    if (!status) return false;
    
    if (status.theft_flag) return true;
    
    if (status.lock === 'unlocked' || status.lock_status === 'unlocked' || status.bike_lock === false) return true;
    
    if ((status.bike_speed || status.speed) && (status.bike_speed || status.speed) > 0) return true;
    
    return false;
  }

  async setLight(mode) {
    try {
      const bikeId = this.getData().id;
      await this.authService.setBikeLight(bikeId, mode);
      
      await this.setCapabilityValue('onoff', mode === 'on' || mode === 'bright').catch(this.error);
      
      await this.updateBikeData();
      
      return true;
    } catch (error) {
      this.error('Failed to set light:', error);
      throw new Error('Failed to control bike light');
    }
  }

  async setLock(lock) {
    try {
      const bikeId = this.getData().id;
      await this.authService.setBikeLock(bikeId, lock);
      
      await this.setCapabilityValue('locked', lock).catch(this.error);
      
      await this.updateBikeData();
      
      return true;
    } catch (error) {
      this.error('Failed to set lock:', error);
      throw new Error('Failed to control bike lock');
    }
  }

  async resetTripDistance() {
    try {
      const bikeId = this.getData().id;
      await this.authService.resetTripData(bikeId);
      
      await this.setCapabilityValue('stromer_trip_distance', 0).catch(this.error);
      
      await this.updateBikeData();
      
      return true;
    } catch (error) {
      this.error('Failed to reset trip distance:', error);
      throw new Error('Failed to reset trip distance');
    }
  }

  async updateSensorCapabilities(sensors) {
    if (sensors.user_torque_sensitivity !== undefined && this.hasCapability('stromer_torque_sensitivity')) {
      await this.setCapabilityValue('stromer_torque_sensitivity', sensors.user_torque_sensitivity).catch(this.error);
    }
    if (sensors.recup_level_user_offset !== undefined && this.hasCapability('stromer_recup_level')) {
      await this.setCapabilityValue('stromer_recup_level', sensors.recup_level_user_offset).catch(this.error);
    }
  }

  async updateServiceInfo(serviceInfo) {
    if (serviceInfo.vin && this.hasCapability('stromer_vin')) {
      await this.setCapabilityValue('stromer_vin', serviceInfo.vin).catch(this.error);
    }
    // Store serial and VIN in device settings for reference
    const updates = {};
    if (serviceInfo.vin) updates.bike_vin = serviceInfo.vin;
    if (serviceInfo.serial) updates.bike_serial = serviceInfo.serial;
    if (Object.keys(updates).length > 0) {
      await this.setSettings(updates).catch(this.error);
    }
  }

  async setSensorTuning(param, value) {
    try {
      const bikeId = this.getData().id;
      await this.authService.setBikeSensors(bikeId, { [param]: value });
      await this.updateBikeData();
      return true;
    } catch (error) {
      this.error('Failed to set sensor tuning:', error);
      throw new Error(`Failed to set ${param}`);
    }
  }

  async setMotorTuning(speed, torque, agility) {
    try {
      const bikeId = this.getData().id;
      await this.authService.setBikeMotorTuning(bikeId, {
        tuning_speed: speed,
        tuning_torque: torque,
        tuning_agility: agility
      });
      await this.updateBikeData();
      return true;
    } catch (error) {
      this.error('Failed to set motor tuning:', error);
      throw new Error('Failed to set motor tuning');
    }
  }
}

module.exports = StromerBikeDevice;
