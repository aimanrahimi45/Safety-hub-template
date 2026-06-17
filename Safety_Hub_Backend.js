/**
 * SAFETY HUB PORTAL - UNIFIED BACKEND CONTROLLER
 * 
 * Google Workspace Marketplace Add-on Release (Multi-Tenant Option A)
 * 
 * Setup Instructions (For Developer):
 * 1. Deploy this script once as a Web App from your developer account.
 *    - Execute as: "Me"
 *    - Access: "Anyone"
 * 2. Configure this Web App URL inside the portals' config.js.
 * 3. Publish this script as a Google Workspace Sheets Add-on.
 * 
 * Setup Instructions (For Clients):
 * 1. Install the "Safety Hub" Add-on from the Marketplace.
 * 2. Open any blank spreadsheet, select "Extensions" > "Safety Hub" > "Settings & Configuration".
 * 3. Enter your license key and save.
 * 4. Select "Extensions" > "Safety Hub" > "Initialize Workspace" to generate database files.
 */

// ========================================================
// 1. ADD-ON INSTALL & SPREADSHEET OPEN TRIGGER
// ========================================================
function onInstall(e) {
  onOpen(e);
}

function onOpen(e) {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛡️ Safety Hub')
      .addItem('⚡ Initialize Workspace', 'setupWorkspace')
      .addItem('⚙️ Settings & Configuration', 'showSettingsSidebar')
      .addItem('🎨 Format Settings Tab', 'manualFormatSettings')
      .addToUi();
}

// ========================================================
// 2. DYNAMIC SYSTEM INITIALIZATION (WORKSPACE SETUP)
// ========================================================
function setupWorkspace() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSystemSettings(ss);
  
  // Verify License Key before creating workspace
  const licenseKey = settings["LICENSE_KEY"] || "";
  let licenseCheck = { valid: false, planType: "Free", reason: "No key supplied" };
  
  if (licenseKey) {
    licenseCheck = validateLicenseKey(licenseKey);
  }
  
  // Instead of blocking, we initialize in Free Mode if license is invalid/missing
  if (!licenseCheck.valid) {
    setSystemSetting(ss, "PLAN_TYPE", "Free");
    try {
      SpreadsheetApp.getUi().alert("ℹ️ Workspace Setup - Free Mode", "No valid license key was detected. The workspace will be initialized under the FREE tier plan.\n\nAdvanced features (such as custom branding) will require entering a valid key in the Settings sidebar.", SpreadsheetApp.getUi().ButtonSet.OK);
    } catch(e) {
      Logger.log("Workspace Setup: Initializing under FREE tier.");
    }
  } else {
    // Valid license key
    setSystemSetting(ss, "PLAN_TYPE", licenseCheck.planType || "Premium");
    try {
      SpreadsheetApp.getUi().alert("✅ Workspace Setup - " + (licenseCheck.planType || "Premium") + " Mode", "Valid license key detected. The workspace will be initialized under the " + (licenseCheck.planType || "Premium") + " plan.", SpreadsheetApp.getUi().ButtonSet.OK);
    } catch(e) {
      Logger.log("Workspace Setup: Initializing under " + (licenseCheck.planType || "Premium") + " plan.");
    }
  }
  
  // A. Create/Find central Drive folder
  let folderId = settings["WORKSPACE_FOLDER_ID"];
  let folder;
  if (folderId) {
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (err) {
      folderId = null;
    }
  }
  if (!folderId) {
    folder = DriveApp.createFolder(settings["SYSTEM_NAME"] + " Workspace");
    folderId = folder.getId();
    setSystemSetting(ss, "WORKSPACE_FOLDER_ID", folderId);
  }
  
  // B. Setup First Aid Spreadsheet
  let faId = settings["FIRST_AID_SPREADSHEET_ID"];
  let faFile;
  if (faId) {
    try {
      faFile = SpreadsheetApp.openById(faId);
    } catch (err) {
      faId = null;
    }
  }
  if (!faId) {
    const newSS = SpreadsheetApp.create("First Aid System");
    const file = DriveApp.getFileById(newSS.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    faFile = newSS;
    setSystemSetting(ss, "FIRST_AID_SPREADSHEET_ID", newSS.getId());
  }
  initializeFirstAidSheets(faFile);
 
  // C. Setup PPE Spreadsheet
  let ppeId = settings["PPE_SPREADSHEET_ID"];
  let ppeFile;
  if (ppeId) {
    try {
      ppeFile = SpreadsheetApp.openById(ppeId);
    } catch (err) {
      ppeId = null;
    }
  }
  if (!ppeId) {
    const newSS = SpreadsheetApp.create("PPE System");
    const file = DriveApp.getFileById(newSS.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    ppeFile = newSS;
    setSystemSetting(ss, "PPE_SPREADSHEET_ID", newSS.getId());
  }
  initializePpeSheets(ppeFile);
 
  // D. Setup Contractor Spreadsheet
  let contractorId = settings["CONTRACTOR_SPREADSHEET_ID"];
  let contractorFile;
  if (contractorId) {
    try {
      contractorFile = SpreadsheetApp.openById(contractorId);
    } catch (err) {
      contractorId = null;
    }
  }
  if (!contractorId) {
    const newSS = SpreadsheetApp.create("Contractor System");
    const file = DriveApp.getFileById(newSS.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    contractorFile = newSS;
    setSystemSetting(ss, "CONTRACTOR_SPREADSHEET_ID", newSS.getId());
  }
  initializeContractorSheets(contractorFile);
  
  // E. Setup Incident Spreadsheet
  let incidentId = settings["INCIDENT_SPREADSHEET_ID"];
  let incidentFile;
  if (incidentId) {
    try {
      incidentFile = SpreadsheetApp.openById(incidentId);
    } catch (err) {
      incidentId = null;
    }
  }
  if (!incidentId) {
    const newSS = SpreadsheetApp.create("Incident System");
    const file = DriveApp.getFileById(newSS.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    incidentFile = newSS;
    setSystemSetting(ss, "INCIDENT_SPREADSHEET_ID", newSS.getId());
  }
  initializeIncidentSheets(incidentFile);
  
  // Format master control tab
  let masterSheet = ss.getSheetByName("Dashboard Links");
  if (!masterSheet) masterSheet = ss.insertSheet("Dashboard Links");
  masterSheet.clear();
  masterSheet.appendRow(["System Configuration Panel", "Values / Links"]);
  masterSheet.appendRow(["Workspace Parent Folder", folder.getUrl()]);
  masterSheet.appendRow(["First Aid Database", faFile.getUrl()]);
  masterSheet.appendRow(["PPE Database", ppeFile.getUrl()]);
  masterSheet.appendRow(["Contractor Database", contractorFile.getUrl()]);
  masterSheet.appendRow(["Incident Database", incidentFile.getUrl()]);
  masterSheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  masterSheet.autoResizeColumns(1, 2);
 
  try {
    SpreadsheetApp.getUi().alert("🎉 Safety Hub Workspace Ready!", "Created folder '" + settings["SYSTEM_NAME"] + " Workspace' and initialized all database sheets inside it.\n\nConnection URL settings are fully configured.", SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log("🎉 Safety Hub Workspace Ready!");
  }
}
 
// --- SUB-SYSTEM SHEET INITIALIZERS ---
 
function initializeFirstAidSheets(ss) {
  const defSheet = ss.getSheetByName("Sheet1");
  
  // 1. Checklist Logs
  let logsSheet = ss.getSheetByName("First Aid Checklist Logs") || ss.insertSheet("First Aid Checklist Logs");
  const logHeaders = ["Audit ID", "Timestamp", "Date of Inspection", "Company", "Department", "Section", "Box ID", "Location", "Cleanliness Condition", "Cleanliness Remarks", "Inspection Findings", "Inspected By Name", "Inspected By Position", "Signature URL"];
  logsSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
  logsSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  logsSheet.setFrozenRows(1);
  
  // 2. Checklist Details
  let detailsSheet = ss.getSheetByName("First Aid Checklist Details") || ss.insertSheet("First Aid Checklist Details");
  const detailHeaders = ["Audit ID", "Item ID", "Item Name", "Required Standard", "Quantity Available", "Expiry Date", "Remarks", "Box ID", "Date of Inspection"];
  detailsSheet.getRange(1, 1, 1, detailHeaders.length).setValues([detailHeaders]);
  detailsSheet.getRange(1, 1, 1, detailHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  detailsSheet.setFrozenRows(1);
 
  // 3. Central Inventory
  let invSheet = ss.getSheetByName("First Aid Central Inventory") || ss.insertSheet("First Aid Central Inventory");
  const invHeaders = ["Item ID", "Item Name", "Unit", "Current Stock", "Min Alert Level", "Required Std", "Category Group", "Last Updated"];
  invSheet.getRange(1, 1, 1, invHeaders.length).setValues([invHeaders]);
  invSheet.getRange(1, 1, 1, invHeaders.length).setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  invSheet.setFrozenRows(1);
 
  if (invSheet.getLastRow() <= 1) {
    const defaultInventory = [
      [1, "Triangular Bandage 100cm", "pcs", 0, 10, "5pcs", 1, new Date()],
      [2, "Eye Dressing No 16", "pkt", 0, 5, "3pkt", 1, new Date()],
      [3, "Sterile Gamgee Pad 25cm", "pkt", 0, 5, "3pkt", 1, new Date()],
      [4, "Sterile Gauze Pad 7.5cm", "pkt", 0, 10, "6pkt", 1, new Date()],
      [5, "Sterile Gauze Pad 10cm", "pkt", 0, 10, "6pkt", 1, new Date()],
      [6, "Elastic Bandage", "pkt", 0, 5, "3pkt", 1, new Date()],
      [7, "W.O.W Bandage 2.5cm", "pcs", 0, 15, "8pcs", 1, new Date()],
      [8, "W.O.W Bandage 5.0cm", "pcs", 0, 15, "8pcs", 1, new Date()],
      [9, "W.O.W Bandage 7.5cm", "pcs", 0, 15, "8pcs", 1, new Date()],
      [10, "Instant Ice Pack", "pkt", 0, 10, "6pkt", 2, new Date()],
      [11, "Sterile Non-Adherent Pad", "pkt", 0, 10, "6pkt", 2, new Date()],
      [12, "Pair of Glove", "pkt", 0, 10, "6pkt", 2, new Date()],
      [13, "Scissors", "pcs", 0, 2, "1pcs", 3, new Date()],
      [14, "Adhesive Tape", "pcs", 0, 5, "1pcs", 2, new Date()],
      [15, "Bactigras", "pcs", 0, 5, "2pcs", 2, new Date()],
      [16, "Yellow Antiseptic Liquid", "pcs", 0, 2, "1pcs", 3, new Date()],
      [17, "Cotton Bud 100pcs", "pkt", 0, 5, "1pkt", 2, new Date()],
      [18, "CPR Face Shield", "pcs", 0, 5, "3pcs", 1, new Date()],
      [19, "Adhesive Plaster", "pcs", 0, 100, "60pcs", 1, new Date()],
      [20, "Safety Pin", "pcs", 0, 50, "36pcs", 1, new Date()],
      [21, "Thermometer", "pcs", 0, 2, "1pcs", 3, new Date()],
      [22, "Waste Bag", "pcs", 0, 10, "3pcs", 3, new Date()],
      [23, "First Aid Manual", "pcs", 0, 2, "1pcs", 3, new Date()]
    ];
    invSheet.getRange(2, 1, defaultInventory.length, invHeaders.length).setValues(defaultInventory);
  }
 
  // 4. Transactions
  let transSheet = ss.getSheetByName("First Aid Inventory Transactions") || ss.insertSheet("First Aid Inventory Transactions");
  const transHeaders = ["Timestamp", "ActionType", "Item ID", "Item Name", "QuantityChanged", "Box ID / Notes", "Logged By"];
  transSheet.getRange(1, 1, 1, transHeaders.length).setValues([transHeaders]);
  transSheet.getRange(1, 1, 1, transHeaders.length).setFontWeight("bold").setBackground("#374151").setFontColor("#ffffff");
  transSheet.setFrozenRows(1);
  
  if (defSheet) ss.deleteSheet(defSheet);
}
 
function initializePpeSheets(ss) {
  const defSheet = ss.getSheetByName("Sheet1");
  let sheet = ss.getSheetByName("PPE Requests") || ss.insertSheet("PPE Requests");
  const headers = ["Request ID", "Timestamp", "Staff ID", "Staff Name", "Department", "Supervisor Name", "PPE Type", "Size", "Color/Specs", "Replacement Reason", "Condition Remarks", "Status", "Authorized By", "Action Date"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  if (defSheet) ss.deleteSheet(defSheet);
}
 
function initializeContractorSheets(ss) {
  const defSheet = ss.getSheetByName("Sheet1");
  
  // 1. Safety Inductions Log
  let indSheet = ss.getSheetByName("Safety Inductions") || ss.insertSheet("Safety Inductions");
  const indHeaders = ["Timestamp", "Name", "IC Number", "Company", "Induction Date", "Inducted By", "Declaration", "Signature", "Photo URL", "Status"];
  indSheet.getRange(1, 1, 1, indHeaders.length).setValues([indHeaders]);
  indSheet.getRange(1, 1, 1, indHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  indSheet.setFrozenRows(1);
  
  if (defSheet) ss.deleteSheet(defSheet);
}

function initializeIncidentSheets(ss) {
  const defSheet = ss.getSheetByName("Sheet1");
  let logsSheet = ss.getSheetByName("Incidents") || ss.insertSheet("Incidents");
  const logHeaders = ["Incident ID", "Timestamp", "Date & Time", "Victim Name", "Location / Dept", "Body Part Injured", "Man-days Lost", "Reported to JKKP?", "Severity Type", "Incident Investigation Submitted?", "Description"];
  logsSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
  logsSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#991b1b").setFontColor("#ffffff");
  logsSheet.setFrozenRows(1);
  
  if (defSheet) {
    try { ss.deleteSheet(defSheet); } catch(e) {}
  }
}
 
 
// ========================================================
// 3. UNIFIED GET ROUTER (READ API - MULTI-TENANT)
// ========================================================
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    // License validation — does NOT need spreadsheetId (runs as developer)
    if (action === "validateLicense") {
      const key = e.parameter.key || "";
      const cleanKey = String(key).trim();
      
      if (!cleanKey) {
        return returnJSON({ status: "SUCCESS", valid: false, message: "License key is required." });
      }
      
      try {
        const licenseSS = SpreadsheetApp.openById(LICENSE_SHEET_ID);
        const sheet = licenseSS.getSheets()[0];
        const rows = sheet.getDataRange().getValues();
        
        for (let i = 1; i < rows.length; i++) {
          const rowKey = String(rows[i][0] || "").trim();
          const status = String(rows[i][1] || "").trim().toLowerCase();
          
          if (rowKey === cleanKey) {
            if (status === "active") {
              return returnJSON({
                status: "SUCCESS",
                valid: true,
                planType: rows[i][3] || "standard",
                expiry: rows[i][5] || ""
              });
            } else if (status === "revoked" || status === "expired") {
              return returnJSON({ status: "SUCCESS", valid: false, message: "License key has been " + status + "." });
            } else {
              return returnJSON({ status: "SUCCESS", valid: false, message: "License key status: " + status });
            }
          }
        }
        
        return returnJSON({ status: "SUCCESS", valid: false, message: "License key not found." });
      } catch (err) {
        Logger.log("License validation error: " + err.message);
        return returnJSON({ status: "SUCCESS", valid: false, message: "Unable to verify license." });
      }
    }

    const spreadsheetId = e.parameter.spreadsheetId;

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const settings = getSystemSettings(ss);
    const systemPIN = settings["DASHBOARD_PIN"] || "9911";
    
    // ----------------------------------------------------
    // PUBLIC ACTIONS (No PIN required)
    // ----------------------------------------------------
    
    // Dynamic Box IDs lookup
    if (action === "getBoxIds") {
      const boxIds = settings["BOX_IDS"] || "OSH/FAB/01,OSH/FAB/02,OSH/FAB/03,OSH/FAB/04,OSH/FAB/05,OSH/FAB/06,OSH/FAB/07";
      return returnJSON({ status: "SUCCESS", data: boxIds.split(",") });
    }

    // Public First Aid Items lookup for inspection checklist
    if (action === "getFirstAidItems") {
      const ssId = settings["FIRST_AID_SPREADSHEET_ID"];
      if (!ssId) {
        return returnJSON({ status: "ERROR", message: "First Aid database not provisioned." });
      }
      const targetSS = SpreadsheetApp.openById(ssId);
      const sheet = getSheetSafe(targetSS, "First Aid Central Inventory");
      return returnJSON({ status: "SUCCESS", data: fetchSheetDataAsJSON(sheet) });
    }
    
    // Look up Contractor Induction Status
    if (action === "lookupWorker") {
      const searchIC = e.parameter.ic;
      const ssId = settings["CONTRACTOR_SPREADSHEET_ID"];
      if (!ssId) return returnJSON({ status: "ERROR", message: "Contractor database not provisioned." });
      
      const contractorSS = SpreadsheetApp.openById(ssId);
      const sheet = contractorSS.getSheetByName("Safety Inductions") || contractorSS.getSheets()[0];
      const rows = sheet.getDataRange().getValues();
      const worker = rows.find(r => r[2] && String(r[2]).includes(searchIC));
      
      if (worker) {
        let inductionDateStr = (worker[4] instanceof Date) ? Utilities.formatDate(worker[4], "GMT+8", "yyyy-MM-dd") : String(worker[4]);
        return returnJSON({
          status: "SUCCESS",
          found: true,
          name: worker[1],
          date: inductionDateStr
        });
      } else {
        return returnJSON({ status: "SUCCESS", found: false });
      }
    }
    
 
    // Smart 6-Month PPE Issue warning check
    if (action === "checkLastIssue") {
      const staffId = e.parameter.staffId;
      const ppeType = e.parameter.ppeType;
      const ssId = settings["PPE_SPREADSHEET_ID"];
      if (!ssId) return returnJSON({ status: "ERROR", message: "PPE database not provisioned." });
      
      const ppeSS = SpreadsheetApp.openById(ssId);
      const sheet = ppeSS.getSheetByName("PPE Requests") || ppeSS.getSheets()[0];
      const rows = sheet.getDataRange().getValues();
      let lastIssueDateObj = null;
      
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowStaffId = String(rows[i][2]).trim().toLowerCase();
        const rowPpeType = String(rows[i][6]).trim().toLowerCase();
        const rowStatus = String(rows[i][11]).trim().toLowerCase();
        
        if (rowStaffId === staffId.trim().toLowerCase() && 
            rowPpeType === ppeType.trim().toLowerCase() && 
            rowStatus.indexOf("approved") !== -1) {
          const dateVal = rows[i][13] || rows[i][1];
          if (dateVal instanceof Date) {
            lastIssueDateObj = dateVal;
            break;
          }
        }
      }
      
      if (lastIssueDateObj) {
        const diffMonths = (new Date().getFullYear() - lastIssueDateObj.getFullYear()) * 12 + (new Date().getMonth() - lastIssueDateObj.getMonth());
        return returnJSON({
          status: "SUCCESS",
          found: true,
          lastDate: Utilities.formatDate(lastIssueDateObj, "GMT+8", "yyyy-MM-dd"),
          diffMonths: diffMonths
        });
      } else {
        return returnJSON({ status: "SUCCESS", found: false });
      }
    }
    
    // Get Portal Branding Configuration
    if (action === "getBranding") {
      return returnJSON({
        status: "SUCCESS",
        systemName: settings["SYSTEM_NAME"] || "Safety Hub",
        logoUrl: settings["LOGO_URL"] || "",
        departments: settings["DEPARTMENTS"] || "Production,Maintenance,QA/QC,Warehouse,Safety/HR,Engineering,Electrical,Security,Recycle,DIP,Wire Drawing,Logistic,Finance,Purchasing,MFP,Admin,Contractor,Others",
        ppeTypes: settings["PPE_TYPES"] || "Safety Shoe,Safety Helmet,Respirator,Earmuff,Filter Cartridge,Other",
        contractorDeclaration: settings["CONTRACTOR_DECLARATION"] || "Agreed: Emergency Evac, PPE Rules, Incident Reporting"
      });
    }
 
    // ----------------------------------------------------
    // SECURE ACTIONS (Requires PIN validation)
    // ----------------------------------------------------
    const pin = e.parameter.pin;
    if (pin !== systemPIN) {
      return returnJSON({ status: "ERROR", message: "Unauthorized PIN" });
    }
    
    // Fetch logs for the secure Audit Dashboard
    if (action === "getLogs") {
      const db = e.parameter.db;
      let ssId;
      let sheetName;
      
      if (db === "First Aid") {
        ssId = settings["FIRST_AID_SPREADSHEET_ID"];
        sheetName = "First Aid Checklist Logs";
      } else if (db === "PPE") {
        ssId = settings["PPE_SPREADSHEET_ID"];
        sheetName = "PPE Requests";
      } else if (db === "Contractor") {
        ssId = settings["CONTRACTOR_SPREADSHEET_ID"];
        sheetName = "Safety Inductions";
      } else if (db === "Incident") {
        ssId = settings["INCIDENT_SPREADSHEET_ID"];
        sheetName = "Incidents";
      }
      
      if (!ssId) return returnJSON({ status: "ERROR", message: "Database ID missing for " + db });
      
      const targetSS = SpreadsheetApp.openById(ssId);
      const sheet = getSheetSafe(targetSS, sheetName);
      return returnJSON({ 
        status: "SUCCESS", 
        data: fetchSheetDataAsJSON(sheet),
        spreadsheetId: ssId,
        spreadsheetUrl: targetSS.getUrl()
      });
    }
    
    // Get First Aid logs details
    if (action === "getDetails") {
      const ssId = settings["FIRST_AID_SPREADSHEET_ID"];
      const targetSS = SpreadsheetApp.openById(ssId);
      const sheet = getSheetSafe(targetSS, "First Aid Checklist Details");
      return returnJSON({ status: "SUCCESS", data: fetchSheetDataAsJSON(sheet) });
    }
    
    // Get Central Inventory stock
    if (action === "getInventory") {
      const ssId = settings["FIRST_AID_SPREADSHEET_ID"];
      const targetSS = SpreadsheetApp.openById(ssId);
      const sheet = getSheetSafe(targetSS, "First Aid Central Inventory");
      return returnJSON({ status: "SUCCESS", data: fetchSheetDataAsJSON(sheet) });
    }
    
    // Get consolidated shortages list (Replenishment Planner)
    if (action === "getShortages") {
      const ssId = settings["FIRST_AID_SPREADSHEET_ID"];
      const targetSS = SpreadsheetApp.openById(ssId);
      const logsSheet = getSheetSafe(targetSS, "First Aid Checklist Logs");
      const detailsSheet = getSheetSafe(targetSS, "First Aid Checklist Details");
      
      const logRows = logsSheet.getDataRange().getValues();
      const detailRows = detailsSheet.getDataRange().getValues();
      
      const boxLatestAudit = {};
      const boxLatestDate = {};
      
      for (let i = 1; i < logRows.length; i++) {
        const auditId = logRows[i][0];
        const dateStr = logRows[i][2];
        const boxId = logRows[i][6];
        const dateObj = new Date(dateStr);
        
        if (!boxLatestDate[boxId] || dateObj > boxLatestDate[boxId]) {
          boxLatestDate[boxId] = dateObj;
          boxLatestAudit[boxId] = auditId;
        }
      }
      
      const shortages = [];
      for (let i = 1; i < detailRows.length; i++) {
        const auditId = detailRows[i][0];
        const itemId = parseInt(detailRows[i][1], 10);
        const itemName = detailRows[i][2];
        const reqStr = detailRows[i][3];
        const availVal = parseInt(detailRows[i][4], 10) || 0;
        const boxId = Object.keys(boxLatestAudit).find(key => boxLatestAudit[key] === auditId);
        
        if (boxId) {
          const reqVal = parseInt((reqStr.match(/^(\d+)/) || ["0"])[1], 10) || 0;
          if (availVal < reqVal) {
            shortages.push({
              boxId: boxId,
              auditId: auditId,
              itemId: itemId,
              itemName: itemName,
              required: reqVal,
              available: availVal,
              shortage: reqVal - availVal
            });
          }
        }
      }
      return returnJSON({ status: "SUCCESS", shortages: shortages });
    }

    return returnJSON({ status: "ERROR", message: "Invalid Action" });
  } catch (err) {
    return returnJSON({ status: "ERROR", message: err.message });
  }
}
 
// ========================================================
// 4. UNIFIED POST ROUTER (SUBMISSIONS & UPDATES - MULTI-TENANT)
// ========================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const spreadsheetId = data.spreadsheetId;

    if (!spreadsheetId) {
      return returnJSON({ status: "ERROR", message: "Missing Spreadsheet ID" });
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const settings = getSystemSettings(ss);
    const systemPIN = settings["DASHBOARD_PIN"] || "9911";
    
    // A. First Aid Checklist Submission
    if (data.action === "firstAidForm") {
      return runTransaction(() => {
        const ssId = settings["FIRST_AID_SPREADSHEET_ID"];
        const targetSS = SpreadsheetApp.openById(ssId);
        const logsSheet = getSheetSafe(targetSS, "First Aid Checklist Logs");
        const detailsSheet = getSheetSafe(targetSS, "First Aid Checklist Details");
        const invSheet = getSheetSafe(targetSS, "First Aid Central Inventory");
        const transSheet = getSheetSafe(targetSS, "First Aid Inventory Transactions");
        
        // Auto folder setup for signatures
        let folderId = settings["SIGNATURE_FOLDER_ID"];
        let folder;
        if (folderId) {
          try { folder = DriveApp.getFolderById(folderId); } catch (err) { folderId = null; }
        }
        if (!folderId) {
          const workspaceId = settings["WORKSPACE_FOLDER_ID"];
          const workspace = workspaceId ? DriveApp.getFolderById(workspaceId) : DriveApp.getRootFolder();
          folder = workspace.createFolder(settings["SYSTEM_NAME"] + " Signatures");
          setSystemSetting(ss, "SIGNATURE_FOLDER_ID", folder.getId());
        }
        
        let signatureUrl = "";
        if (data.signature && data.signature.includes(",")) {
          const blob = Utilities.newBlob(Utilities.base64Decode(data.signature.split(",")[1]), "image/png", `Sig_${data.boxId.replace(/\//g, '_')}_${data.inspectDate}.png`);
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          signatureUrl = file.getUrl();
        }
        
        const auditId = "FA-" + String(logsSheet.getLastRow()).padStart(5, '0');
        const cleanCond = data.cleanliness || data[`item_24_avail`] || "Good";
        const cleanRem = data.cleanlinessRemarks || data[`item_24_remarks`] || "-";
   
        logsSheet.appendRow([
          auditId, new Date(), data.inspectDate, data.company, data.department, data.section,
          data.boxId, data.location, cleanCond, cleanRem, data.findings || "-",
          data.officerName || "-", data.officerPos || "-", signatureUrl
        ]);
        
        let submissionItems = [];
        if (data.items && Array.isArray(data.items)) {
          submissionItems = data.items;
        } else {
          // Fallback to support older frontend flat-parameters format
          const defaultItems = [
            { id: 1, name: "Triangular Bandage 100cm", req: "5pcs" },
            { id: 2, name: "Eye Dressing No 16", req: "3pkt" },
            { id: 3, name: "Sterile Gamgee Pad 25cm", req: "3pkt" },
            { id: 4, name: "Sterile Gauze Pad 7.5cm", req: "6pkt" },
            { id: 5, name: "Sterile Gauze Pad 10cm", req: "6pkt" },
            { id: 6, name: "Elastic Bandage", req: "3pkt" },
            { id: 7, name: "W.O.W Bandage 2.5cm", req: "8pcs" },
            { id: 8, name: "W.O.W Bandage 5.0cm", req: "8pcs" },
            { id: 9, name: "W.O.W Bandage 7.5cm", req: "8pcs" },
            { id: 10, name: "Instant Ice Pack", req: "6pkt" },
            { id: 11, name: "Sterile Non-Adherent Pad", req: "6pkt" },
            { id: 12, name: "Pair of Glove", req: "6pkt" },
            { id: 13, name: "Scissors", req: "1pcs" },
            { id: 14, name: "Adhesive Tape", req: "1pcs" },
            { id: 15, name: "Bactigras", req: "2pcs" },
            { id: 16, name: "Yellow Antiseptic Liquid", req: "1pcs" },
            { id: 17, name: "Cotton Bud 100pcs", req: "1pkt" },
            { id: 18, name: "CPR Face Shield", req: "3pcs" },
            { id: 19, name: "Adhesive Plaster", req: "60pcs" },
            { id: 20, name: "Safety Pin", req: "36pcs" },
            { id: 21, name: "Thermometer", req: "1pcs" },
            { id: 22, name: "Waste Bag", req: "3pcs" },
            { id: 23, name: "First Aid Manual", req: "1pcs" }
          ];
          defaultItems.forEach(item => {
            submissionItems.push({
              id: item.id,
              name: item.name,
              req: item.req,
              avail: data[`item_${item.id}_avail`],
              exp: data[`item_${item.id}_exp`],
              remarks: data[`item_${item.id}_remarks`]
            });
          });
        }
   
        const stockMap = getCentralStockMap(targetSS);
        const instantRestock = data.instantRestock === true;
        
        submissionItems.forEach(item => {
          const inputVal = parseInt(item.avail, 10) || 0;
          const reqVal = parseInt(item.req.match(/^(\d+)/)[1], 10) || 0;
          const exp = item.exp || "-";
          const remarksValue = item.remarks || "-";
          let finalAvail = inputVal;
   
          if (instantRestock && inputVal < reqVal) {
            const shortage = reqVal - inputVal;
            const itemInfo = stockMap[item.id];
            if (itemInfo) {
              invSheet.getRange(itemInfo.rowIdx, 4).setValue(Math.max(0, itemInfo.stock - shortage));
              invSheet.getRange(itemInfo.rowIdx, 6).setValue(new Date());
              transSheet.appendRow([new Date(), "DISPATCH", item.id, item.name, -shortage, `Refill Box ${data.boxId} (Inspection)`, data.officerName || "Safety Officer"]);
            }
            finalAvail = reqVal;
          }
   
          detailsSheet.appendRow([auditId, item.id, item.name, item.req, finalAvail, exp, remarksValue, data.boxId, data.inspectDate]);
        });
        return returnText("SUCCESS");
      });
    }
   
    // B. First Aid Inventory Adjustment
    if (data.action === "updateInventory") {
      if (String(data.pin).trim() !== String(systemPIN).trim()) return returnText("ERROR: Unauthorized");
      return runTransaction(() => {
        const ssId = settings["FIRST_AID_SPREADSHEET_ID"];
        const targetSS = SpreadsheetApp.openById(ssId);
        const invSheet = getSheetSafe(targetSS, "First Aid Central Inventory");
        const transSheet = getSheetSafe(targetSS, "First Aid Inventory Transactions");
        const stockMap = getCentralStockMap(targetSS);
        
        data.adjustments.forEach(adj => {
          const itemInfo = stockMap[adj.itemId];
          if (itemInfo) {
            const newQty = Math.max(0, itemInfo.stock + adj.qty);
            invSheet.getRange(itemInfo.rowIdx, 4).setValue(newQty);
            invSheet.getRange(itemInfo.rowIdx, 6).setValue(new Date());
            transSheet.appendRow([new Date(), adj.qty > 0 ? "RESTOCK" : "DISPATCH", adj.itemId, itemInfo.name, adj.qty, adj.notes || "Dashboard Stock Update", adj.user || "Safety Admin"]);
          }
        });
        return returnText("SUCCESS");
      });
    }
   
    // C. PPE Request Log
    if (data.action === "ppeForm") {
      return runTransaction(() => {
        const ssId = settings["PPE_SPREADSHEET_ID"];
        const targetSS = SpreadsheetApp.openById(ssId);
        const sheet = getSheetSafe(targetSS, "PPE Requests");
        const requestId = "REQ-" + String(sheet.getLastRow()).padStart(5, '0');
        const status = data.status || "Approved / Dispatched";
        const actionDate = (status !== "Pending Approval") ? Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd") : "";
        const authorizedBy = (status !== "Pending Approval") ? (data.authorizedBy || "Safety Officer") : "";
        
        sheet.appendRow([
          requestId, new Date(), data.staffId, data.staffName, data.department, data.supervisorName || "SHO",
          data.ppeType, data.size || "-", data.colorSpecs || "-", data.replacementReason || "Damaged",
          data.conditionRemarks || "-", status, authorizedBy, actionDate
        ]);
        return returnJSON({ status: "SUCCESS", requestId: requestId });
      });
    }
   
    // D. PPE Approval Status Update
    if (data.action === "updateRequestStatus") {
      if (String(data.pin).trim() !== String(systemPIN).trim()) {
        return returnJSON({ status: "ERROR", message: "Unauthorized PIN" });
      }
      return runTransaction(() => {
        const ssId = settings["PPE_SPREADSHEET_ID"];
        const targetSS = SpreadsheetApp.openById(ssId);
        const sheet = getSheetSafe(targetSS, "PPE Requests");
        const rows = sheet.getDataRange().getValues();
        let foundRow = -1;
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0]).trim() === String(data.requestId).trim()) {
            foundRow = i + 1;
            break;
          }
        }
        if (foundRow !== -1) {
          sheet.getRange(foundRow, 12).setValue(data.status);
          sheet.getRange(foundRow, 13).setValue(data.authorizedBy);
          sheet.getRange(foundRow, 14).setValue(Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd"));
          return returnJSON({ status: "SUCCESS", message: "Status updated" });
        }
        return returnJSON({ status: "ERROR", message: "Request ID not found" });
      });
    }
   
    // E. Contractor Self-Registration Form
    if (data.action === "contractorRegistrationForm") {
      return runTransaction(() => {
        const ssId = settings["CONTRACTOR_SPREADSHEET_ID"];
        const targetSS = SpreadsheetApp.openById(ssId);
        const sheet = getSheetSafe(targetSS, "Safety Inductions");
        
        let folderId = settings["PHOTO_FOLDER_ID"];
        let folder;
        if (folderId) {
          try { folder = DriveApp.getFolderById(folderId); } catch (err) { folderId = null; }
        }
        if (!folderId) {
          const workspaceId = settings["WORKSPACE_FOLDER_ID"];
          const workspace = workspaceId ? DriveApp.getFolderById(workspaceId) : DriveApp.getRootFolder();
          folder = workspace.createFolder(settings["SYSTEM_NAME"] + " Photos");
          setSystemSetting(ss, "PHOTO_FOLDER_ID", folder.getId());
        }
        
        let photoUrl = "";
        if (data.photo && data.photo.includes(",")) {
          const blob = Utilities.newBlob(Utilities.base64Decode(data.photo.split(",")[1]), "image/jpeg", "Induction_" + data.name + "_" + new Date().getTime() + ".jpg");
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          photoUrl = "https://lh3.googleusercontent.com/d/" + file.getId();
        }
        
        sheet.appendRow([new Date(), data.name, data.ic, data.company, data.date, data.inducted_by, data.declaration, data.signature, photoUrl, data.status || "Pending Approval"]);
        return returnJSON({ status: "success" });
      });
    }
   
    // F. Contractor Approval
    if (data.action === "approveWorkers") {
      if (String(data.pin).trim() !== String(systemPIN).trim()) return returnJSON({ status: "error", message: "Unauthorized PIN" });
      return runTransaction(() => {
        const ssId = settings["CONTRACTOR_SPREADSHEET_ID"];
        const targetSS = SpreadsheetApp.openById(ssId);
        const sheet = getSheetSafe(targetSS, "Safety Inductions");
        const rows = sheet.getDataRange().getValues();
        let count = 0;
        
        data.workerIcs.forEach(ic => {
          for (let i = 1; i < rows.length; i++) {
            const rowIc = String(rows[i][2]).trim();
            const rowStatus = rows[i][9] ? String(rows[i][9]).trim().toLowerCase() : "";
            if (rowIc === String(ic).trim() && rowStatus === "pending approval") {
              sheet.getRange(i + 1, 5).setValue(data.inductionDate || new Date());
              sheet.getRange(i + 1, 6).setValue(data.inductedBy);
              sheet.getRange(i + 1, 10).setValue("Approved");
              count++;
              break;
            }
          }
        });
        return returnJSON({ status: "success", count: count });
      });
    }
   

    // G. Save Incident (Create or Update)
    if (data.action === "saveIncident") {
      if (String(data.pin).trim() !== String(systemPIN).trim()) {
        return returnJSON({ status: "ERROR", message: "Unauthorized PIN" });
      }
      return runTransaction(() => {
        const ssId = settings["INCIDENT_SPREADSHEET_ID"];
        if (!ssId) {
          return returnJSON({ status: "ERROR", message: "Incident database not provisioned." });
        }
        const targetSS = SpreadsheetApp.openById(ssId);
        const sheet = getSheetSafe(targetSS, "Incidents");
        const rows = sheet.getDataRange().getValues();
        
        let incidentId = data.incidentId;
        let foundRowIdx = -1;
        
        if (incidentId) {
          // Edit operation: look for existing ID
          for (let i = 1; i < rows.length; i++) {
            if (String(rows[i][0]).trim() === String(incidentId).trim()) {
              foundRowIdx = i + 1;
              break;
            }
          }
        }
        
        const timestamp = new Date();
        const dateTime = data.dateTime;
        const victimName = data.victimName;
        const locationDept = data.locationDept;
        const bodyPart = data.bodyPart;
        const mandaysLost = Number(data.mandaysLost || 0);
        const reportedJkkp = data.reportedJkkp || "No";
        const severityType = data.severityType || "First Aid";
        const investigationSubmitted = data.investigationSubmitted || "No";
        const description = data.description || "";
        
        if (foundRowIdx !== -1) {
          // Update row cells (1-indexed columns)
          sheet.getRange(foundRowIdx, 3).setValue(dateTime);
          sheet.getRange(foundRowIdx, 4).setValue(victimName);
          sheet.getRange(foundRowIdx, 5).setValue(locationDept);
          sheet.getRange(foundRowIdx, 6).setValue(bodyPart);
          sheet.getRange(foundRowIdx, 7).setValue(mandaysLost);
          sheet.getRange(foundRowIdx, 8).setValue(reportedJkkp);
          sheet.getRange(foundRowIdx, 9).setValue(severityType);
          sheet.getRange(foundRowIdx, 10).setValue(investigationSubmitted);
          sheet.getRange(foundRowIdx, 11).setValue(description);
        } else {
          // Create operation: generate a serial ID INC-YYYY-XXXX
          const year = dateTime ? dateTime.substring(0, 4) : String(new Date().getFullYear());
          // Count logs matching the same year to generate serial sequence
          let yearCount = 0;
          for (let i = 1; i < rows.length; i++) {
            const rowDate = String(rows[i][2] || "");
            if (rowDate.startsWith(year)) {
              yearCount++;
            }
          }
          const seq = String(yearCount + 1).padStart(4, '0');
          incidentId = `INC-${year}-${seq}`;
          
          sheet.appendRow([
            incidentId,
            timestamp,
            dateTime,
            victimName,
            locationDept,
            bodyPart,
            mandaysLost,
            reportedJkkp,
            severityType,
            investigationSubmitted,
            description
          ]);
        }
        
        return returnJSON({ status: "SUCCESS", incidentId: incidentId });
      });
    }
    
    // H. Delete Incident
    if (data.action === "deleteIncident") {
      if (String(data.pin).trim() !== String(systemPIN).trim()) {
        return returnJSON({ status: "ERROR", message: "Unauthorized PIN" });
      }
      return runTransaction(() => {
        const ssId = settings["INCIDENT_SPREADSHEET_ID"];
        if (!ssId) {
          return returnJSON({ status: "ERROR", message: "Incident database not provisioned." });
        }
        const targetSS = SpreadsheetApp.openById(ssId);
        const sheet = getSheetSafe(targetSS, "Incidents");
        const rows = sheet.getDataRange().getValues();
        let foundRowIdx = -1;
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0]).trim() === String(data.incidentId).trim()) {
            foundRowIdx = i + 1;
            break;
          }
        }
        if (foundRowIdx !== -1) {
          sheet.deleteRow(foundRowIdx);
          return returnJSON({ status: "SUCCESS" });
        }
        return returnJSON({ status: "ERROR", message: "Incident ID not found" });
      });
    }
   
    return returnJSON({ status: "ERROR", message: "Invalid action type" });
  } catch (err) {
    return returnJSON({ status: "ERROR", message: err.message });
  }
}
 
// ========================================================
// 5. CLIENT SIDE CONFIGURATION UI (SETTINGS SIDEBAR)
// ========================================================
function showSettingsSidebar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSystemSettings(ss);
  
  const currentPin = settings["DASHBOARD_PIN"] || "9911";
  const currentLogo = settings["LOGO_URL"] || "";
  const currentName = settings["SYSTEM_NAME"] || "Safety Hub";
  const licenseKey = settings["LICENSE_KEY"] || "";
  const boxIds = settings["BOX_IDS"] || "OSH/FAB/01,OSH/FAB/02,OSH/FAB/03,OSH/FAB/04,OSH/FAB/05,OSH/FAB/06,OSH/FAB/07";
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Inter', sans-serif; padding: 15px; background: #f8fafc; color: #1e293b; font-size: 13px; }
        h3 { margin-top: 0; color: #1e3a8a; font-weight: 700; border-bottom: 2px solid #3b82f6; padding-bottom: 5px; }
        .form-group { margin-bottom: 12px; }
        label { display: block; font-weight: 600; margin-bottom: 4px; color: #475569; }
        input[type="text"], textarea { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-family: inherit; font-size: 12px; }
        input:focus, textarea:focus { border-color: #3b82f6; outline: none; }
        .btn { background: #3b82f6; color: white; border: none; padding: 10px; width: 100%; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; margin-top: 15px; transition: background 0.2s; }
        .btn:hover { background: #2563eb; }
        .status { margin-top: 10px; padding: 8px; border-radius: 4px; display: none; font-weight: 500; text-align: center; font-size: 12px; }
        .status.success { background: #dcfce7; color: #166534; border: 1px solid #b2f2bb; }
        .status.error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
      </style>
    </head>
    <body>
      <h3>Safety Hub Settings</h3>
      
      <div class="form-group">
        <label for="systemName">System Brand Name</label>
        <input type="text" id="systemName" value="${currentName}" placeholder="e.g. Acme Safety Hub">
      </div>
      
      <div class="form-group">
        <label for="logoUrl">Company Logo Image URL</label>
        <input type="text" id="logoUrl" value="${currentLogo}" placeholder="https://example.com/logo.png">
      </div>
      
      <div class="form-group">
        <label for="pin">Dashboard PIN Lock</label>
        <input type="text" id="pin" value="${currentPin}" placeholder="4-digit PIN">
      </div>
      
      <div class="form-group">
        <label for="boxIds">First Aid Box IDs (Comma-separated)</label>
        <textarea id="boxIds" rows="3" placeholder="OSH/FAB/01,OSH/FAB/02">${boxIds}</textarea>
      </div>
      
      <div class="form-group" style="background: #eff6ff; padding: 10px; border-radius: 8px; border: 1px solid #bfdbfe; margin-top: 15px;">
        <label for="licenseKey" style="color: #1e40af;">🔑 License Key Validation</label>
        <input type="text" id="licenseKey" value="${licenseKey}" placeholder="SAFETY-XXXX-XXXX-XXXX">
      </div>
      
      <button class="btn" onclick="saveSettings()">Save Configuration</button>
      <div id="statusBox" class="status"></div>
 
      <script>
        function saveSettings() {
          const btn = document.querySelector(".btn");
          const statusBox = document.getElementById("statusBox");
          btn.disabled = true;
          btn.innerHTML = "Saving...";
          statusBox.style.display = "none";
          
          const config = {
            systemName: document.getElementById("systemName").value,
            logoUrl: document.getElementById("logoUrl").value,
            pin: document.getElementById("pin").value,
            boxIds: document.getElementById("boxIds").value,
            licenseKey: document.getElementById("licenseKey").value
          };
          
          google.script.run
            .withSuccessHandler(function(response) {
              btn.disabled = false;
              btn.innerHTML = "Save Configuration";
              statusBox.className = "status " + (response.status === "success" ? "success" : "error");
              statusBox.innerHTML = response.message;
              statusBox.style.display = "block";
            })
            .withFailureHandler(function(err) {
              btn.disabled = false;
              btn.innerHTML = "Save Configuration";
              statusBox.className = "status error";
              statusBox.innerHTML = "Connection Error: " + err;
              statusBox.style.display = "block";
            })
            .updateClientSettings(config);
        }
      </script>
    </body>
    </html>
  `;
  
  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
      .setTitle('Safety Hub Settings')
      .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}
 
function updateClientSettings(config) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const licenseKey = config.licenseKey || "";
    
    let planType = "Free";
    
    if (licenseKey) {
      // License Check Validation
      const licenseResult = validateLicenseKey(licenseKey);
      if (!licenseResult.valid) {
        return { status: "error", message: "❌ Invalid License Key: " + licenseResult.reason };
      }
      planType = licenseResult.planType || "Premium";
    }
    
    // Save configurations
    setSystemSetting(ss, "SYSTEM_NAME", config.systemName || "Safety Hub");
    setSystemSetting(ss, "LOGO_URL", config.logoUrl || "");
    setSystemSetting(ss, "DASHBOARD_PIN", config.pin || "9911");
    setSystemSetting(ss, "BOX_IDS", config.boxIds || "");
    setSystemSetting(ss, "LICENSE_KEY", licenseKey);
    setSystemSetting(ss, "PLAN_TYPE", planType);
    
    // Format the settings tab
    formatSystemSettingsSheet(ss);
    
    return { status: "success", message: "🎉 Configuration saved successfully! (Plan: " + planType + ")" };
  } catch (err) {
    return { status: "error", message: "Error: " + err.message };
  }
}
 
// ========================================================
// LICENSE KEY VALIDATION (via Web App running as Developer)
// ========================================================
// License Sheet ID — private, only accessible by developer's Web App
const LICENSE_SHEET_ID = "1FH75rDHPZniZUXbO3BpK1Lku1lA-RiNbgEQgihaNF_M";
// Web App URL — deployed as "Execute as: Me" so it can access the private license sheet
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxkqvl5E03H0IN2igM0RXRcQY0C-lOXpkxlkz9bVcwEQ9hGAUdKnyt7Mw5K9UDVk45juA/exec";

function validateLicenseKey(key) {
  if (!key) {
    return { valid: false, reason: "License key is required." };
  }
  
  const cleanKey = String(key).trim();
  
  // Call Web App (runs as developer) to validate against private license sheet
  try {
    const url = WEB_APP_URL + "?action=validateLicense&key=" + encodeURIComponent(cleanKey);
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const result = JSON.parse(response.getContentText());
    
    if (result.status === "SUCCESS") {
      return { 
        valid: result.valid, 
        planType: result.planType, 
        expiry: result.expiry,
        reason: result.message || (result.valid ? "" : "Invalid license key.")
      };
    } else {
      return { valid: false, reason: result.message || "License validation failed." };
    }
  } catch (err) {
    Logger.log("License validation error: " + err.message);
    return { valid: false, reason: "Unable to verify license. Please contact support." };
  }
}
 
// ========================================================
// 6. SHARED UTILITIES & API HELPERS
// ========================================================
 
// Return text response
function returnText(val) {
  return ContentService.createTextOutput(val).setMimeType(ContentService.MimeType.TEXT);
}
 
// Return JSON response
function returnJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Safely get a sheet by name. Returns a clear error JSON if sheet is missing.
 * Prevents silent crashes when user renames database sheets.
 */
function getSheetSafe(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet '" + sheetName + "' not found. Please check your database sheet names.");
  }
  return sheet;
}
 
// Fetch central stock map
function getCentralStockMap(ss) {
  const invSheet = ss.getSheetByName("First Aid Central Inventory");
  const rows = invSheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[rows[i][0]] = {
      rowIdx: i + 1,
      name: rows[i][1],
      stock: parseInt(rows[i][3], 10) || 0
    };
  }
  return map;
}
 
// Convert sheet values to clean JSON Array
function fetchSheetDataAsJSON(sheet) {
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = rows[i][j];
      if (val instanceof Date) {
        if (headers[j].toLowerCase().indexOf("timestamp") !== -1 || headers[j].toLowerCase().indexOf("date") !== -1) {
          val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd HH:mm:ss");
        } else {
          val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
        }
      }
      obj[headers[j]] = val;
    }
    data.push(obj);
  }
  return data;
}

// Get system settings from hidden tab
function getSystemSettings(ss) {
  let sheet = ss.getSheetByName("System Settings");
  if (!sheet) {
    sheet = ss.insertSheet("System Settings");
    const defaults = [
      ["Setting Key", "Setting Value"],
      ["SYSTEM_NAME", "Safety Hub"],
      ["LOGO_URL", ""],
      ["DASHBOARD_PIN", "9911"],
      ["BOX_IDS", "OSH/FAB/01,OSH/FAB/02,OSH/FAB/03,OSH/FAB/04,OSH/FAB/05,OSH/FAB/06,OSH/FAB/07"],
      ["LICENSE_KEY", ""],
      ["DEPARTMENTS", "Production,Maintenance,QA/QC,Warehouse,Safety/HR,Engineering,Electrical,Security,Recycle,DIP,Wire Drawing,Logistic,Finance,Purchasing,MFP,Admin,Contractor,Others"],
      ["PPE_TYPES", "Safety Shoe,Safety Helmet,Respirator,Earmuff,Filter Cartridge,Other"],
      ["CONTRACTOR_DECLARATION", "Agreed: Emergency Evac, PPE Rules, Incident Reporting"],
      ["SEVERITIES", "Near Miss,First Aid,Medical Treatment,Lost Time Injury (LTI),Fatality"]
    ];
    sheet.getRange(1, 1, defaults.length, 2).setValues(defaults);
    formatSystemSettingsSheet(ss);
  }
  const rows = sheet.getDataRange().getValues();
  const settings = {};
  rows.forEach(r => {
    if (r[0]) settings[r[0]] = String(r[1] || "").trim();
  });
  return settings;
}

// Set system settings in hidden tab
function setSystemSetting(ss, key, val) {
  let sheet = ss.getSheetByName("System Settings");
  if (!sheet) {
    getSystemSettings(ss);
    sheet = ss.getSheetByName("System Settings");
  }
  const rows = sheet.getDataRange().getValues();
  let foundRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) {
      foundRow = i + 1;
      break;
    }
  }
  if (foundRow !== -1) {
    sheet.getRange(foundRow, 2).setValue(val);
  } else {
    sheet.appendRow([key, val]);
  }
}

/**
 * Safely executes any database read-modify-write operation inside a critical locked section.
 * Prevents race conditions, duplicate IDs, and stock calculations overwrites globally.
 * 
 * @param {Function} callback - The database read/write logic to execute atomically.
 * @param {number} [timeoutMs=15000] - Max time in milliseconds to wait for the lock.
 * @return {*} The value returned by the callback function.
 */
function runTransaction(callback, timeoutMs) {
  const timeout = timeoutMs || 15000;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(timeout);
    return callback();
  } catch (err) {
    Logger.log("Database Transaction Lock Error: " + err.message);
    throw new Error("Database is temporarily busy. Please try again. Details: " + err.message);
  } finally {
    lock.releaseLock();
  }
}

// Manual formatting menu trigger
function manualFormatSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  formatSystemSettingsSheet(ss);
  SpreadsheetApp.getUi().alert("🎨 System Settings Formatted", "The 'System Settings' sheet has been formatted as a beautiful table successfully.", SpreadsheetApp.getUi().ButtonSet.OK);
}

// Format the System Settings tab into a beautiful, clean form table
function formatSystemSettingsSheet(ss) {
  let sheet = ss.getSheetByName("System Settings");
  if (!sheet) return;
  
  // Ensure the sheet is visible
  sheet.showSheet();
  
  // Check if header is already "Setting Key"
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return;
  
  const firstCell = sheet.getRange(1, 1).getValue();
  if (firstCell !== "Setting Key") {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1).setValue("Setting Key");
    sheet.getRange(1, 2).setValue("Setting Value");
  }
  
  const currentLastRow = sheet.getLastRow();
  if (currentLastRow <= 1) return;
  
  // 1. Clear any existing formatting to start fresh
  const fullRange = sheet.getRange(1, 1, currentLastRow, 2);
  fullRange.clearFormat();
  
  // 2. Set Row heights: header is 32, others are 28
  sheet.setRowHeight(1, 32);
  sheet.setRowHeights(2, currentLastRow - 1, 28);
  
  // 3. Font styling: Arial is universally supported in Google Sheets
  fullRange.setFontFamily("Arial");
  
  // Header Formatting (Row 1)
  const headerRange = sheet.getRange("A1:B1");
  headerRange.setFontSize(10)
             .setFontWeight("bold")
             .setFontColor("#ffffff")
             .setBackground("#1e293b") // Slate 800
             .setHorizontalAlignment("left")
             .setVerticalAlignment("middle");
             
  // 4. Clear existing range protections on this sheet to prevent duplicate/stale protections
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (let i = 0; i < protections.length; i++) {
    protections[i].remove();
  }
             
  // 5. Data Rows Formatting
  for (let r = 2; r <= currentLastRow; r++) {
    const keyRange = sheet.getRange(r, 1);
    const valRange = sheet.getRange(r, 2);
    const key = String(keyRange.getValue() || "").trim();
    const isSystemKey = key.endsWith("_ID");
    
    keyRange.setFontSize(9)
            .setFontWeight("bold")
            .setHorizontalAlignment("left")
            .setVerticalAlignment("middle");
            
    valRange.setFontSize(9)
            .setNumberFormat("@") // Plain Text to preserve leading zeros in PIN
            .setWrap(true) // Wrap text to show long values nicely
            .setHorizontalAlignment("left")
            .setVerticalAlignment("middle");
            
    if (isSystemKey) {
      // Muted style for system keys (indicates read-only/managed field)
      keyRange.setFontColor("#64748b").setBackground("#e2e8f0");
      valRange.setFontColor("#64748b").setBackground("#f1f5f9");
      
      // Apply warning-only protection guard to both cells
      const rowRange = sheet.getRange(r, 1, 1, 2);
      const protection = rowRange.protect().setDescription("System Managed Configuration");
      protection.setWarningOnly(true);
    } else {
      // Normal editable keys
      keyRange.setFontColor("#334155").setBackground("#f1f5f9");
      
      // Alternating backgrounds for normal values
      const bg = (r % 2 === 0) ? "#f8fafc" : "#ffffff";
      valRange.setFontColor("#0f172a").setBackground(bg);
    }
  }
  
  // 6. Apply elegant light slate borders
  fullRange.setBorder(true, true, true, true, true, true, "#cbd5e1", null);
  
  // 7. Auto-resize columns to fit content
  sheet.autoResizeColumn(1);
  sheet.autoResizeColumn(2);
  
  // Apply minimum widths to make it readable and leave space for new settings
  const widthA = Math.max(sheet.getColumnWidth(1) + 20, 200);
  const widthB = Math.max(sheet.getColumnWidth(2) + 40, 500);
  sheet.setColumnWidth(1, widthA);
  sheet.setColumnWidth(2, widthB);
}

