// ========================================================
// METROD AUTOMATION SYSTEM - PPE MANAGEMENT BACKEND SCRIPT
// ========================================================

const DASHBOARD_PIN = PropertiesService.getScriptProperties().getProperty("DASHBOARD_PIN") || "9911";

// Safe sheet target helper
function getPpeSheet(ss) {
  var name = "PPE Requests";
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// 1. SETUP SHEET HEADERS & STYLING
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getPpeSheet(ss);
  
  const headers = [
    "Request ID", "Timestamp", "Staff ID", "Staff Name", "Department", 
    "Supervisor Name", "PPE Type", "Size", "Color/Specs", "Replacement Reason", 
    "Condition Remarks", "Status", "Authorized By", "Action Date"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff"); // Teal theme
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  
  try {
    SpreadsheetApp.getUi().alert("🎉 PPE Requests Setup Complete!", "Headers have been formatted safely.", SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log("🎉 PPE Requests Setup Complete! Headers formatted successfully.");
  }
}

// Helper to generate sequential Request ID (e.g., REQ-00001)
function getNextRequestId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return "REQ-00001";
  }
  const lastReqId = sheet.getRange(lastRow, 1).getValue().toString();
  const match = lastReqId.match(/^REQ-(\d+)$/);
  if (match) {
    const nextNum = parseInt(match[1], 10) + 1;
    return "REQ-" + nextNum.toString().padStart(5, '0');
  }
  return "REQ-" + (lastRow).toString().padStart(5, '0');
}

// Helper to parse email with custom OpenAI-compatible AI API
function parseEmailWithAi(emailContent, validDepartments) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("AI_API_KEY");
  const baseUrl = PropertiesService.getScriptProperties().getProperty("AI_BASE_URL");
  const model = PropertiesService.getScriptProperties().getProperty("AI_MODEL") || "gpt-4o-mini";
  
  if (!apiKey || !baseUrl) {
    throw new Error("Missing AI_API_KEY or AI_BASE_URL in Google Apps Script Script Properties.");
  }
  
  let url = baseUrl.trim();
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  if (!url.endsWith("/chat/completions")) {
    url = url + "/chat/completions";
  }

  // Construct departments dynamically with safe fallbacks
  const depts = (validDepartments && validDepartments.length > 0)
    ? validDepartments
    : ['Production', 'Maintenance', 'QA/QC', 'Warehouse', 'Safety/HR', 'Engineering', 'Electrical', 'Security', 'Recycle', 'DIP', 'Wire Drawing', 'Logistic', 'Finance', 'Purchasing', 'Admin', 'Contractor', 'Others'];
  
  const deptsString = depts.map(function(d) { return "'" + d + "'"; }).join(', ');
  
  const systemPrompt = "You are a precise data extractor for a safety department. Your task is to extract PPE replacement request records from unstructured email texts.\n" +
    "Analyze the email text and return a JSON array of request objects. You MUST generate one separate object per individual PPE item requested. If a single worker requests multiple PPE items (e.g. both Safety Shoes and a Safety Helmet, or multiple items listed together), create a separate object for EACH item requested by that worker so they can be logged individually. For every object generated for a specific worker, you MUST duplicate and copy that worker's name, employee ID/passport, department, and supervisor details. Never leave name or id blank or 'Unknown' for secondary items if they are mentioned anywhere in that worker's text block.\n" +
    "Each object must contain the following keys exactly:\n" +
    "- name: Full name of the worker requesting PPE (strip row numbers, table indices, signature text, clean whitespace).\n" +
    "- id: 5-digit Employee ID (e.g. 20585) or alphanumeric Passport number (e.g. J706376). Return empty string if not found.\n" +
    "- size: Shoe or item size mentioned for this specific PPE (e.g. '10', '9', '7', 'L'). Return '-' if not found or not applicable.\n" +
    "- date: Date of the request parsed from the email headers (Date: or Sent:) in YYYY-MM-DD format. Default to today's date if not found.\n" +
    "- department: Must be mapped to one of these exact values: " + deptsString + ", or 'Others'.\n" +
    "- ppeType: Must be mapped to one of these exact values: 'Safety Shoe', 'Safety Helmet', 'Respirator', 'Earmuff', 'Filter Cartridge', or 'Other'.\n" +
    "- supervisor: The sender of the email or supervisor name (usually found in the From: field).\n" +
    "- colorSpecs: Color/specs if mentioned (e.g., 'Yellow', 'Double Filter'). For example, if 'Helmet: Yellow' is requested, the object for Safety Helmet should have colorSpecs = 'Yellow'. Return '-' if not found.\n\n" +
    "Your response MUST be a valid JSON array and NOTHING else. Do NOT wrap in markdown code blocks like ```json.";

  const userPrompt = "Email Content:\n\"\"\"\n" + emailContent + "\n\"\"\"";
  
  const payload = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.1
  };
  
  const options = {
    method: "post",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  
  if (responseCode !== 200) {
    throw new Error("AI API returned status code " + responseCode + ": " + responseText);
  }
  
  const resJson = JSON.parse(responseText);
  if (!resJson.choices || resJson.choices.length === 0 || !resJson.choices[0].message) {
    throw new Error("Invalid API response format: " + responseText);
  }
  
  let content = resJson.choices[0].message.content.trim();
  
  // Clean markdown block wrappers if the model ignored instructions
  if (content.startsWith("```")) {
    content = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error("Failed to parse AI output as JSON. Output was: " + content);
  }
}

// 2. WEB APP POST HANDLER (CREATION & APPROVALS)
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getPpeSheet(ss);
    const data = JSON.parse(e.postData.contents);
    
    // ACTION A: AI Parse Email Content
    if (data.action === "parseEmailWithAi") {
      if (String(data.pin).trim() !== String(DASHBOARD_PIN).trim()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Unauthorized PIN" })).setMimeType(ContentService.MimeType.JSON);
      }
      
      const parsedWorkers = parseEmailWithAi(data.emailContent, data.validDepartments);
      return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", workers: parsedWorkers })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Parse custom date from client if provided, otherwise default to current server time
    let timestamp = new Date();
    if (data.requestDate) {
      const parts = data.requestDate.split('-');
      if (parts.length === 3) {
        // Create date in local timezone, retaining the current time of day for sorting
        timestamp = new Date(
          parseInt(parts[0], 10), 
          parseInt(parts[1], 10) - 1, 
          parseInt(parts[2], 10),
          timestamp.getHours(),
          timestamp.getMinutes(),
          timestamp.getSeconds()
        );
      }
    }
    
    // ACTION B: Approve/Reject or Dispatch Pending Request
    if (data.action === "updateRequestStatus") {
      if (String(data.pin).trim() !== String(DASHBOARD_PIN).trim()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Unauthorized PIN" })).setMimeType(ContentService.MimeType.JSON);
      }
      
      const rows = sheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === String(data.requestId).trim()) {
          foundRow = i + 1;
          break;
        }
      }
      
      if (foundRow !== -1) {
        sheet.getRange(foundRow, 12).setValue(data.status); // Update Status (Col L)
        sheet.getRange(foundRow, 13).setValue(data.authorizedBy); // Update Authorized By (Col M)
        sheet.getRange(foundRow, 14).setValue(Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd")); // Update Action Date (Col N)
        SpreadsheetApp.flush();
        return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", message: "Request status updated" })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Request ID not found" })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // ACTION B: Log New Request
    const requestId = getNextRequestId(sheet);
    const status = data.status || "Approved / Dispatched";
    const actionDate = (status !== "Pending Approval") ? Utilities.formatDate(timestamp, "GMT+8", "yyyy-MM-dd") : "";
    const authorizedBy = (status !== "Pending Approval") ? (data.authorizedBy || "Safety Officer") : "";
    
    sheet.appendRow([
      requestId,
      timestamp,
      data.staffId,
      data.staffName,
      data.department,
      data.supervisorName || "SHO",
      data.ppeType,
      data.size || "-",
      data.colorSpecs || "-",
      data.replacementReason || "Damaged",
      data.conditionRemarks || "-",
      status,
      authorizedBy,
      actionDate
    ]);
    
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", requestId: requestId })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 3. WEB APP GET HANDLER (LOOKUPS & ANALYTICS)
function doGet(e) {
  try {
    const action = e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getPpeSheet(ss);
    
    // ACTION A: Check Last Issue (Smart 6-Month Warning Lookup)
    if (action === "checkLastIssue") {
      const staffId = e.parameter.staffId;
      const ppeType = e.parameter.ppeType;
      
      if (!staffId || !ppeType) {
        return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Missing staffId or ppeType" })).setMimeType(ContentService.MimeType.JSON);
      }
      
      const rows = sheet.getDataRange().getValues();
      let lastIssueDateObj = null;
      
      // Loop backwards from bottom to find the latest approved/dispatched record matching staffId and ppeType
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowStaffId = String(rows[i][2]).trim().toLowerCase();
        const rowPpeType = String(rows[i][6]).trim().toLowerCase();
        const rowStatus = String(rows[i][11]).trim().toLowerCase();
        
        if (rowStaffId === staffId.trim().toLowerCase() && 
            rowPpeType === ppeType.trim().toLowerCase() && 
            rowStatus.indexOf("approved") !== -1) {
          
          // Use Action Date (index 13) or fall back to Timestamp (index 1)
          const dateVal = rows[i][13] || rows[i][1];
          if (dateVal instanceof Date) {
            lastIssueDateObj = dateVal;
            break;
          }
        }
      }
      
      if (lastIssueDateObj) {
        const today = new Date();
        const diffMonths = (today.getFullYear() - lastIssueDateObj.getFullYear()) * 12 + (today.getMonth() - lastIssueDateObj.getMonth());
        const formattedDate = Utilities.formatDate(lastIssueDateObj, "GMT+8", "yyyy-MM-dd");
        
        return ContentService.createTextOutput(JSON.stringify({
          status: "SUCCESS",
          found: true,
          lastDate: formattedDate,
          diffMonths: diffMonths
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: "SUCCESS",
          found: false
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // ACTION B: Get All Requests (Requires PIN)
    const pin = e.parameter.pin;
    if (String(pin).trim() !== String(DASHBOARD_PIN).trim()) {
      return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: "Unauthorized PIN" })).setMimeType(ContentService.MimeType.JSON);
    }
    
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
    
    return ContentService.createTextOutput(JSON.stringify({ status: "SUCCESS", data: data })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// One-off utility function to clean up historical Action Dates in the Google Sheet.
// Converts all full timestamps in the Action Date column (Column N / index 14) to "yyyy-MM-dd" date strings.
// To run: Select cleanActionDates in the Apps Script toolbar dropdown and click Run.
function cleanActionDates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getPpeSheet(ss);
  const rows = sheet.getDataRange().getValues();
  
  let cleanedCount = 0;
  
  for (let i = 1; i < rows.length; i++) {
    const rawActionDate = rows[i][13]; // Column N (14th column, 0-indexed index 13)
    if (rawActionDate) {
      let formattedDateStr = "";
      
      if (rawActionDate instanceof Date) {
        formattedDateStr = Utilities.formatDate(rawActionDate, "GMT+8", "yyyy-MM-dd");
      } else {
        // Try parsing string date
        const parsed = Date.parse(rawActionDate);
        if (!isNaN(parsed)) {
          const tempDate = new Date(parsed);
          formattedDateStr = Utilities.formatDate(tempDate, "GMT+8", "yyyy-MM-dd");
        }
      }
      
      // If we successfully formatted it and it is different from raw cell value
      if (formattedDateStr && String(rawActionDate) !== formattedDateStr) {
        sheet.getRange(i + 1, 14).setValue(formattedDateStr); // Write back to Col N (Row index is i + 1)
        cleanedCount++;
      }
    }
  }
  
  Logger.log("🎉 Clean-up Complete! Total records formatted to Date-Only in Column N (Action Date): " + cleanedCount);
}

