# Changelog

All notable changes to this project will be documented in this file.

## [1.0.8] - 2026-04-18

### Added
- **Estimated Charge Time capability** (`stromer_charge_time`) with timer icon, showing minutes to reach target charge level
- **Battery Size setting** (Bike Information): dropdown for BQ618 (618 Wh), BQ814 (814 Wh), BQ983 (983 Wh), BQ1440 (1440 Wh)
- **Charge Target setting**: choose 80% (faster, battery-friendly) or 100% (full)
- **New Flow trigger** `charge_time_updated` with two tokens:
  - `charge_minutes` — exact remaining minutes
  - `charge_hours` — rounded up hours, ideal for energy-rate scheduling flows

### Calculation
- Uses 240 W effective charger power (CR246 standard charger)
- Linear charging up to 80%, then ×1.18 taper factor for 80→100%
- Returns 0 minutes if SOC already meets the target

### Fixed
- Syntax error in `StromerAPI.js` debug logging that caused app crash on startup (regression from 1.0.7)

### Notes
- Existing paired bikes must be deleted and re-paired to gain the new charge time capability (Homey SDK limitation)

## [1.0.7] - 2026-01-06

### Added
- Detailed authentication debug logging throughout `StromerAPI.js`
- Copyable error messages with full debug log in pairing failure dialogs (driver.js `formatDebugError`)
- Errors now include step-by-step authentication details between clear separators for easy copy/paste support requests

### Improved
- Better detection and reporting when Stromer rejects credentials (parses HTML error messages from login response)

## [1.0.6] - 2025-12-15

### Changed
- Internal version bump (accidentally published; functionally equivalent to 1.0.5)

## [1.0.5] - 2025-12-10

### Added
- Self Hosted Server platform compatibility verified
- Multi-bike support improvements

## [1.0.4] - 2025-12-05

### Improved
- Adaptive polling: 30 s when bike is unlocked/moving/theft alarm, 10 min otherwise
- Token refresh thread-safety in `StromerAuthService`

## [1.0.3] - 2025-12-01

### Added
- Per-device baseline settings for accurate lifetime/yearly/monthly/weekly/daily distance tracking
- Automatic baseline resets at year/month/week/day boundaries

## [1.0.2] - 2025-11-28

### Fixed
- Capability icon rendering issues
- Migration from device-level to app-level credentials

## [1.0.1] - 2025-11-24

### Changed
- Category changed from "energy" to "appliances" (App Store requirement)
- Driver icon: unique e-bike silhouette distinct from app icon
- App and driver images replaced with professional Stromer e-bike photos
- Removed "cloud" platform support (only "local" supported)
- README.txt rewritten as 2 engaging paragraphs without Flow card lists or URLs

## [1.0.0] - 2025-11-23

### Initial Release

Connect your Stromer e-bike to Homey and control it from your smart home!

**Monitor Your Bike:**
- Battery level and health tracking
- Real-time location (GPS coordinates)
- Motor and battery temperature
- Trip distance and average speed
- Total distance with custom baseline tracking
- Energy consumption statistics
- Power cycle count
- Theft alarm status

**Control Your Bike:**
- Turn lights on/off remotely
- Lock and unlock your bike
- Reset trip statistics

**Automate with Flow Cards:**
- Get alerts when battery is low
- Notifications when theft alarm activates
- Trigger actions when bike is unlocked
- Conditional logic based on battery, temperature, lock status
- Custom notifications and automation

**Smart Features:**
- Track multiple bikes independently
- Configure polling intervals per device
- Set custom distance baselines for accurate lifetime tracking
- Automatic period resets (daily, weekly, monthly, yearly)
- View all metrics in Homey Insights

**Requirements:**
- Homey Pro 2023 or later
- Stromer e-bike with account
- Stromer API credentials (see README for setup instructions)

[1.0.8]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.8
[1.0.7]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.7
[1.0.6]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.6
[1.0.5]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.5
[1.0.4]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.4
[1.0.3]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.3
[1.0.2]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.2
[1.0.1]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.1
[1.0.0]: https://github.com/wdool/stromer_homey/releases/tag/v1.0.0
