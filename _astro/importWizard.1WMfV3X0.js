const V="import-wizard-styles",ie=`
/* Overlay (covers the page; high z-index) */
.iw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(30, 30, 29, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11000;
  padding: 20px;
  font-family: inherit;
}

/* Modal panel */
.iw-modal {
  background: var(--color-bg, #fff);
  border: 1px solid var(--color-border, #E0E0E0);
  width: 100%;
  max-width: 1000px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,0.18);
}
@media (max-width: 720px) { .iw-modal { max-width: 100%; } }

/* Header */
.iw-header {
  background: var(--color-bg-grey, #F4F4F4);
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border, #E0E0E0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.iw-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 900;
  color: var(--color-text, #1E1E1D);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.iw-close-btn {
  background: transparent;
  border: 1px solid var(--color-border, #E0E0E0);
  color: var(--color-text, #1E1E1D);
  width: 32px;
  height: 32px;
  font-size: 1.2rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.iw-close-btn:hover { color: var(--color-primary, #E58E1A); border-color: var(--color-primary, #E58E1A); }
.iw-close-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Body */
.iw-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Upload zone */
.iw-upload-zone {
  border: 2px dashed var(--color-border, #E0E0E0);
  background: #FAFAFA;
  border-radius: 12px;
  padding: 36px 20px;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.iw-upload-zone:hover { background: #F4F4F4; }
.iw-upload-zone.iw-dragover { background: #FFF7E6; border-color: var(--color-primary, #E58E1A); }
.iw-upload-text { font-weight: 700; font-size: 1.05rem; color: var(--color-text, #1E1E1D); }
.iw-upload-hint { font-size: 0.8rem; color: var(--color-text-muted, #6A6A69); margin-top: 6px; }

/* Section label inside body */
.iw-step-label {
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text, #1E1E1D);
}
.iw-step-hint {
  font-size: 0.75rem;
  color: var(--color-text-muted, #6A6A69);
  margin-top: -4px;
}

/* Preview table (Step 1) */
.iw-preview-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.iw-preview-scroll {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
}
.iw-preview-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.iw-preview-table th,
.iw-preview-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light, #F0F0F0);
  text-align: left;
  white-space: nowrap;
  border-right: 1px solid var(--color-border-light, #F0F0F0);
}
.iw-preview-table thead th {
  background: var(--color-bg-grey, #F4F4F4);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
  position: sticky; top: 0;
}
.iw-preview-table tbody tr { cursor: pointer; }
.iw-preview-table tbody tr:hover td { background: #FAFAFA; }
.iw-preview-table tbody tr.iw-selected-header td {
  background: #FFF7E6 !important;
  font-weight: 700;
  border-top: 2px dashed var(--color-primary, #E58E1A);
  border-bottom: 2px dashed var(--color-primary, #E58E1A);
}
/* Section-header rows (Phase 2.6 Inspections extension). Soft purple
   background to match dist/shared.js:596-602. Only applied when
   enableSectionHeaders: true and the row has been toggled. */
.iw-preview-table tbody tr.iw-selected-section-header td {
  background: #F3E8FF !important;
  font-weight: 700;
  color: #5B21B6;
  border-top: 2px dashed #8B5CF6;
  border-bottom: 2px dashed #8B5CF6;
}
.iw-preview-table .iw-row-num {
  background: var(--color-bg-grey, #F4F4F4);
  font-weight: 700;
  text-align: center;
  color: var(--color-text-muted, #6A6A69);
  width: 56px;
  border-right: 2px solid var(--color-border, #E0E0E0);
}

/* Click Mode toggle (Phase 2.6 Inspections extension). Shown only when
   enableSectionHeaders: true. Compact pill-style segmented control. */
.iw-click-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--color-bg-grey, #F4F4F4);
  border: 1px solid var(--color-border, #E0E0E0);
  font-size: 0.78rem;
}
.iw-click-mode-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
  margin-right: 4px;
}
.iw-click-mode-btn {
  font-family: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 5px 10px;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
  cursor: pointer;
}
.iw-click-mode-btn:hover { color: var(--color-primary, #E58E1A); border-color: var(--color-primary, #E58E1A); }
.iw-click-mode-btn.iw-active {
  background: #8B5CF6;
  color: #fff;
  border-color: #8B5CF6;
}
.iw-click-mode-hint {
  font-size: 0.72rem;
  color: var(--color-text-muted, #6A6A69);
  margin-left: 4px;
}

/* Custom-type controls (Phase 2.6 Inspections extension). Lets the
   user pick a response type (Yes/No, Dropdown, Text, Number, Pass/Fail)
   and optionally enter a comma-separated options list. The captured
   value is written into every row as r["Field Type"] / r["Options"]. */
.iw-custom-type {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.iw-custom-type select,
.iw-custom-type input {
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 5px 8px;
  border: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-custom-type select:focus,
.iw-custom-type input:focus {
  outline: 2px solid #8B5CF6;
  outline-offset: 1px;
  border-color: #8B5CF6;
}
.iw-custom-type-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #6A6A69);
}

/* Mapping grid (Step 2) */
.iw-mapping-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.iw-mapping-card {
  background: #F8F8F8;
  border: 1px solid var(--color-border, #E0E0E0);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.iw-mapping-card-label {
  font-size: 0.7rem;
  color: var(--color-text-muted, #6A6A69);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.iw-mapping-card-header {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text, #1E1E1D);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-mapping-card-header.iw-empty { color: var(--color-text-muted, #6A6A69); font-weight: 500; font-style: italic; }
.iw-mapping-card select {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--color-border, #E0E0E0);
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-mapping-card select:focus {
  outline: 2px solid var(--color-primary, #E58E1A);
  outline-offset: 1px;
  border-color: var(--color-primary, #E58E1A);
}

/* Footer */
.iw-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--color-border, #E0E0E0);
  background: var(--color-bg-grey, #F4F4F4);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.iw-btn {
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 0.78rem;
  padding: 10px 18px;
  border: 1px solid var(--color-border, #E0E0E0);
  cursor: pointer;
}
.iw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.iw-btn-secondary {
  background: var(--color-bg, #fff);
  color: var(--color-text, #1E1E1D);
}
.iw-btn-secondary:hover:not(:disabled) {
  color: var(--color-primary, #E58E1A);
  border-color: var(--color-primary, #E58E1A);
}
.iw-btn-primary {
  background: var(--color-primary, #E58E1A);
  color: #fff;
  border-color: var(--color-primary, #E58E1A);
}
.iw-btn-primary:hover:not(:disabled) { background: var(--color-primary-hover, #D07D12); border-color: var(--color-primary-hover, #D07D12); }

/* Inline error banner */
.iw-error {
  background: #FDECEC;
  border: 1px solid #C0392B;
  color: #8B1A1A;
  padding: 10px 14px;
  font-size: 0.85rem;
  font-weight: 600;
}

/* Loading overlay inside the modal */
.iw-loading {
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  font-weight: 700;
  font-size: 1rem;
  color: var(--color-text, #1E1E1D);
  z-index: 2;
}
.iw-spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--color-border, #E0E0E0);
  border-top-color: var(--color-primary, #E58E1A);
  border-radius: 50%;
  animation: iw-spin 0.9s linear infinite;
}
@keyframes iw-spin { to { transform: rotate(360deg); } }
`;function re(){if(document.getElementById(V))return;const i=document.createElement("style");i.id=V,i.textContent=ie,document.head.appendChild(i)}function ne(){return new Promise((i,p)=>{if(window.XLSX){i(window.XLSX);return}const l=document.createElement("script");l.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",l.async=!0,l.onload=()=>{const u=window.XLSX;u?i(u):p(new Error("SheetJS loaded but global XLSX is missing."))},l.onerror=()=>p(new Error("Failed to load SheetJS from CDN.")),document.head.appendChild(l)})}function g(i){return i==null?"":String(i).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function ae(i){const p=[];let l=[""],u=!1;for(let h=0;h<i.length;h++){const w=i[h],f=i[h+1];w==='"'?u&&f==='"'?(l[l.length-1]+='"',h++):u=!u:w===","&&!u?l.push(""):(w==="\r"||w===`
`)&&!u?(w==="\r"&&f===`
`&&h++,p.push(l),l=[""]):l[l.length-1]+=w}return(l.length>1||l[0]!=="")&&p.push(l),p}function le(i,p){const l=new Set,u=i.map((h,w)=>({colIdx:w,header:h,mappedFieldId:null}));for(const h of p){const w=(h.autoMatches??[]).map(f=>f.toLowerCase());if(w.length!==0)for(const f of u){if(l.has(f.colIdx))continue;const b=(f.header||"").toLowerCase().trim();if(b&&w.some(r=>b.includes(r))){f.mappedFieldId=h.id,l.add(f.colIdx);break}}}return u}function se(i){if(!i||!Array.isArray(i.fields)||i.fields.length===0)throw new Error("openImportWizard: options.fields is required.");if(typeof i.onComplete!="function")throw new Error("openImportWizard: options.onComplete is required.");re();let p=[],l=0,u=[];const h=i.enableSectionHeaders===!0;let w="HEADER";const f=new Set,b=new Map,r=document.createElement("div");r.className="iw-overlay",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true"),r.setAttribute("aria-label",i.title),r.innerHTML=`
    <div class="iw-modal">
      <div class="iw-header">
        <h3 class="iw-title">${g(i.title)}</h3>
        <button type="button" class="iw-close-btn" id="iw-close-x" aria-label="Close">&times;</button>
      </div>
      <div class="iw-body">
        <div id="iw-error" class="iw-error" hidden></div>

        <!-- Step 0: Upload -->
        <div class="iw-upload-zone" id="iw-drop-zone">
          <input type="file" id="iw-file-input" accept=".csv,.xlsx,.xls" hidden />
          <div class="iw-upload-text">📥 Click or drag an Excel/CSV file here</div>
          <div class="iw-upload-hint">Supports .csv, .xlsx, .xls</div>
        </div>

        <!-- Step 1: Header row selection (Click Mode toggle for section
             headers — only rendered when enableSectionHeaders: true). -->
        <div class="iw-preview-wrap" id="iw-step-preview" hidden>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div>
              <span class="iw-step-label" id="iw-step-1-label">Step 1 — Click the row that contains the column headers</span>
              <span class="iw-step-hint" id="iw-step-1-hint">Row 1 is selected by default. Click any other row to use it as the header.</span>
            </div>
            <div class="iw-click-mode" id="iw-click-mode" hidden>
              <span class="iw-click-mode-label">Click Mode</span>
              <button type="button" class="iw-click-mode-btn iw-active" id="iw-mode-header" data-mode="HEADER">Main Header</button>
              <button type="button" class="iw-click-mode-btn" id="iw-mode-section" data-mode="SECTION">Section Headers</button>
              <span class="iw-click-mode-hint" id="iw-mode-hint">Row 1 is selected by default</span>
            </div>
          </div>
          <div class="iw-preview-scroll">
            <table class="iw-preview-table" aria-label="File preview">
              <thead id="iw-thead"></thead>
              <tbody id="iw-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Step 2: Field mapping -->
        <div class="iw-preview-wrap" id="iw-step-mapping" hidden>
          <span class="iw-step-label">Step 2 — Match each column to a target field</span>
          <span class="iw-step-hint">Skip columns you do not want to import. Required fields are marked with ★.</span>
          <div class="iw-mapping-grid" id="iw-mapping-grid"></div>
        </div>
      </div>
      <div class="iw-footer">
        <button type="button" class="iw-btn iw-btn-secondary" id="iw-btn-cancel">Cancel</button>
        <button type="button" class="iw-btn iw-btn-primary" id="iw-btn-confirm" hidden disabled>Confirm &amp; Import</button>
      </div>
      <div id="iw-loading" class="iw-loading" hidden>
        <div class="iw-spinner" aria-hidden="true"></div>
        <div id="iw-loading-text">Importing…</div>
      </div>
    </div>
  `,document.body.appendChild(r);const J=r.querySelector(".iw-modal");J.style.position="relative";const S=r.querySelector("#iw-error"),v=r.querySelector("#iw-drop-zone"),A=r.querySelector("#iw-file-input"),U=r.querySelector("#iw-step-preview"),Z=r.querySelector("#iw-step-mapping"),H=r.querySelector("#iw-thead"),M=r.querySelector("#iw-tbody"),k=r.querySelector("#iw-mapping-grid"),L=r.querySelector("#iw-close-x"),T=r.querySelector("#iw-btn-cancel"),x=r.querySelector("#iw-btn-confirm"),B=r.querySelector("#iw-loading"),Q=r.querySelector("#iw-loading-text"),N=r.querySelector("#iw-step-1-label"),R=r.querySelector("#iw-step-1-hint"),G=r.querySelector("#iw-click-mode"),$=r.querySelector("#iw-mode-header"),z=r.querySelector("#iw-mode-section"),P=r.querySelector("#iw-mode-hint");function y(t){S.hidden=!1,S.textContent=t}function j(){S.hidden=!0,S.textContent=""}function F(){r.remove()}function X(t,n){t?(B.hidden=!1,n&&(Q.textContent=n),L.disabled=!0,T.disabled=!0,x.disabled=!0):(B.hidden=!0,L.disabled=!1,T.disabled=!1,C())}async function O(t){if(j(),!t)return;const n=t.name.toLowerCase(),e=n.endsWith(".xlsx")||n.endsWith(".xls"),o=n.endsWith(".csv");if(!e&&!o){y("Unsupported file format. Please upload a .csv, .xlsx, or .xls file.");return}const s=v.querySelector(".iw-upload-text"),c=v.querySelector(".iw-upload-hint");s.innerHTML=`Selected: <strong>${g(t.name)}</strong> (${Math.round(t.size/1024)} KB)`,c.textContent="Click again or drop another file to replace.";try{if(e){const a=await ne(),d=await t.arrayBuffer(),m=a.read(d,{type:"array"}),E=m.SheetNames[0];if(!E){y("The uploaded workbook has no sheets.");return}const te=m.Sheets[E],_=a.utils.sheet_to_json(te,{header:1,defval:"",blankrows:!1});if(_.length===0){y("The uploaded sheet is empty.");return}p=_.map(oe=>oe??[])}else{const a=await t.text(),d=ae(a);if(d.length===0){y("The uploaded file is empty.");return}p=d}l=0,f.clear(),G.hidden=!h,q("HEADER"),W(),U.hidden=!1,Z.hidden=!1,x.hidden=!1,C()}catch(a){const d=a instanceof Error?a.message:"Failed to parse the file.";y(d)}}function I(){if(H.innerHTML="",M.innerHTML="",p.length===0)return;const t=Math.max(...p.slice(0,20).map(o=>o.length),1);let n='<th class="iw-row-num">Row</th>';for(let o=0;o<t;o++)n+=`<th>Col ${o+1}</th>`;H.innerHTML=`<tr>${n}</tr>`;const e=Math.min(p.length,30);for(let o=0;o<e;o++){const s=p[o]??[],c=document.createElement("tr");w==="HEADER"&&o===l?c.className="iw-selected-header":w==="SECTION"&&f.has(o)&&(c.className="iw-selected-section-header"),c.addEventListener("click",()=>{w==="HEADER"||!h?(l=o,I(),W(),C()):(f.has(o)?f.delete(o):f.add(o),I())});let a=`<td class="iw-row-num">${o+1}</td>`;for(let d=0;d<t;d++){const m=s[d]===void 0||s[d]===null?"":s[d];a+=`<td>${g(typeof m=="number"?String(m):m)}</td>`}c.innerHTML=a,M.appendChild(c)}}function q(t){w=t,t==="HEADER"?($.classList.add("iw-active"),z.classList.remove("iw-active"),N.textContent="Step 1 — Click the row that contains the column headers",R.textContent="Row 1 is selected by default. Click any other row to use it as the header.",P.textContent="Row 1 is selected by default"):($.classList.remove("iw-active"),z.classList.add("iw-active"),N.textContent="Step 1 — Mark section header rows",R.textContent="Click any data row to toggle it as a section header (purple). Section rows are emitted with isSectionHeader = true.",P.textContent=`${f.size} row${f.size===1?"":"s"} marked`),I()}function Y(){const t=p[l];return t?t.map(n=>String(n??"").trim()):[]}function W(){const t=Y();u=le(t,i.fields);let n="";for(let e=0;e<t.length;e++){const o=t[e],s=!o,c=u[e]?.mappedFieldId??"",a=`iw-map-${e}`;let d='<option value="">— Skip —</option>';for(const m of i.fields){const E=m.id===c;d+=`<option value="${g(m.id)}"${E?" selected":""}>${m.required?"★ ":""}${g(m.label)}</option>`}n+=`
        <div class="iw-mapping-card">
          <span class="iw-mapping-card-label">Column ${e+1}</span>
          <span class="iw-mapping-card-header ${s?"iw-empty":""}" title="${g(o)}">${s?"[empty header]":`"${g(o)}"`}</span>
          <select id="${a}" data-colidx="${e}">
            ${d}
          </select>
        </div>
      `}if(i.fields.some(e=>e.enableCustomType))for(const e of i.fields){if(!e.enableCustomType)continue;const o=b.get(e.id)??{fieldType:"Yes/No",options:""},s=`iw-custom-type-${D(e.id)}`,c=`iw-custom-opts-${D(e.id)}`;n+=`
          <div class="iw-mapping-card">
            <span class="iw-mapping-card-label">${g(e.label)}</span>
            <span class="iw-mapping-card-header">Response Type &amp; Options</span>
            <div class="iw-custom-type">
              <span class="iw-custom-type-label">Type</span>
              <select id="${s}" data-field-id="${g(e.id)}">
                <option value="Yes/No"${o.fieldType==="Yes/No"?" selected":""}>Yes/No</option>
                <option value="Dropdown"${o.fieldType==="Dropdown"?" selected":""}>Dropdown</option>
                <option value="Text"${o.fieldType==="Text"?" selected":""}>Text</option>
                <option value="Number"${o.fieldType==="Number"?" selected":""}>Number</option>
                <option value="Pass/Fail"${o.fieldType==="Pass/Fail"?" selected":""}>Pass/Fail</option>
              </select>
              <span class="iw-custom-type-label">Options</span>
              <input type="text" id="${c}" data-field-id="${g(e.id)}" placeholder="e.g. Pass, Fail, Pending" value="${g(o.options)}" />
            </div>
          </div>
        `}k.innerHTML=n;for(let e=0;e<t.length;e++){const o=k.querySelector(`#iw-map-${e}`);o&&o.addEventListener("change",()=>{u[e].mappedFieldId=o.value||null,C()})}for(const e of i.fields){if(!e.enableCustomType)continue;const o=D(e.id),s=k.querySelector(`#iw-custom-type-${o}`),c=k.querySelector(`#iw-custom-opts-${o}`);s&&s.addEventListener("change",()=>{const a=b.get(e.id)??{fieldType:"Yes/No",options:""};a.fieldType=s.value,b.set(e.id,a)}),c&&c.addEventListener("input",()=>{const a=b.get(e.id)??{fieldType:s?.value??"Yes/No",options:""};a.options=c.value,b.set(e.id,a)})}}function D(t){return t.replace(/[^a-zA-Z0-9_-]/g,"_")}function C(){if(u.length===0){x.disabled=!0;return}const t=new Set(u.map(e=>e.mappedFieldId).filter(e=>typeof e=="string"&&e.length>0)),n=i.fields.filter(e=>e.required&&!t.has(e.id)).map(e=>e.label);x.disabled=n.length>0,n.length>0?x.title="Map required fields first: "+n.join(", "):x.title=""}function K(){Y();const t={};for(const e of u)e.mappedFieldId&&(t[e.mappedFieldId]=e.colIdx);const n=[];for(let e=l+1;e<p.length;e++){const o=p[e]??[];if(o.length===0||o.length===1&&(o[0]===""||o[0]===null||o[0]===void 0))continue;const s={};let c=!1;for(const a of i.fields){const d=t[a.id];if(d===void 0){s[a.id]="";continue}const m=o[d],E=m==null?"":String(m).trim();s[a.id]=E,E.length>0&&(c=!0)}for(const a of i.fields){if(!a.enableCustomType)continue;const d=b.get(a.id);s["Field Type"]=d?.fieldType??"Yes/No",s.Options=d?.options??""}if(f.has(e)){s.isSectionHeader=!0;const a=s["Safety Question"]??s.Category??"";String(a).trim().length>0&&(c=!0)}c&&n.push(s)}return n}async function ee(){j();const t=K();if(t.length===0){y("No rows with values were found below the header row.");return}X(!0,`Importing ${t.length} record${t.length===1?"":"s"}…`);try{await i.onComplete(t),F()}catch(n){const e=n instanceof Error?n.message:"Import failed.";X(!1),y(e)}}L.addEventListener("click",F),T.addEventListener("click",F),r.addEventListener("click",t=>{t.target===r&&F()}),x.addEventListener("click",()=>{ee()}),$.addEventListener("click",()=>q("HEADER")),z.addEventListener("click",()=>q("SECTION")),v.addEventListener("click",()=>A.click()),v.addEventListener("dragover",t=>{t.preventDefault(),v.classList.add("iw-dragover")}),v.addEventListener("dragleave",()=>{v.classList.remove("iw-dragover")}),v.addEventListener("drop",t=>{t.preventDefault(),v.classList.remove("iw-dragover");const n=t.dataTransfer?.files?.[0];n&&O(n)}),A.addEventListener("change",()=>{const t=A.files?.[0];t&&O(t)})}export{se as o};
