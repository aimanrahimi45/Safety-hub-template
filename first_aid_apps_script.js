/**
 * METROD AUTOMATION SYSTEM - FIRST AID BOX INSPECTION & INVENTORY SYSTEM
 * 
 * Instructions:
 * 1. Open your Google Sheet.
 * 2. Click "Extensions" > "Apps Script".
 * 3. Replace all existing code with this upgraded script.
 * 4. Select the "setupSheet" function in the dropdown at the top and click "Run".
 *    This will automatically configure/verify all four tabs:
 *    - "First Aid Checklist Logs"
 *    - "First Aid Checklist Details"
 *    - "First Aid Central Inventory"
 *    - "First Aid Inventory Transactions"
 * 5. Click "Deploy" > "New Deployment" > Web App > Execute as "Me", Access "Anyone" > Deploy.
 */

// Fetches the secure PIN from Project Properties (Default: "9911")
const DASHBOARD_PIN = PropertiesService.getScriptProperties().getProperty("DASHBOARD_PIN") || "9911";

// ========================================================
// 1. SETUP RELATIONAL & INVENTORY TABS
// ========================================================
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Setup Logs Tab
  let logsSheet = ss.getSheetByName("First Aid Checklist Logs");
  if (!logsSheet) logsSheet = ss.insertSheet("First Aid Checklist Logs");
  
  // 2. Setup Details Tab
  let detailsSheet = ss.getSheetByName("First Aid Checklist Details");
  if (!detailsSheet) detailsSheet = ss.insertSheet("First Aid Checklist Details");

  // 3. Setup Central Inventory Tab
  let invSheet = ss.getSheetByName("First Aid Central Inventory");
  if (!invSheet) invSheet = ss.insertSheet("First Aid Central Inventory");

  // 4. Setup Transactions Tab
  let transSheet = ss.getSheetByName("First Aid Inventory Transactions");
  if (!transSheet) transSheet = ss.insertSheet("First Aid Inventory Transactions");

  // Format Logs Headers (DO NOT CLEAR DATA)
  const logHeaders = [
    "Audit ID", "Timestamp", "Date of Inspection", "Company", 
    "Department", "Section", "Box ID", "Location",
    "Cleanliness Condition", "Cleanliness Remarks", "Inspection Findings",
    "Inspected By Name", "Inspected By Position", "Signature URL"
  ];
  logsSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
  logsSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  logsSheet.setFrozenRows(1);

  // Format Details Headers (DO NOT CLEAR DATA)
  const detailHeaders = [
    "Audit ID", "Item ID", "Item Name", "Required Standard", 
    "Quantity Available", "Expiry Date", "Remarks", "Box ID", "Date of Inspection"
  ];
  detailsSheet.getRange(1, 1, 1, detailHeaders.length).setValues([detailHeaders]);
  detailsSheet.getRange(1, 1, 1, detailHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  detailsSheet.setFrozenRows(1);

  // Format Central Inventory Headers (DO NOT CLEAR DATA)
  const invHeaders = ["Item ID", "Item Name", "Unit", "Current Stock", "Min Alert Level", "Last Updated"];
  invSheet.getRange(1, 1, 1, invHeaders.length).setValues([invHeaders]);
  invSheet.getRange(1, 1, 1, invHeaders.length).setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff"); // Teal branding
  invSheet.setFrozenRows(1);

  // Only load default items if the inventory list is completely empty
  if (invSheet.getLastRow() <= 1) {
    const defaultInventory = [
      [1, "Triangular Bandage 100cm", "pcs", 0, 10, new Date()],
      [2, "Eye Dressing No 16", "pkt", 0, 5, new Date()],
      [3, "Sterile Gamgee Pad 25cm", "pkt", 0, 5, new Date()],
      [4, "Sterile Gauze Pad 7.5cm", "pkt", 0, 10, new Date()],
      [5, "Sterile Gauze Pad 10cm", "pkt", 0, 10, new Date()],
      [6, "Elastic Bandage", "pkt", 0, 5, new Date()],
      [7, "W.O.W Bandage 2.5cm", "pcs", 0, 15, new Date()],
      [8, "W.O.W Bandage 5.0cm", "pcs", 0, 15, new Date()],
      [9, "W.O.W Bandage 7.5cm", "pcs", 0, 15, new Date()],
      [10, "Instant Ice Pack", "pkt", 0, 10, new Date()],
      [11, "Sterile Non-Adherent Pad", "pkt", 0, 10, new Date()],
      [12, "Pair of Glove", "pkt", 0, 10, new Date()],
      [13, "Scissors", "pcs", 0, 2, new Date()],
      [14, "Adhesive Tape", "pcs", 0, 5, new Date()],
      [15, "Bactigras", "pcs", 0, 5, new Date()],
      [16, "Yellow Antiseptic Liquid", "pcs", 0, 2, new Date()],
      [17, "Cotton Bud 100pcs", "pkt", 0, 5, new Date()],
      [18, "CPR Face Shield", "pcs", 0, 5, new Date()],
      [19, "Adhesive Plaster", "pcs", 0, 100, new Date()],
      [20, "Safety Pin", "pcs", 0, 50, new Date()],
      [21, "Thermometer", "pcs", 0, 2, new Date()],
      [22, "Waste Bag", "pcs", 0, 10, new Date()],
      [23, "First Aid Manual", "pcs", 0, 2, new Date()]
    ];
    invSheet.getRange(2, 1, defaultInventory.length, invHeaders.length).setValues(defaultInventory);
  }

  // Format Transactions Headers (DO NOT CLEAR DATA)
  const transHeaders = ["Timestamp", "ActionType", "Item ID", "Item Name", "QuantityChanged", "Box ID / Notes", "Logged By"];
  transSheet.getRange(1, 1, 1, transHeaders.length).setValues([transHeaders]);
  transSheet.getRange(1, 1, 1, transHeaders.length).setFontWeight("bold").setBackground("#374151").setFontColor("#ffffff");
  transSheet.setFrozenRows(1);

  // Auto-resize
  logsSheet.autoResizeColumns(1, logHeaders.length);
  detailsSheet.autoResizeColumns(1, detailHeaders.length);
  invSheet.autoResizeColumns(1, invHeaders.length);
  transSheet.autoResizeColumns(1, transHeaders.length);

  try {
    SpreadsheetApp.getUi().alert("🎉 Configuration Complete!", "All four relational and inventory database tabs have been set up in your spreadsheet.", SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log("🎉 Configuration Complete! All four relational and inventory database tabs have been set up in your spreadsheet.");
  }
}

// Helper to parse required standard numbers (e.g. "5pcs" -> 5)
function parseStandardQty(reqStr) {
  const match = reqStr.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// Helper to safely fetch central inventory mapping
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

// Helper to generate sequential Audit ID (e.g., FA-00001, FA-00002)
function getNextAuditId(logsSheet) {
  const lastRow = logsSheet.getLastRow();
  if (lastRow <= 1) {
    return "FA-00001";
  }
  const lastAuditId = logsSheet.getRange(lastRow, 1).getValue().toString();
  const match = lastAuditId.match(/^FA-(\d+)$/);
  if (match) {
    const nextNum = parseInt(match[1], 10) + 1;
    return "FA-" + nextNum.toString().padStart(5, '0');
  }
  // Fallback: Generate ID based on row count if the last row isn't in standard sequential format
  return "FA-" + (lastRow).toString().padStart(5, '0');
}

// ========================================================
// 2. WEB APP POST LISTENER (SUBMISSIONS & ADJUSTMENTS)
// ========================================================
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = JSON.parse(e.postData.contents);
    
    // Check if this is an inventory adjustment request from the stock monitor dashboard
    if (data.action === "updateInventory") {
      if (data.pin !== DASHBOARD_PIN) {
        return ContentService.createTextOutput("ERROR: Unauthorized").setMimeType(ContentService.MimeType.TEXT);
      }
      
      const invSheet = ss.getSheetByName("First Aid Central Inventory");
      const transSheet = ss.getSheetByName("First Aid Inventory Transactions");
      const stockMap = getCentralStockMap(ss);
      
      data.adjustments.forEach(adj => {
        const itemInfo = stockMap[adj.itemId];
        if (itemInfo) {
          const newQty = Math.max(0, itemInfo.stock + adj.qty);
          invSheet.getRange(itemInfo.rowIdx, 4).setValue(newQty); // Update Current Stock
          invSheet.getRange(itemInfo.rowIdx, 6).setValue(new Date()); // Update Last Updated
          
          // Log Transaction
          transSheet.appendRow([
            new Date(),
            adj.qty > 0 ? "RESTOCK" : "DISPATCH",
            adj.itemId,
            itemInfo.name,
            adj.qty,
            adj.notes || "Dashboard Stock Update",
            adj.user || "Safety Admin"
          ]);
        }
      });
      return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT);
    }
    
    // Default Submission: Handle New Inspection Form Submission
    const logsSheet = ss.getSheetByName("First Aid Checklist Logs");
    const detailsSheet = ss.getSheetByName("First Aid Checklist Details");
    const invSheet = ss.getSheetByName("First Aid Central Inventory");
    const transSheet = ss.getSheetByName("First Aid Inventory Transactions");
    
    // Handle Signature Capture
    let signatureUrl = "";
    if (data.signature) {
      const base64Data = data.signature.split(",")[1];
      const decodedBytes = Utilities.base64Decode(base64Data);
      const blob = Utilities.newBlob(decodedBytes, "image/png", `Sig_${data.boxId.replace(/\//g, '_')}_${data.inspectDate}.png`);
      const folderId = "1NEfd1I5zYDRXkhvizjokhX_K4JxBF293";
      let folder;
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (err) {
        const folders = DriveApp.getFoldersByName("Metrod Signatures");
        folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("Metrod Signatures");
      }
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      signatureUrl = file.getUrl();
    }
    
    // Generate Audit ID (Sequential format e.g. FA-00001)
    const auditId = getNextAuditId(logsSheet);

    const cleanCond = data[`item_24_avail`] || "Good";
    const cleanRem = data[`item_24_remarks`] || "-";

    // 1. Write Log
    logsSheet.appendRow([
      auditId, new Date(), data.inspectDate, data.company, data.department, data.section,
      data.boxId, data.location, cleanCond, cleanRem, data.findings || "-",
      data.officerName || "-", data.officerPos || "-", signatureUrl
    ]);
    
    // Define items array
    const itemsList = [
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

    const stockMap = getCentralStockMap(ss);
    const instantRestock = data.instantRestock === true;
    
    // 2. Process items
    itemsList.forEach(item => {
      const inputVal = parseInt(data[`item_${item.id}_avail`], 10) || 0;
      const reqVal = parseStandardQty(item.req);
      const exp = data[`item_${item.id}_exp`] || "-";
      const rem = data[`item_${item.id}_remarks`] || "-";

      let finalAvail = inputVal;

      // If inspector refilled on the spot, deduct difference from central stock
      if (instantRestock && inputVal < reqVal) {
        const shortage = reqVal - inputVal;
        const itemInfo = stockMap[item.id];
        
        if (itemInfo) {
          // Deduct from central stock (allow it to drop, e.g. 0 to -3 represents shortages)
          const newCentralStock = itemInfo.stock - shortage;
          invSheet.getRange(itemInfo.rowIdx, 4).setValue(newCentralStock);
          invSheet.getRange(itemInfo.rowIdx, 6).setValue(new Date());

          // Log transaction
          transSheet.appendRow([
            new Date(),
            "DISPATCH",
            item.id,
            item.name,
            -shortage,
            `Refill Box ${data.boxId} (Inspection)`,
            data.officerName || "Safety Officer"
          ]);
        }
        // Box is now fully restocked, so save the compliant standard count to the database
        finalAvail = reqVal;
      }

      detailsSheet.appendRow([
        auditId, item.id, item.name, item.req, finalAvail, exp, rem, data.boxId, data.inspectDate
      ]);
    });
    
    return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT);
    
  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err.message).setMimeType(ContentService.MimeType.TEXT);
  }
}

// ========================================================
// 3. SECURE GET LISTENER (READ API)
// ========================================================
function doGet(e) {
  try {
    const pin = e.parameter.pin;
    if (pin !== DASHBOARD_PIN) {
      return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Unauthorized: Invalid PIN" })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const action = e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === "getLogs") {
      const sheet = ss.getSheetByName("First Aid Checklist Logs");
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0];
      const data = [];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
          let val = rows[i][j];
          if (val instanceof Date) val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
          obj[headers[j]] = val;
        }
        data.push(obj);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", data: data })).setMimeType(ContentService.MimeType.JSON);
      
    } else if (action === "getDetails") {
      const sheet = ss.getSheetByName("First Aid Checklist Details");
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0];
      const data = [];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
          let val = rows[i][j];
          if (val instanceof Date) val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
          obj[headers[j]] = val;
        }
        data.push(obj);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", data: data })).setMimeType(ContentService.MimeType.JSON);
      
    } else if (action === "getInventory") {
      const sheet = ss.getSheetByName("First Aid Central Inventory");
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0];
      const data = [];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
          let val = rows[i][j];
          if (val instanceof Date) val = Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd HH:mm:ss");
          obj[headers[j]] = val;
        }
        data.push(obj);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", data: data })).setMimeType(ContentService.MimeType.JSON);
      
    } else if (action === "getShortages") {
      const logsSheet = ss.getSheetByName("First Aid Checklist Logs");
      const detailsSheet = ss.getSheetByName("First Aid Checklist Details");
      
      const logRows = logsSheet.getDataRange().getValues();
      const detailRows = detailsSheet.getDataRange().getValues();
      
      // 1. Find the latest audit record for each of the boxes OSH/FAB/01 to 07
      const boxLatestAudit = {}; // maps boxId -> auditId
      const boxLatestDate = {}; // maps boxId -> Date object
      
      for (let i = 1; i < logRows.length; i++) {
        const auditId = logRows[i][0];
        const dateStr = logRows[i][2]; // "Date of Inspection"
        const boxId = logRows[i][6];
        const dateObj = new Date(dateStr);
        
        if (!boxLatestDate[boxId] || dateObj > boxLatestDate[boxId]) {
          boxLatestDate[boxId] = dateObj;
          boxLatestAudit[boxId] = auditId;
        }
      }
      
      // 2. Fetch all details for these latest audits and calculate shortages
      const activeAuditIds = Object.values(boxLatestAudit);
      const shortages = []; // array of items with box shortages
      
      for (let i = 1; i < detailRows.length; i++) {
        const auditId = detailRows[i][0];
        const itemId = parseInt(detailRows[i][1], 10);
        const itemName = detailRows[i][2];
        const reqStr = detailRows[i][3];
        const availVal = parseInt(detailRows[i][4], 10) || 0;
        
        // Find which box this audit belongs to
        const boxId = Object.keys(boxLatestAudit).find(key => boxLatestAudit[key] === auditId);
        
        if (boxId) {
          const reqVal = parseStandardQty(reqStr);
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
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "SUCCESS",
        shortages: shortages
      })).setMimeType(ContentService.MimeType.JSON);
      
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Invalid Action" })).setMimeType(ContentService.MimeType.JSON);
    }
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
