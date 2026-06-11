/**
 * Google Apps Script for Contractor Handbook Form Submission
 * This script receives form data from the contractor handbook HTML and saves it to Google Sheets
 */

/**
 * Setup function - run this once to authorize the app!
 * Perfect for handing over to a new safety officer.
 */
function setupAuthorization() {
  DriveApp.getRootFolder(); // Triggers Drive permissions
  SpreadsheetApp.getActiveSpreadsheet(); // Triggers Sheets permissions
  console.log("Authorization Successful! App is ready.");
}

// Configuration - Update these values
const SHEET_NAME = 'Contractor Acknowledgments'; // Name of the sheet tab
const SPREADSHEET_ID = ''; // Left empty to dynamically use the script's bound spreadsheet automatically
const FOLDER_ID = PropertiesService.getScriptProperties().getProperty("FOLDER_ID"); // Securely loaded from Project settings!

/**
 * Helper to get current GMT+8 Date string
 */
function getGMT8Date() {
  return Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
}

/**
 * Main function to handle POST requests from the contractor handbook form
 */
function doPost(e) {
  try {
    // Parse the incoming JSON data
    const data = JSON.parse(e.postData.contents);

    // Log the received data for debugging
    console.log('Received form data:', data);

    // Save data to Google Sheet
    const result = saveToGoogleSheet(data);

    // Return success response
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Data saved successfully',
        rowNumber: result.rowNumber,
        timestamp: getGMT8Date()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('Error processing form submission:', error);

    // Return error response
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'error',
        message: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================================
// SECURE WEB APP GET LISTENER (DASHBOARD API)
// ========================================================
const DASHBOARD_PIN = PropertiesService.getScriptProperties().getProperty("DASHBOARD_PIN") || "9911";

function doGet(e) {
  try {
    const pin = e.parameter.pin;
    
    // Check PIN authorization
    if (pin !== DASHBOARD_PIN) {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "ERROR", 
        message: "Unauthorized: Invalid PIN" 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const spreadsheet = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.getActiveSheet();
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

/**
 * Save form data to Google Sheet
 */
function saveToGoogleSheet(formData) {
  try {
    // Get or create the spreadsheet
    let spreadsheet;
    if (SPREADSHEET_ID) {
      spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    } else {
      // Use the script's bound spreadsheet
      spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      if (!spreadsheet) {
        // Create a new spreadsheet if none exists
        spreadsheet = SpreadsheetApp.create('Contractor Handbook Acknowledgments');
        console.log('Created new spreadsheet:', spreadsheet.getId());
      }
    }

    // Get or create the sheet
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      setupSheetHeaders(sheet);
    }

    // Check if headers exist, if not, add them
    if (sheet.getLastRow() === 0) {
      setupSheetHeaders(sheet);
    }

    // Process signature image
    let signatureInfo = processSignatureImage(formData.signature);

    // Prepare row data
    const rowData = [
      getGMT8Date(),
      formData.company || '',
      formData.name || '',
      formData.position || '',
      formData.email || '',
      formData.phone || '',
      formData.icNumber || '',
      formData.mmb ? 'Yes' : 'No',
      formData.ccr ? 'Yes' : 'No',
      formData.mfp ? 'Yes' : 'No',
      signatureInfo.hasSignature ? 'Yes' : 'No',
      signatureInfo.signatureUrl || '',
      signatureInfo.signatureSize || 0,
      formData.ipAddress || '',
      formData.userAgent || '',
      getGMT8Date(), // Processing timestamp
      'Active' // Status
    ];

    // Add the row to the sheet
    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);

    // Apply formatting to the new row
    formatNewRow(sheet, newRow);

    // Auto-resize columns if this is a new sheet
    if (newRow === 2) { // First data row
      sheet.autoResizeColumns(1, sheet.getLastColumn());
    }

    console.log('Data saved successfully to row:', newRow);

    return {
      success: true,
      rowNumber: newRow,
      signatureProcessed: signatureInfo.hasSignature
    };

  } catch (error) {
    console.error('Error saving to Google Sheet:', error);
    throw new Error('Failed to save data to Google Sheet: ' + error.toString());
  }
}

/**
 * Setup sheet headers
 */
function setupSheetHeaders(sheet) {
  const headers = [
    'Submission Date',
    'Company Name',
    'Contractor Name',
    'Position',
    'Email Address',
    'Phone Number',
    'IC Number (Last 4)',
    'MMB Selected',
    'CCR Selected',
    'MFP Selected',
    'Has Digital Signature',
    'Signature Image URL',
    'Signature Data Size (chars)',
    'IP Address',
    'Browser Info',
    'Processing Time',
    'Status'
  ];

  // Set headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Format headers
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#2a5298');
  headerRange.setFontColor('white');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');

  // Freeze header row
  sheet.setFrozenRows(1);

  console.log('Sheet headers set up successfully');
}

/**
 * Process signature image data
 */
function processSignatureImage(signatureData) {
  try {
    if (!signatureData || !signatureData.startsWith('data:image/')) {
      return {
        hasSignature: false,
        signatureUrl: '',
        signatureSize: 0
      };
    }

    // Extract base64 data
    const base64Data = signatureData.split(',')[1];
    const mimeType = signatureData.split(';')[0].split(':')[1];

    // Convert base64 to blob
    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, mimeType);

    // Generate filename with timestamp
    const timestamp = getGMT8Date().replace(/[: ]/g, '-');
    const filename = `signature_${timestamp}.jpg`;

    // Save to Google Drive
    try {
      let folder;
      if (typeof FOLDER_ID !== 'undefined' && FOLDER_ID !== '' && FOLDER_ID !== 'PASTE_YOUR_FOLDER_ID_HERE') {
        folder = DriveApp.getFolderById(FOLDER_ID);
      } else {
        folder = DriveApp.getRootFolder();
      }

      const file = folder.createFile(blob.setName(filename));

      // Make file viewable by anyone with the link
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      // Use the raw image URL so the Audit Hub can render it as a picture
      const fileUrl = "https://lh3.googleusercontent.com/d/" + file.getId();

      console.log('Signature image saved to Drive:', filename);

      return {
        hasSignature: true,
        signatureUrl: fileUrl,
        signatureSize: signatureData.length
      };
    } catch (driveError) {
      console.warn('Could not save to Drive, storing data only:', driveError);
      return {
        hasSignature: true,
        signatureUrl: 'Data stored in sheet',
        signatureSize: signatureData.length
      };
    }

  } catch (error) {
    console.error('Error processing signature:', error);
    return {
      hasSignature: false,
      signatureUrl: 'Error processing signature',
      signatureSize: signatureData ? signatureData.length : 0
    };
  }
}

/**
 * Format the newly added row
 */
function formatNewRow(sheet, rowNumber) {
  try {
    const range = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn());

    // Alternate row colors
    if (rowNumber % 2 === 0) {
      range.setBackground('#f8f9fa');
    }

    // Set text wrapping for certain columns
    sheet.getRange(rowNumber, 2, 1, 1).setWrap(true); // Company name
    sheet.getRange(rowNumber, 15, 1, 1).setWrap(true); // Browser info

    // Set date formatting
    sheet.getRange(rowNumber, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(rowNumber, 16).setNumberFormat('yyyy-mm-dd hh:mm:ss');

    // Set status color
    const statusCell = sheet.getRange(rowNumber, 17);
    statusCell.setBackground('#d4edda');
    statusCell.setFontColor('#155724');

  } catch (error) {
    console.warn('Error formatting row:', error);
  }
}


