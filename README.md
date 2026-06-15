# 🛡️ Safety Hub - Commercial Web Portal Template

Welcome to the **Safety Hub Portal** template—a premium, fully integrated, white-labeled suite of digital safety workflows designed in accordance with **ISO 45001** standards. 

This repository contains the complete frontend web portal package and the automated Google Sheets backend script. Once configured, your portals will dynamically read and write data to a secure private Google Sheets database.

---

## 🚀 Key Modules Included
1. **Central Portal Hub (`index.html`)**: The centralized entry point with dynamic logo and company branding.
2. **First Aid Box Checklist (`first_aid.html`)**: Monthly plant inspections with signature capture and instant restock checks.
3. **First Aid Stock Monitor (`stock.html`)**: A secure dashboard to manage central cabinets and process box shortages.
4. **PPE Management (`ppe.html`)**: Log PPE requests, complete automatic 6-month duplicate issue intervals, and view visual usage analytics.
5. **Contractor Induction (`contractor.html`)**: Brief, verify, and approve contractor safety logs with live photo capture and SHO sign-off.
6. **Contractor Self-Registration (`contractor_self.html`)**: Mobile-ready portal allowing workers to register and capture signatures on their own devices.
7. **Secure Audit Dashboard (`audit.html`)**: Consolidated log search, filtering, and export logs panel.

---

## 🏗️ Technical Architecture
The system utilizes a **No-Build** serverless static web design for maximum maintainability:
* **`shared.css`**: Dynamic design system tokens (colors, gradients, premium typography). Customize this single file to change the portal themes instantly.
* **`shared.js`**: Automatically prepends sticky headers and dynamically requests branding details (Company name, logo URL) in the background to sync branding site-wide.
* **`config.js`**: Stores the single Google Apps Script deployment URL to direct all API requests.

---

## ⚡ Deployment & Setup Guide (For Buyers)

Deploying the Safety Hub takes less than 5 minutes. Follow these simple steps:

### Step 1: Initialize the Master Google Sheet
1. Open a blank **Google Sheet** (this will be your Master Safety Hub Admin sheet).
2. Click **Extensions** > **Apps Script**.
3. Clear all default script code, paste the contents of the `Safety_Hub_Backend.js` file from this repository, and click **Save** (💾).

### Step 2: Configure License & Run Setup
1. Refresh the Google Sheet. You will see a custom menu appear in the toolbar: **`🛡️ Safety Hub`**.
2. Click **`🛡️ Safety Hub`** > **`⚙️ Settings & Configuration`**.
3. In the settings sidebar:
   * Paste your **License Key** (format `SAFETY-XXXX-XXXX`).
   * Configure your custom **System Brand Name** (e.g. `Acme Safety`).
   * (Optional) Enter your custom **Company Logo Image URL** and a **4-digit Dashboard PIN**.
   * Click **Save Configuration**.
4. Click **`🛡️ Safety Hub`** > **`⚡ Initialize Workspace`**.
5. *Result*: The script will automatically create a `"Safety Hub Workspace"` folder in your Google Drive, generate four database spreadsheets inside it, link them to the Master Sheet, and list the URLs under the `"Dashboard Links"` tab.

### Step 3: Deploy as a Web App
1. Inside the Apps Script editor, click **Deploy** > **New Deployment** (top-right).
2. Choose **Web App** as the deployment type.
3. Configure the parameters:
   * **Execute as**: `Me (your email)`
   * **Who has access**: `Anyone`
4. Click **Deploy**, click **Authorize Access** (log in and click advanced approval), and copy the generated **Web App URL**.

### Step 4: Link Your Portals
1. Open the [config.js](config.js) file in your web portal folder.
2. Replace the placeholder URL with your live deployed Web App URL:
   ```javascript
   const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_LIVE_URL/exec";
   ```
3. Open `index.html` locally or deploy the files to any static web hosting (such as GitHub Pages, Netlify, or Vercel). Your portals are now live and connected!

---

## 🛡️ License Information
This template is protected by license verification. Ensure a valid buyer's key is entered in your sheet settings before running the workspace initialization script.
