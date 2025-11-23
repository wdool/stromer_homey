# Homey App Store Submission Guide

Your Stromer Homey app is ready for submission! Follow these steps:

## ✅ Pre-Submission Checklist

All completed:
- [x] Author information: Wout van den Dool (woutdool@gmail.com)
- [x] GitHub repository: https://github.com/wdool/stromer_homey
- [x] Community topic: https://community.homey.app/t/app-pro-stromer-speed-pedelec/145791
- [x] Brand color: Black (#000000)
- [x] App images resized (250x175, 500x350, 750x525)
- [x] CHANGELOG.md created
- [x] .gitignore created
- [x] Validates at "publish" level ✓

## 📦 Step 1: Upload to GitHub

```bash
# Navigate to your app folder
cd stromer-homey

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial release v1.0.0"

# Add remote (create the repo on GitHub first at https://github.com/wdool/stromer_homey)
git remote add origin https://github.com/wdool/stromer_homey.git

# Push to GitHub
git branch -M main
git push -u origin main

# Create release tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

## 🚀 Step 2: Submit to Homey App Store

### Option A: Via Homey CLI (Recommended)
```bash
cd stromer-homey
homey app publish
```

This will:
1. Validate your app one final time
2. Upload to Athom for review
3. Create the app listing

### Option B: Via Homey Developer Portal
1. Go to https://tools.developer.homey.app/
2. Sign in with your Athom account
3. Click "Apps" → "Create App"
4. Upload your app package

## 📸 What You'll Need for Submission

The Homey App Store will ask for:

1. **App Description** (already in app.json):
   - "Connect your Stromer e-bike to Homey"

2. **Category** (already set):
   - Energy

3. **Screenshots** (you'll need to provide):
   - Device page showing all capabilities
   - Flow card examples
   - Settings page
   - Recommended: 3-5 screenshots

4. **Support Information** (already set):
   - Support URL: https://github.com/wdool/stromer_homey/issues
   - Community Topic: 145791

## 📋 After Submission

1. **Review Process**: Athom will review your app (usually 1-2 weeks)
2. **Feedback**: Check your email for any feedback or questions
3. **Approval**: Once approved, your app will be live in the store!

## 🎯 Important Notes

- **API Credentials**: Users will need to get their Stromer `client_id` via MITM (instructions in README.md)
- **Re-pairing**: Remind users to delete and re-pair devices after updates
- **Version Updates**: For future updates, increment version in `.homeycompose/app.json` and update CHANGELOG.md

## 🐛 If Validation Fails

Run this to see specific errors:
```bash
cd stromer-homey
homey app validate --level publish
```

## 📚 Resources

- [Homey App Store Guidelines](https://apps.developer.homey.app/app-store/guidelines)
- [Homey SDK Documentation](https://apps.developer.homey.app/)
- [Community Forum Topic](https://community.homey.app/t/app-pro-stromer-speed-pedelec/145791)

---

**Good luck with your submission! 🚴‍♂️⚡**
