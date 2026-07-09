import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function cleanText(str) {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function runCleanup() {
  const docId = '6a683748-a157-4ee1-8564-024af2e1e2ea';
  const pdfText = fs.readFileSync('/tmp/loji_text.txt', 'utf8');
  const cleanedPdf = cleanText(pdfText);
  
  // 1. Fetch all clauses
  const { data: clauses, error } = await s
    .from('clauses')
    .select('id, section_number, clause_text')
    .eq('doc_id', docId);
    
  if (error) {
    console.error('Error fetching clauses:', error);
    return;
  }
  
  console.log(`Analyzing ${clauses.length} database clauses...`);
  
  const toUpdate = [];
  const toDelete = [];
  
  for (const row of clauses) {
    const dbText = row.clause_text;
    const cleanDb = cleanText(dbText);
    
    if (!cleanDb) continue;
    
    const index = cleanedPdf.indexOf(cleanDb);
    
    if (index === -1) {
      toDelete.push(row.id);
      continue;
    }
    
    // Find heading
    const textBefore = pdfText.slice(0, pdfText.indexOf(dbText.slice(0, 30)));
    const headingRegex = /(?:Regulation|Peraturan|Seksyen|Section|Butiran|Item)\s+\d+(?:\(\d+\))?|JADUAL\s+[A-Z\s]+|SCHEDULE\s+[A-Z\s]+|[A-Z]+\s+SCHEDULE/gi;
    let match;
    let closestHeading = 'General';
    
    while ((match = headingRegex.exec(textBefore)) !== null) {
      closestHeading = match[0].trim();
    }
    
    const dbSecClean = row.section_number.replace(/\s+/g, ' ').trim().toLowerCase();
    const detectedClean = closestHeading.replace(/\s+/g, ' ').trim().toLowerCase();
    
    const isMatch = dbSecClean === detectedClean || 
                    dbSecClean.includes(detectedClean) || 
                    detectedClean.includes(dbSecClean) ||
                    (dbSecClean.includes('schedule') && detectedClean.includes('schedule'));
    
    if (!isMatch) {
      toUpdate.push({ id: row.id, from: row.section_number, to: closestHeading, text: dbText });
    }
  }
  
  console.log(`Found ${toUpdate.length} mismatches to update.`);
  console.log(`Found ${toDelete.length} outdated/repealed clauses to remove.`);
  
  // 2. Perform updates
  if (toUpdate.length > 0) {
    console.log('\n--- Executing updates... ---');
    for (const item of toUpdate) {
      const { error: err } = await s
        .from('clauses')
        .update({ section_number: item.to })
        .eq('id', item.id);
        
      if (err) {
        console.error(`Failed to update clause ${item.id}:`, err);
      } else {
        console.log(`Updated Section: "${item.from}" -> "${item.to}"`);
      }
    }
  }
  
  // 3. Perform deletions
  if (toDelete.length > 0) {
    console.log('\n--- Executing removals... ---');
    
    // Delete linked obligations first due to foreign key constraints
    const { error: oblErr } = await s
      .from('obligations')
      .delete()
      .in('clause_id', toDelete);
      
    if (oblErr) {
      console.error('Failed to delete linked obligations:', oblErr);
      return;
    }
    console.log(`Deleted linked obligations for ${toDelete.length} clauses.`);
    
    // Delete clauses
    const { error: clsErr } = await s
      .from('clauses')
      .delete()
      .in('id', toDelete);
      
    if (clsErr) {
      console.error('Failed to delete clauses:', clsErr);
    } else {
      console.log(`Successfully deleted ${toDelete.length} outdated clauses from database.`);
    }
  }
  
  console.log('\n--- Cleanup complete! ---');
}

runCleanup();
