// --- RUN THIS FUNCTION FIRST TO AUTHORIZE ---
// (Handover Step: Select this function from the dropdown and click 'Run' to trigger Google's permission popup)
function setupAuthorization() {
  DriveApp.getFiles();
  SpreadsheetApp.getActiveSpreadsheet();
}

// Helper to safely target the safety induction sheet by common names
function getInductionSheet(ss) {
  var names = ["Safety Inductions", "Contractor Inductions", "Sheet1"];
  for (var i = 0; i < names.length; i++) {
    var sheet = ss.getSheetByName(names[i]);
    if (sheet) return sheet;
  }
  return ss.getActiveSheet(); // fallback
}

function doPost(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getInductionSheet(ss);
    var timestamp = new Date();
    
    // Check if this is an approval request from the SHO dashboard
    if (data.action === "approveWorkers") {
      if (data.pin !== DASHBOARD_PIN) {
        return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "Unauthorized: Invalid PIN"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      var rows = sheet.getDataRange().getValues();
      var count = 0;
      var inductionDate = data.inductionDate || new Date();
      
      // Update columns for matching ICs: Induction Date (Col E/index 4), Inducted By (Col F/index 5), Status (Col J/index 9)
      // Safely matches ONLY rows that are currently "Pending Approval" to avoid duplicate test runs conflicts.
      data.workerIcs.forEach(function(ic) {
        for (var i = 1; i < rows.length; i++) {
          var rowIc = String(rows[i][2]).trim();
          var rowStatus = rows[i][9] ? String(rows[i][9]).trim().toLowerCase() : "";
          
          if (rowIc === String(ic).trim() && rowStatus === "pending approval") {
            var rowNum = i + 1;
            sheet.getRange(rowNum, 5).setValue(inductionDate); // Update Induction Date
            sheet.getRange(rowNum, 6).setValue(data.inductedBy); // Update Inducted By
            sheet.getRange(rowNum, 10).setValue("Approved"); // Update Status
            count++;
            break;
          }
        }
      });
      
      SpreadsheetApp.flush(); // Force immediate database consistency
      
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "count": count}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- GOOGLE DRIVE PHOTO SAVING LOGIC ---
    // Fetches the secure Drive Folder ID from Google Apps Script private Project Properties.
    // Configure 'FOLDER_ID' under Project Settings (⚙️) inside Apps Script!
    var FOLDER_ID = PropertiesService.getScriptProperties().getProperty("FOLDER_ID");
    var photoUrl = "";
    
    if (data.photo) {
      if (!FOLDER_ID) {
        throw new Error("Drive FOLDER_ID is not configured in your Apps Script Project Settings!");
      }
      
      // Decode the heavily compressed JPEG
      var base64Data = data.photo.split(",")[1];
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/jpeg", "Induction_" + data.name + "_" + timestamp.getTime() + ".jpg");
      
      // Save to your specific Drive folder
      var folder = DriveApp.getFolderById(FOLDER_ID);
      var file = folder.createFile(blob);
      
      // Generate a shareable link to put in the Excel sheet
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      // Use the raw image URL so the Audit Hub can render it as a picture!
      photoUrl = "https://lh3.googleusercontent.com/d/" + file.getId();
    }
    // ---------------------------------------

    // Make sure your Google Sheet has 10 columns now!
    var status = data.status || "Approved";
    sheet.appendRow([
      timestamp,         // Col A
      data.name,         // Col B
      data.ic,           // Col C
      data.company,      // Col D
      data.date,         // Col E
      data.inducted_by,  // Col F
      data.declaration,  // Col G
      data.signature,    // Col H
      photoUrl,          // Col I (The Live Photo Link!)
      status             // Col J (Status: Approved / Pending Approval)
    ]);
    
    SpreadsheetApp.flush(); // Force immediate database consistency
    
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
    
    // 1. SECURE SERVER-SIDE LOOKUP (No PIN required, only returns matching single status)
    if (action === "lookupWorker") {
      const searchIC = e.parameter.ic;
      if (!searchIC) {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "ERROR", 
          message: "IC search query is required" 
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = getInductionSheet(ss);
      const rows = sheet.getDataRange().getValues();
      
      // Col A: Timestamp, Col B: Name, Col C: IC Number
      const worker = rows.find(r => r[2] && String(r[2]).includes(searchIC));
      
      if (worker) {
        let inductionDateStr = "";
        if (worker[4] instanceof Date) {
          inductionDateStr = Utilities.formatDate(worker[4], "GMT+8", "yyyy-MM-dd");
        } else {
          inductionDateStr = String(worker[4]);
        }
        
        return ContentService.createTextOutput(JSON.stringify({
          status: "SUCCESS",
          found: true,
          name: worker[1], // Worker Name (Col B)
          date: inductionDateStr // Induction Date (Col E)
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: "SUCCESS",
          found: false
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 2. DASHBOARD RETRIEVAL (Requires DASHBOARD_PIN)
    if (pin !== DASHBOARD_PIN) {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "ERROR", 
        message: "Unauthorized: Invalid PIN" 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getInductionSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const data = [];
    
    for (let i = 1; i < rows.length; i++) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        let val = rows[i][j];
        if (val instanceof Date) {
          // Only format with full time if it is the submission Timestamp
          if (headers[j].toLowerCase().indexOf("timestamp") !== -1) {
            val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd HH:mm:ss");
          } else {
            val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
          }
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

// Relational/Relational Database Table Auto-Setup Function (DO NOT CLEAR DATA)
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getInductionSheet(ss);
  
  const headers = [
    "Timestamp", "Name", "IC Number", "Company", "Induction Date", 
    "Inducted By", "Declaration", "Signature", "Photo URL", "Status"
  ];
  
  // Format Headers on Row 1 safely (DO NOT WIPE existing logs below Row 1)
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  
  try {
    SpreadsheetApp.getUi().alert("🎉 Safety Induction Tab Setup Complete!", "Headers have been formatted safely.", SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log("🎉 Safety Induction Tab Setup Complete! Headers formatted successfully.");
  }
}
