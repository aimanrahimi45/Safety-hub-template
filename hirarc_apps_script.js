/**
 * GOOGLE APPS SCRIPT FOR HIRARC APPROVAL
 * 
 * Instructions:
 * 1. Open your new Google Sheet designed for HIRARC Approvals.
 * 2. Click Extensions > Apps Script.
 * 3. Delete all code and paste this entire file.
 * 4. Click Deploy > New Deployment.
 * 5. Choose "Web app", set "Who has access" to "Anyone".
 * 6. Copy the Web App URL and paste it into line 250 of hirarc.html
 */

function doPost(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    var data = JSON.parse(e.postData.contents);
    
    // This tells the script to put the data into Tab 2 ("Signed Approvals")
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Signed Approvals");
    
    // Failsafe: if the tab name is different, just use whatever is active
    if (!sheet) {
        sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    }

    var timestamp = new Date();
    
    // Now expecting 8 columns exactly!
    sheet.appendRow([
      timestamp,               // Col A: Timestamp
      data.department,         // Col B: Department
      data.owner_name,         // Col C: Area Owner Name
      data.employee_id,        // Col D: Employee ID
      data.date,               // Col E: Review Date
      data.document_version,   // Col F: Document Version (The ultra-smart CSV data!)
      data.declaration,        // Col G: ISO Acknowledgment
      data.signature           // Col H: Digital Signature (Base64)
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({"status": "success"}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      "status": "error", 
      "message": error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================================
// SECURE WEB APP GET LISTENER (DASHBOARD API)
// ========================================================
const DASHBOARD_PIN = PropertiesService.getScriptProperties().getProperty("DASHBOARD_PIN") || "9911";

function doGet(e) {
  try {
    const action = e.parameter.action;
    const pin = e.parameter.pin;
    
    // 1. DYNAMIC DROPDOWN MASTER LIST (No PIN required, only returns public department versions)
    if (action === "getMasterList") {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      // Read the first tab (usually where the Master List is placed)
      const sheet = ss.getSheets()[0];
      const rows = sheet.getDataRange().getValues();
      
      // Map to 2D array of [Col A, Col B, Col C]
      const data = rows.map(r => [
        String(r[0]).trim(), 
        r[1] ? String(r[1]).trim() : "",
        r[2] ? String(r[2]).trim() : ""
      ]);
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "SUCCESS",
        data: data
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. DASHBOARD RETRIEVAL (Requires DASHBOARD_PIN)
    if (pin !== DASHBOARD_PIN) {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "ERROR", 
        message: "Unauthorized: Invalid PIN" 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Signed Approvals") || ss.getActiveSheet();
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const data = [];
    
    for (let i = 1; i < rows.length; i++) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        let val = rows[i][j];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd HH:mm:ss");
        }
        obj[headers[j]] = val;
      }
      data.push(obj);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "SUCCESS",
      data: data
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "ERROR",
      message: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
