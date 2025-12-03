# Stromer Bike App for Homey

Connect your Stromer e-bike to Homey and monitor battery status, track trips, control lights and locks, and automate your bike experience with powerful Flow cards.

## Features

### Monitoring & Tracking
- **Battery Monitoring**: Track battery level and health in real-time
- **Temperature Sensors**: Monitor motor and battery temperature
- **Trip Statistics**: Track trip distance, average speed, and energy consumption
- **Lifetime Stats**: Monitor total distance across multiple timeframes (day, month, year, lifetime)
- **Location Tracking**: GPS coordinates for bike location
- **Theft Detection**: Immediate alerts when theft alarm is activated

### Control & Automation
- **Remote Light Control**: Turn lights on/off, dim, or set to bright mode
- **Remote Lock/Unlock**: Control bike lock from Homey
- **Adaptive Polling**: Automatically increases update frequency when bike is active (unlocked, moving, or theft detected)
- **Flow Integration**: Powerful automation with triggers, conditions, and actions

### Insights & Analytics
- All data points available in Homey Insights for long-term tracking
- Monitor battery degradation over time
- Track riding patterns and energy efficiency

## Installation

### Prerequisites
1. Homey Pro 2023 or later (requires Homey Pro with SDK v3 support)
2. Stromer e-bike with connected account
3. Stromer API credentials (client_id, and optionally client_secret)

### Installing the App
1. Open Homey app or web interface
2. Navigate to Apps → Add App
3. Search for "Stromer"
4. Click Install

### Retrieving API Credentials (MITM Method)

To use this app, you need to retrieve your Stromer API credentials. This requires intercepting the login request from the official Stromer app. Here's how:

#### Method 1: Using Charles Proxy (Mac/Windows/Linux)

**Step 1: Install Charles Proxy**
1. Download Charles Proxy from https://www.charlesproxy.com/
2. Install and launch Charles
3. Accept the trial or enter license key

**Step 2: Configure SSL Proxying**
1. In Charles, go to Proxy → SSL Proxying Settings
2. Click "Add" under SSL Proxying
3. Enter:
   - Host: `api3.stromer-portal.ch`
   - Port: `443`
4. Click OK

**Step 3: Install Charles Certificate on iPhone**
1. In Charles, go to Help → SSL Proxying → Install Charles Root Certificate on a Mobile Device
2. Follow the instructions to configure your iPhone to use Charles proxy
3. On iPhone, go to Settings → General → About → Certificate Trust Settings
4. Enable full trust for Charles Proxy certificate

**Step 4: Configure iPhone Proxy**
1. On iPhone, go to Settings → Wi-Fi
2. Tap the (i) icon next to your connected network
3. Scroll to HTTP Proxy → Configure Proxy → Manual
4. Enter your Mac's IP address (shown in Charles)
5. Port: 8888
6. Save

**Step 5: Intercept Login Request**
1. Open Stromer OMNI app on iPhone
2. Log out if already logged in
3. In Charles, clear the session (Ctrl+K / Cmd+K)
4. Log in with your Stromer credentials
5. In Charles, find the request to `api3.stromer-portal.ch` → `/mobile/v4/o/token/` or `/o/token/`
6. Click on the request → Request tab
7. Look for the JSON body containing:
   ```json
   {
     "grant_type": "password",
     "username": "your@email.com",
     "password": "yourpassword",
     "client_id": "YOUR_CLIENT_ID_HERE",
     "client_secret": "YOUR_CLIENT_SECRET_HERE"  // Only for v3 API
   }
   ```
8. Copy the `client_id` (and `client_secret` if present)

**Step 6: Clean Up**
1. On iPhone, go back to Wi-Fi settings → HTTP Proxy → Off
2. Remove Charles certificate from iPhone (Settings → General → VPN & Device Management)

#### Method 2: Using mitmproxy (Mac/Linux - Advanced Users)

**Step 1: Install mitmproxy**
```bash
brew install mitmproxy  # Mac
# OR
pip install mitmproxy   # Linux/Mac
```

**Step 2: Start mitmproxy**
```bash
mitmproxy --listen-port 8080
```

**Step 3: Configure iPhone Proxy**
1. Settings → Wi-Fi → (i) → HTTP Proxy → Manual
2. Server: Your computer's IP address
3. Port: 8080

**Step 4: Install Certificate**
1. On iPhone, browse to http://mitm.it
2. Install the certificate for iOS
3. Settings → General → About → Certificate Trust Settings → Enable

**Step 5: Capture Credentials**
1. Open Stromer app on iPhone
2. Log in with credentials
3. In mitmproxy terminal, press `/` to search
4. Search for `token`
5. Press Enter to view request
6. Look for `client_id` and `client_secret` in request body

### Adding Your Bike to Homey

1. In Homey, go to Devices → Add Device
2. Select "Stromer" from the list
3. Choose "Stromer Bike"
4. Enter your Stromer account credentials:
   - **Email**: Your Stromer account email
   - **Password**: Your Stromer account password
   - **Client ID**: The client_id you retrieved (or use default)
   - **Client Secret**: (Optional) Only needed for v3 API accounts
5. Click "Login"
6. Select your bike from the list (auto-selected if you have only one bike)
7. Click "Add Device"

**Note**: If you don't provide a client_id, the app will use a default client_id that works for most accounts. Client secret is optional and only required for older v3 API accounts.

## Usage

### Device Capabilities

Once added, your Stromer bike exposes the following capabilities:

#### Battery & Health
- **Battery Level** (`measure_battery`): Current battery charge percentage
- **Battery Health** (`stromer_battery_health`): Long-term battery health percentage
- **Battery Temperature** (`stromer_battery_temp_c`): Battery temperature in Celsius

#### Temperature Monitoring
- **Motor Temperature** (`stromer_motor_temp_c`): Motor temperature in Celsius

#### Trip Statistics
- **Trip Distance** (`stromer_trip_distance`): Current trip distance in km
- **Trip Average Speed** (`stromer_average_speed_trip`): Average speed for current trip in km/h
- **Day Average Speed** (`stromer_day_avg_speed`): Today's average speed in km/h
- **Month Average Speed** (`stromer_month_avg_speed`): This month's average speed
- **Month Distance** (`stromer_month_distance`): Distance traveled this month
- **Year Average Speed** (`stromer_year_avg_speed`): This year's average speed
- **Year Distance** (`stromer_year_distance`): Distance traveled this year

#### Totals & Lifetime
- **Distance** (`stromer_distance_total`): Total distance in current period
- **Distance Average Speed** (`stromer_distance_avg_speed`): Average speed across all rides
- **Total Distance** (`stromer_total_distance`): Cumulative distance since bike activation
- **Lifetime Total Distance** (`stromer_lifetime_total_km`): Complete lifetime odometer (including legacy data)
- **Average Energy Consumption** (`stromer_avg_energy`): Energy efficiency in Wh/km

#### Location & Status
- **Latitude** (`stromer_latitude`): Current GPS latitude
- **Longitude** (`stromer_longitude`): Current GPS longitude
- **Current Speed** (`stromer_bike_speed`): Real-time speed in km/h
- **Assistance Level** (`stromer_assistance_level`): Current motor assistance level (0-3)
- **Light** (`onoff`): Light status (on/off)
- **Lock** (`locked`): Lock status (locked/unlocked)
- **Theft Alarm** (`alarm_theft`): Theft detection status

### Flow Cards

#### Triggers (When...)
- **Battery level drops below [X]%**: Trigger when battery reaches low level
- **Battery health drops below [X]%**: Monitor long-term battery degradation
- **Bike was unlocked**: Know when someone unlocks the bike
- **Theft alarm activated**: Immediate notification when theft is detected
- **Trip distance exceeds [X] km**: Track long rides
- **Trip average speed exceeds [X] km/h**: Monitor riding speed

#### Conditions (And...)
- **Battery level is (not) above [X]%**: Check battery before actions
- **Battery health is (not) above [X]%**: Monitor battery condition
- **Bike is (not) locked**: Verify lock status
- **Light is (not) on**: Check light status
- **Theft alarm is (not) active**: Verify security status
- **[Motor/Battery] temperature is (not) between [X]°C and [Y]°C**: Temperature safety checks

#### Actions (Then...)
- **Reset trip distance**: Clear trip odometer
- **Set light to [off/on/dim/bright]**: Control bike lighting
- **Lock bike**: Remotely lock the bike
- **Unlock bike**: Remotely unlock the bike
- **Send bike status notification**: Get battery, trip distance, and other stats

### Example Flows

#### Low Battery Alert
**When** Battery level drops below 20%
**Then** Send push notification "Stromer battery low - charge soon!"

#### Theft Protection
**When** Theft alarm activated
**And** Bike is not at home
**Then** Send push notification "ALERT: Stromer theft alarm triggered!"
**Then** Turn on all house lights

#### Automatic Night Light
**When** Bike was unlocked
**And** It's between sunset and sunrise
**Then** Set light to on

#### Trip Summary
**When** Bike was locked
**And** Trip distance is above 1 km
**Then** Send bike status notification

## Polling Behavior

The app uses adaptive polling to balance battery life and responsiveness:

- **Default (Inactive)**: Updates every 10 minutes (configurable 1-60 minutes)
- **Active Mode**: Updates every 30 seconds (configurable 10-300 seconds)

Active mode triggers when:
- Bike is unlocked
- Bike is moving (speed > 0)
- Theft alarm is active

This ensures you get real-time updates when you need them, while conserving resources when the bike is parked.

### Configuring Polling

1. Go to Devices → Your Stromer Bike → Settings
2. Adjust "Default Polling Interval" (when bike is inactive)
3. Adjust "Active Polling Interval" (when bike is in use)

## Troubleshooting

### Authentication Issues

**Problem**: Login fails or "Invalid credentials" error
**Solutions**:
1. Verify your Stromer account credentials are correct
2. Check if you're using the correct client_id
3. For v3 accounts, ensure client_secret is provided
4. Try logging in to the Stromer web portal to verify account status

**Problem**: Token refresh fails
**Solutions**:
1. Remove and re-add the device in Homey
2. Verify your Stromer account is still active
3. Check if Stromer API is operational

### Connection Issues

**Problem**: Device shows as unavailable
**Solutions**:
1. Check your internet connection
2. Verify bike has cellular/GPS connection
3. Wait a few minutes - bike may be in standby mode
4. Check Stromer app to verify bike is online

**Problem**: Data not updating
**Solutions**:
1. Check device settings → Verify polling intervals are reasonable
2. Restart the Homey app
3. Remove and re-add the device

### Flow Card Issues

**Problem**: Flow triggers not firing
**Solutions**:
1. Verify the trigger condition is actually met (check device capabilities)
2. Ensure polling is active (check "Active Polling Interval")
3. Test with Action cards first to verify device communication

## Privacy & Security

- **Local Storage**: All tokens and credentials are stored securely on your Homey device
- **Encrypted Communication**: All API communication uses HTTPS
- **No Cloud Dependency**: After initial authentication, the app communicates directly with Stromer API
- **Token Management**: Access tokens are automatically refreshed; refresh tokens are encrypted
- **No Third Parties**: No data is sent to third parties beyond the official Stromer API

## API & Data Usage

This app uses the official Stromer API endpoints:
- Base URL: `https://api3.stromer-portal.ch`
- API Versions: v3 and v4 supported
- Authentication: OAuth2 password grant with refresh tokens

## Diagnostics

To export diagnostics for troubleshooting:
1. Go to Homey Settings → Apps → Stromer
2. Click "Export Diagnostics"
3. Share the file with support (all secrets are automatically redacted)

## Changelog

### Version 1.0.0 (Initial Release)
- OAuth2 authentication with v3 and v4 API support
- Multi-bike support
- 20+ device capabilities
- Battery and health monitoring
- Trip and lifetime statistics
- GPS location tracking
- Theft detection
- Remote light and lock control
- Adaptive polling system
- Comprehensive Flow cards (triggers, conditions, actions)
- Homey Insights integration

## Roadmap

Future enhancements planned:
- **Geofencing**: Custom zones with enter/leave triggers
- **Advanced Theft Recovery**: Location history and tracking
- **Maintenance Alerts**: Predictive maintenance based on usage
- **Multiple Account Support**: Manage bikes from different Stromer accounts
- **Enhanced Notifications**: Customizable alert templates
- **Battery Analytics Dashboard**: Detailed degradation tracking
- **Route History**: Track and visualize ride routes

## Support

- **Issues**: https://github.com/stromer-homey/support/issues
- **Community**: Homey Community Forum
- **Email**: support@stromer-homey.app

## Legal

### License
This app is licensed under GNU General Public License v3.0 (GPL-3.0).

### Disclaimer
This is an unofficial third-party application and is not affiliated with, endorsed by, or connected to Stromer AG or myStromer AG. Stromer and OMNI are trademarks of myStromer AG.

Use this app at your own risk. The developers are not responsible for any damage, data loss, or issues that may arise from using this application.

### Attribution
- Stromer wordmark and logo are property of myStromer AG
- Home Assistant Stromer integration (reference): https://github.com/CoMPaTech/stromer
- Domoticz Stromer plugin (reference): Domoticz-Stromer-plugin

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

### Development Setup
```bash
# Clone repository
git clone https://github.com/stromer-homey/stromer-homey.git
cd stromer-homey

# Install dependencies
npm install

# Run locally (requires Homey device)
homey app run
```

## Credits

Developed with care for the Stromer and Homey communities.

Special thanks to:
- Athom B.V. for the Homey platform and excellent SDK
- Stromer AG for creating amazing e-bikes
- The Home Assistant community for API documentation insights

---

**Enjoy your connected Stromer experience with Homey!** 🚴‍♂️⚡
