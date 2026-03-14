# Stromer Bike App for Homey

## Overview

This Homey app integrates Stromer e-bikes with the Homey smart home platform. It enables users to monitor their Stromer bikes' battery status, trip statistics, and location, and control features like lights and locks through Homey automation. The app supports multi-bike setups, provides custom capabilities, Flow cards for extensive automation, and integrates with Homey Insights for data logging. The primary goal is to offer seamless and secure integration of Stromer e-bikes into a smart home environment, enhancing user control and automation.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

The application is built on **Homey SDK v3** and employs a custom authentication implementation to integrate with Stromer's specific OAuth2 token acquisition process.

### Authentication
The app uses **app-level centralized authentication**, where users provide Stromer credentials once in the App Settings. The authentication flow implements OAuth2 authorization code grant with Django CSRF protection, mirroring the Home Assistant Stromer integration for secure token exchange. It handles differences between API v3 and v4 authentication requirements, particularly regarding `client_id`, `client_secret`, and `redirect_uri` parameters, and maintains session and CSRF cookies throughout the process. A `StromerAuthService` singleton manages token refresh with thread-safety.

### Device Pairing
Pairing is simplified: users configure credentials once in App Settings, and then select their bikes from a list provided by the `StromerAuthService` during device pairing.

### Data Polling
An **adaptive polling strategy** is used:
- **Standard polling**: A configurable interval (default 10 minutes) for inactive bikes.
- **Active polling**: A faster interval (default 30 seconds) when the bike is unlocked, moving, or has an active theft alarm.
This strategy optimizes data freshness against API rate limits and battery consumption.

### Capabilities and Data Model
Each bike device exposes 25 capabilities, including standard Homey capabilities (`measure_battery`, `alarm_theft`, `onoff`, `locked`) and 21 custom Stromer-specific capabilities (e.g., motor/battery temperature, various distance metrics, speed, location, energy consumption, assistance level, battery health, charge time). All capabilities are configured for Homey Insights tracking.

### Charge Time Calculation
The `stromer_charge_time` capability estimates minutes remaining to reach a configured charge target (80% or 100%), based on battery size (e.g., BQ618, BQ1440) and charger power (240 W effective). This calculation is re-evaluated on every poll and triggers a `charge_time_updated` flow card.

### Flow Card System
The app provides comprehensive automation through Homey Flow cards:
- **Triggers**: For events such as battery thresholds, bike unlock, theft alarms, distance/speed changes, and charge time updates.
- **Conditions**: For checking battery levels, lock/light states, temperature ranges, and theft alarm status.
- **Actions**: For controlling lights, locking/unlocking, resetting trip data, and sending notifications.

### Baseline Calculation System
The app implements a system to calculate period-specific distances (year, month, week, day) using manual baseline inputs from the user's Stromer app and automatically resetting these baselines based on period changes. These baselines are stored per device to support multi-bike setups.

### Error Handling and Resilience
The architecture includes automatic token refresh, exponential backoff and retry logic for API failures, and setting devices as unavailable on persistent issues to ensure graceful degradation.

### UI/UX Decisions
The app provides a custom HTML page for app settings (email, password, client_id) and utilizes `driver.compose.json` for per-bike settings, such as distance baselines. Capability icons are displayed correctly, including custom State of Charge and theft alarm icons.

## External Dependencies

### Stromer API
- **Base URL**: `https://api3.stromer-portal.ch`
- **Authentication**: OAuth2 authorization code grant with Django CSRF protection.
- **Endpoints**: V4 (`/mobile/v4/login/`, `/mobile/v4/o/authorize/`, `/mobile/v4/o/token/`) and V3 (`/users/login/`, `/o/authorize/`, `/o/token/`) login/auth flows.
- **Data Endpoints**: `/rapi/mobile/v4.1/` (v4) or `/rapi/mobile/v2/` (v3).
- **Note**: `client_id` is obtained via MITM interception of the official Stromer mobile app; `client_secret` is specific to v3.

### NPM Packages
- **node-fetch**: Used for making HTTP API requests.

### Runtime Platform
- **Homey Pro 2023+**: Required for SDK v3 compatibility.
- **Node.js**: The underlying runtime environment provided by Homey.