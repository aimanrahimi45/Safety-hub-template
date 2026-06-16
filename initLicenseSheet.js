/**
 * SAFETY HUB - LICENSE SHEET INITIALIZER
 * =======================================
 * 
 * This script is for DEVELOPER USE ONLY.
 * Run this once on the License Key Google Sheet to set up proper headers and formatting.
 * 
 * HOW TO USE:
 * 1. Go to: https://docs.google.com/spreadsheets/d/1FH75rDHPZniZUXbO3BpK1Lku1lA-RiNbgEQgihaNF_M
 * 2. Extensions > Apps Script
 * 3. Paste this entire script, save, and run initLicenseSheet()
 * 4. Authorize access (first time only)
 * 
 * After that, your license sheet is ready. Add keys in the rows below the header.
 */

const LICENSE_SHEET_ID = "1FH75rDHPZniZUXbO3BpK1Lku1lA-RiNbgEQgihaNF_M";

function initLicenseSheet() {
  const ss = SpreadsheetApp.openById(LICENSE_SHEET_ID);
  
  // Rename default sheet
  const sheet = ss.getSheets()[0];
  sheet.setName("License Keys");
  
  // Clear everything
  sheet.clear();
  
  // Set headers
  const headers = [
    ["License Key", "Status", "Tenant Email", "Plan Type", "Created Date", "Expiry Date"]
  ];
  const headerRange = sheet.getRange(1, 1, 1, headers[0].length);
  headerRange.setValues(headers);
  
  // Format header row
  headerRange.setFontWeight("bold")
    .setFontSize(11)
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  
  // Column widths
  sheet.setColumnWidth(1, 250); // License Key
  sheet.setColumnWidth(2, 120); // Status
  sheet.setColumnWidth(3, 280); // Tenant Email
  sheet.setColumnWidth(4, 140); // Plan Type
  sheet.setColumnWidth(5, 150); // Created Date
  sheet.setColumnWidth(6, 150); // Expiry Date
  
  // Data validation for Status column (Column B)
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["active", "revoked", "expired"], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange("B2:B").setDataValidation(statusRule);
  
  // Data validation for Plan Type column (Column D)
  const planRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["demo", "standard", "pro", "enterprise"], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange("D2:D").setDataValidation(planRule);
  
  // Add sample row with a demo key
  const today = new Date();
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  
  sheet.getRange(2, 1, 1, 6).setValues([
    ["SAFETY-DEMO-2026", "active", "demo@example.com", "demo", today, nextYear]
  ]);
  sheet.getRange(2, 1, 1, 6).setFontSize(10);
  
  // Freeze header row
  sheet.setFrozenRows(1);
  
  // Alert
  SpreadsheetApp.getUi().alert(
    "✅ License Sheet Ready!",
    "Headers and formatting complete.\n\n"
    + "What to do next:\n"
    + "1. Replace the demo row with your real keys\n"
    + "2. Status options: active, revoked, expired\n"
    + "3. Plan options: demo, standard, pro, enterprise\n"
    + "4. Add more keys in new rows below\n\n"
    + "Key format: SAFETY-XXXX-XXXX (any unique string works)",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}