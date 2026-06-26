/* ==========================================
   Safety Hub Portal - Shared Layout Component
   ========================================== */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Check if Spreadsheet ID is supplied in the URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const sheetIdFromUrl = urlParams.get("spreadsheetId");
    if (sheetIdFromUrl) {
        localStorage.setItem("safety_hub_spreadsheet_id", sheetIdFromUrl);
    }

    // 2. Load cached connection and branding settings
    let spreadsheetId = localStorage.getItem("safety_hub_spreadsheet_id") || "";
    let logoUrl = localStorage.getItem("safety_hub_logo_url") || "";
    let systemName = localStorage.getItem("safety_hub_system_name") || "AmerisPro";

    const path = window.location.pathname.toLowerCase();
    const isHub = path.endsWith("index.html") || path === "/" || path.endsWith("/");
    const isPublicForm = path.endsWith("contractor_self.html");
    const inIframe = (window.self !== window.top);

    if (inIframe) {
        document.body.classList.add("in-iframe");
    }

    // 3. Render connection overlay screen if Spreadsheet ID is missing and we are not in iframe
    if (!spreadsheetId && !isPublicForm && !inIframe) {
        showConnectionSetupOverlay();
        return;
    }

    const originalTitle = document.title;

    // Helper function to update the DOM elements with branding
    const applyBranding = (name, logo) => {
        // Update document title if it contains default branding
        if (originalTitle.includes("Safety Hub") || originalTitle.includes("AmerisPro")) {
            document.title = originalTitle.replace(/Safety Hub/g, name).replace(/AmerisPro/g, name);
        } else if (document.title.includes(systemName)) {
            document.title = document.title.replace(new RegExp(systemName, 'g'), name);
        }

        // Helper to generate the logo HTML (custom image or generic SVG badge)
        const getLogoHTML = () => {
            if (logo) {
                return `<img src="${logo}" alt="${name} Logo" style="height: 45px; object-fit: contain;">`;
            }
            return `
                <div style="display: inline-flex; align-items: center; gap: 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="background: #eff6ff; padding: 6px; border-radius: 8px;">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                    <span style="font-weight: 800; font-size: 1.25rem; color: #1e3a8a; letter-spacing: -0.5px;">${name}</span>
                </div>
            `;
        };

        if (isHub) {
            const titleEl = document.querySelector(".page-title h1");
            if (titleEl) {
                titleEl.innerHTML = `${name} Portal`;
            }
            const subtitleEl = document.querySelector(".page-title p");
            if (subtitleEl) {
                subtitleEl.textContent = `Centralized hub for all ISO 45001 digital safety workflows`;
            }
            const hubHeader = document.querySelector(".header-bar");
            if (hubHeader) {
                hubHeader.innerHTML = getLogoHTML();
            }

            // Update hub sidebar brand with custom logo if available
            const sidebarBrandIcon = document.getElementById("sidebar-brand-icon");
            if (sidebarBrandIcon) {
                if (logo) {
                    sidebarBrandIcon.outerHTML = `<img id="sidebar-brand-icon" src="${logo}" alt="${name} Logo" style="height: 32px; object-fit: contain;">`;
                } else {
                    // keep default SVG; it already exists
                }
            }

            // Inject clear connection option in footer
            let adminFooter = document.querySelector(".admin-footer");
            if (adminFooter && !document.getElementById("btn-disconnect")) {
                const discBtn = document.createElement("div");
                discBtn.style.marginTop = "15px";
                discBtn.innerHTML = `
                    <a href="#" id="btn-disconnect" style="font-size:0.75rem; color:var(--text-muted); text-decoration:underline;">
                        ⚙️ Disconnect Current Sheet
                    </a>
                `;
                adminFooter.appendChild(discBtn);
                document.getElementById("btn-disconnect").addEventListener("click", (e) => {
                    e.preventDefault();
                    if (confirm("Are you sure you want to disconnect this portal from the current Google Sheet?")) {
                        localStorage.clear();
                        location.reload();
                    }
                });
            }
        } else {
            // On sub-pages, inject or update the shared header bar only if NOT in iframe
            if (!inIframe) {
                let header = document.querySelector(".header-bar-shared");
                if (!header) {
                    header = document.createElement("div");
                    header.className = "header-bar-shared";
                    document.body.prepend(header);
                }
                header.innerHTML = `
                    <a href="index.html" title="Back to Central Hub" style="text-decoration: none;">
                        ${getLogoHTML()}
                    </a>
                `;
            }
        }
    };

    // Apply branding immediately from cache
    applyBranding(systemName, logoUrl);

    // 4. Fetch latest branding settings from central backend in background
    if (typeof GOOGLE_SCRIPT_URL !== "undefined" && GOOGLE_SCRIPT_URL && !GOOGLE_SCRIPT_URL.includes("YOUR_WEB_APP_URL") && spreadsheetId) {
        fetch(`${GOOGLE_SCRIPT_URL}?action=getBranding&spreadsheetId=${spreadsheetId}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === "SUCCESS") {
                    const newName = data.systemName || "AmerisPro";
                    const newLogo = data.logoUrl || "";
                    const newDepts = data.departments || "";
                    const newPpe = data.ppeTypes || "";
                    const newDecl = data.contractorDeclaration || "";

                    if (newDepts) localStorage.setItem("safety_hub_departments", newDepts);
                    if (newPpe) localStorage.setItem("safety_hub_ppe_types", newPpe);
                    if (newDecl) localStorage.setItem("safety_hub_contractor_declaration", newDecl);
                    if (data.planType) localStorage.setItem("safety_hub_plan_type", data.planType);

                    // If backend branding changed, update cache and refresh UI
                    if (newName !== systemName || newLogo !== logoUrl) {
                        localStorage.setItem("safety_hub_logo_url", newLogo);
                        localStorage.setItem("safety_hub_system_name", newName);
                        systemName = newName;
                        logoUrl = newLogo;
                        applyBranding(newName, newLogo);
                    }
                }
            })
            .catch(err => console.error("Error syncing branding:", err));
    }
});

// Helper to inject a beautiful setup screen modal
function showConnectionSetupOverlay() {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.background = "rgba(15, 23, 42, 0.4)";
    overlay.style.backdropFilter = "blur(12px)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "10000";
    overlay.style.padding = "20px";

    overlay.innerHTML = `
        <div style="background: white; padding: 35px 30px; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; width: 100%; max-width: 460px; text-align: center; font-family: 'Inter', sans-serif;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 16px; background: #eff6ff; margin-bottom: 20px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            </div>
            <h2 style="font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0 0 10px 0; border: none; padding: 0;">🛡️ Connect AmerisPro</h2>
            <p style="font-size: 0.9rem; color: #64748b; line-height: 1.5; margin: 0 0 20px 0;">Enter your master Google Spreadsheet ID below to connect this portal dashboard to your secure cloud database.</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; font-size: 0.82rem; color: #475569; text-align: left; margin-bottom: 20px; line-height: 1.45;">
                <strong>About AmerisPro:</strong> This application serves as a digital Occupational Safety and Health (OSH) management dashboard. It reads and writes safety inspections, PPE checks, and contractor induction records directly to the spreadsheets inside the user's account. No data is stored externally.
            </div>
            
            <div style="text-align: left; margin-bottom: 20px;">
                <label style="font-weight: 600; font-size: 0.8rem; text-transform: uppercase; color: #475569; display: block; margin-bottom: 6px;">Google Spreadsheet ID</label>
                <input type="text" id="setup-sheet-id" placeholder="e.g. 1aBcDeFgH12345..." style="width: 100%; padding: 12px 16px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; font-family: inherit;">
                <small style="color: #94a3b8; font-size: 0.75rem; display: block; margin-top: 8px; line-height: 1.4;">
                    You can copy this ID from the URL bar of your spreadsheet. It is the long code between <code>/d/</code> and <code>/edit</code>.
                </small>
            </div>
            
            <button id="btn-save-connection" style="width: 100%; padding: 14px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                Save Connection
            </button>
            
            <div style="margin-top: 20px; text-align: center; font-size: 0.75rem; color: #64748b; line-height: 1.5; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                <div>© 2026 AmerisPro</div>
                <div style="margin-top: 6px; display: flex; justify-content: center; gap: 10px;">
                    <a href="privacy.html" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: none; border-bottom: 1px dotted #2563eb;">Privacy Policy</a>
                    <span style="color: #cbd5e1;">•</span>
                    <a href="terms.html" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: none; border-bottom: 1px dotted #2563eb;">Terms of Service</a>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("btn-save-connection").addEventListener("click", async () => {
        const inputVal = document.getElementById("setup-sheet-id").value.trim();
        if (!inputVal) {
            alert("❌ Please enter your Spreadsheet ID to proceed.");
            return;
        }

        const btn = document.getElementById("btn-save-connection");
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = "⏳ Connecting & Verifying...";

        try {
            if (typeof GOOGLE_SCRIPT_URL === "undefined" || !GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("YOUR_WEB_APP_URL")) {
                throw new Error("Google Apps Script URL is not configured in config.js.");
            }

            const response = await fetch(`${GOOGLE_SCRIPT_URL}?action=getBranding&spreadsheetId=${inputVal}`);
            const data = await response.json();

            if (data.status === "ERROR") {
                throw new Error(data.message || "Failed to verify connection.");
            }

            // Connection successful! Save setup details and reload
            localStorage.setItem("safety_hub_spreadsheet_id", inputVal);
            if (data.systemName) localStorage.setItem("safety_hub_system_name", data.systemName);
            if (data.logoUrl) localStorage.setItem("safety_hub_logo_url", data.logoUrl);
            if (data.departments) localStorage.setItem("safety_hub_departments", data.departments);
            if (data.ppeTypes) localStorage.setItem("safety_hub_ppe_types", data.ppeTypes);
            if (data.contractorDeclaration) localStorage.setItem("safety_hub_contractor_declaration", data.contractorDeclaration);
            if (data.planType) localStorage.setItem("safety_hub_plan_type", data.planType);
            location.reload();
        } catch (err) {
            alert(`❌ Connection Failed:\n\n${err.message}\n\nPlease check the Spreadsheet ID and ensure your Google Apps Script has access to it.`);
            btn.disabled = false;
            btn.innerText = originalText;
        }
    });
}

// Global System Configuration Accessors
window.getSystemDepartments = function() {
    const cached = localStorage.getItem("safety_hub_departments");
    if (cached) return cached.split(",").map(d => d.trim());
    return ["Production", "Maintenance", "QA/QC", "Warehouse", "Safety/HR", "Engineering", "Electrical", "Security", "Recycle", "DIP", "Wire Drawing", "Logistic", "Finance", "Purchasing", "MFP", "Admin", "Contractor", "Others"];
};

window.getSystemPpeTypes = function() {
    const cached = localStorage.getItem("safety_hub_ppe_types");
    if (cached) return cached.split(",").map(t => t.trim());
    return ["Safety Shoe", "Safety Helmet", "Respirator", "Earmuff", "Filter Cartridge", "Other"];
};

window.getContractorDeclaration = function() {
    return localStorage.getItem("safety_hub_contractor_declaration") || "Agreed: Emergency Evac, PPE Rules, Incident Reporting";
};

// Intercept child iframe links to trigger tab highlight switching on the parent hub
document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a");
    if (anchor) {
        const href = anchor.getAttribute("href");
        const target = anchor.getAttribute("target");
        // Verify it is a local HTML link that is not meant to open in a new window/tab
        if (href && href.endsWith(".html") && !href.startsWith("http") && !href.startsWith("#") && target !== "_blank") {
            // Check if we are running inside an iframe and the parent window has the handler
            if (window.parent && window.parent !== window && typeof window.parent.loadTabFromChild === "function") {
                e.preventDefault();
                window.parent.loadTabFromChild(href);
            }
        }
    }
});

/* ========================================================
   Safety Hub - Reusable Pagination Helper
   ======================================================== */
window.PaginationHelper = class {
    constructor(options) {
        this.data = options.data || [];
        this.rowsPerPage = options.rowsPerPage || 10;
        this.currentPage = 1;
        this.renderCallback = options.renderCallback;
        
        // DOM Elements
        this.elements = {
            controlsContainer: document.getElementById(options.controlsContainerId || "pagination-controls"),
            start: document.getElementById(options.startId || "pag-start"),
            end: document.getElementById(options.endId || "pag-end"),
            total: document.getElementById(options.totalId || "pag-total"),
            display: document.getElementById(options.displayId || "page-num-display"),
            prevBtn: document.getElementById(options.prevBtnId || "btn-prev-page"),
            nextBtn: document.getElementById(options.nextBtnId || "btn-next-page")
        };

        // Bind events if elements exist
        if (this.elements.prevBtn) {
            this.elements.prevBtn.onclick = () => this.prevPage();
        }
        if (this.elements.nextBtn) {
            this.elements.nextBtn.onclick = () => this.nextPage();
        }
    }

    updateData(newData) {
        this.data = newData;
        this.currentPage = 1;
        this.update();
    }

    setPage(page) {
        const totalPages = Math.ceil(this.data.length / this.rowsPerPage) || 1;
        if (page > totalPages) page = totalPages;
        if (page < 1) page = 1;
        this.currentPage = page;
        this.update();
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.update();
        }
    }

    nextPage() {
        const totalPages = Math.ceil(this.data.length / this.rowsPerPage) || 1;
        if (this.currentPage < totalPages) {
            this.currentPage++;
            this.update();
        }
    }

    update() {
        const totalRecords = this.data.length;
        const totalPages = Math.ceil(totalRecords / this.rowsPerPage) || 1;

        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;

        const startIndex = totalRecords === 0 ? 0 : (this.currentPage - 1) * this.rowsPerPage + 1;
        const endIndex = Math.min(this.currentPage * this.rowsPerPage, totalRecords);

        // Update DOM if elements exist
        if (this.elements.start) this.elements.start.innerText = startIndex;
        if (this.elements.end) this.elements.end.innerText = endIndex;
        if (this.elements.total) this.elements.total.innerText = totalRecords;
        if (this.elements.display) this.elements.display.innerText = `Page ${this.currentPage} of ${totalPages}`;

        if (this.elements.prevBtn) {
            this.elements.prevBtn.disabled = (this.currentPage === 1);
            this.elements.prevBtn.style.opacity = (this.currentPage === 1) ? "0.5" : "1";
            this.elements.prevBtn.style.cursor = (this.currentPage === 1) ? "not-allowed" : "pointer";
        }
        if (this.elements.nextBtn) {
            this.elements.nextBtn.disabled = (this.currentPage === totalPages);
            this.elements.nextBtn.style.opacity = (this.currentPage === totalPages) ? "0.5" : "1";
            this.elements.nextBtn.style.cursor = (this.currentPage === totalPages) ? "not-allowed" : "pointer";
        }

        if (this.elements.controlsContainer) {
            this.elements.controlsContainer.style.display = totalRecords > 0 ? "flex" : "none";
        }

        // Trigger callback with current page data slice
        if (typeof this.renderCallback === "function") {
            const startIdx = (this.currentPage - 1) * this.rowsPerPage;
            const endIdx = startIdx + this.rowsPerPage;
            const pageDataSlice = this.data.slice(startIdx, endIdx);
            this.renderCallback(pageDataSlice);
        }
    }
};

// --- CENTRALIZED PREMIUM PLAN HELPERS ---
function isPremiumPlan() {
    const planType = localStorage.getItem("safety_hub_plan_type") || "Free";
    return planType.toLowerCase() === "premium";
}

function showPremiumUpgradeModal(featureName) {
    let modal = document.getElementById("upgrade-modal-shared");
    if (modal) {
        modal.style.display = "flex";
        return;
    }
    
    modal = document.createElement("div");
    modal.id = "upgrade-modal-shared";
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.background = "rgba(15, 23, 42, 0.6)";
    modal.style.backdropFilter = "blur(12px)";
    modal.style.display = "flex";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.zIndex = "1000000";
    modal.style.padding = "20px";
    
    modal.innerHTML = `
        <div style="background: white; padding: 35px 30px; border-radius: 20px; border: 3px solid #000000; box-shadow: 8px 8px 0px #000000; width: 100%; max-width: 440px; text-align: center; font-family: 'Fredoka', sans-serif;">
            <div style="font-size: 3.5rem; margin-bottom: 15px; display: inline-block;">🔒</div>
            <h2 style="font-size: 1.6rem; font-weight: 700; color: #000000; margin: 0 0 10px 0; border: none; padding: 0;">Premium Feature Locked</h2>
            <p style="font-size: 0.9rem; color: #64748b; line-height: 1.5; margin: 0 0 25px 0;">
                <strong>${featureName}</strong> is a premium feature. Please enter your valid license key in the settings sidebar inside your Google Sheet to unlock this console.
            </p>
            <button onclick="document.getElementById('upgrade-modal-shared').style.display='none'" style="width: 100%; padding: 12px; background: #fbbf24; color: #000000; border: 3px solid #000000; border-radius: 10px; font-weight: 700; cursor: pointer; box-shadow: 3px 3px 0px #000000; transition: transform 0.1s;">
                Got It
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

// --- CENTRALIZED EXCEL/CSV IMPORT SYSTEM ---
function openExcelImportWizard(options) {
    if (!options) options = {};
    const title = options.title || "Import Excel/CSV";
    const fields = options.fields || []; // e.g. [{ id: "Staff ID", label: "Staff ID", required: true, autoMatches: [...] }]
    const onComplete = options.onComplete || (() => {});

    // 1. Inject Styles
    if (!document.getElementById("excel-import-wizard-styles")) {
        const style = document.createElement("style");
        style.id = "excel-import-wizard-styles";
        style.innerHTML = `
            .excel-import-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(43, 45, 66, 0.4);
                backdrop-filter: blur(8px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 11000;
                padding: 20px;
                font-family: 'Fredoka', sans-serif;
            }

            .excel-import-modal {
                background: var(--bg);
                border: 3px solid var(--border);
                border-radius: 24px;
                box-shadow: 8px 8px 0px var(--border);
                width: 100%;
                max-width: 1000px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: excelImportSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }

            @keyframes excelImportSlideUp {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            .excel-import-header {
                background: var(--sidebar-bg);
                padding: 16px 24px;
                border-bottom: 3px solid var(--border);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .excel-import-header h3 {
                margin: 0;
                font-family: var(--font-heading);
                font-weight: 700;
                font-size: 1.3rem;
                color: var(--text-main);
            }

            .excel-import-close-btn {
                background: var(--surface);
                border: 2px solid var(--border);
                border-radius: 8px;
                width: 32px;
                height: 32px;
                font-size: 1.2rem;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.1s ease;
                color: var(--text-main);
            }

            .excel-import-close-btn:hover {
                background: var(--primary);
                color: white;
                transform: translate(-1px, -1px);
                box-shadow: 2px 2px 0px var(--border);
            }

            .excel-import-body {
                padding: 24px;
                overflow-y: auto;
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            .excel-import-upload-zone {
                border: 3px dashed var(--border);
                background: var(--surface);
                border-radius: 16px;
                padding: 40px 20px;
                text-align: center;
                cursor: pointer;
                transition: all 0.15s ease;
                box-shadow: var(--shadow-sm);
            }

            .excel-import-upload-zone:hover {
                background: var(--sidebar-bg);
                transform: translate(-2px, -2px);
                box-shadow: 5px 5px 0px var(--border);
            }

            .excel-import-upload-zone.dragover {
                background: var(--sidebar-bg);
                border-color: var(--primary);
            }

            .excel-import-preview-wrapper {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .excel-import-preview-wrapper label {
                font-weight: 700;
                font-size: 0.9rem;
                text-transform: uppercase;
                color: var(--text-main);
            }

            .excel-import-table-container {
                width: 100%;
                overflow-x: auto;
                border: 3px solid var(--border);
                border-radius: 12px;
                box-shadow: var(--shadow-sm);
                background: var(--surface);
                max-height: 250px;
            }

            .excel-import-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.85rem;
                text-align: left;
            }

            .excel-import-table th {
                background: var(--text-main);
                color: white;
                padding: 10px 14px;
                border-bottom: 3px solid var(--border);
                font-weight: 700;
                white-space: nowrap;
            }

            .excel-import-table td {
                padding: 10px 14px;
                border-bottom: 2px solid #e2e8f0;
                white-space: nowrap;
            }

            .excel-import-table tr.selected-header td {
                background: var(--warning) !important;
                font-weight: 700;
                border-top: 2px dashed var(--border);
                border-bottom: 2px dashed var(--border);
            }

            .excel-import-table tr:hover td {
                background: #fffdf5;
                cursor: pointer;
            }

            .excel-import-mapping-wrapper {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .excel-import-mapping-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                gap: 16px;
            }

            .excel-import-mapping-card {
                background: var(--surface);
                border: 3px solid var(--border);
                border-radius: 12px;
                padding: 12px;
                box-shadow: var(--shadow-sm);
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .excel-import-mapping-card span {
                font-size: 0.75rem;
                color: var(--text-muted);
                font-weight: 700;
            }

            .excel-import-mapping-card select {
                padding: 6px 10px;
                border-radius: 8px;
                font-size: 0.8rem;
                font-weight: 600;
                font-family: inherit;
                border: 2px solid var(--border);
                background: var(--surface);
                color: var(--text-main);
                outline: none;
                cursor: pointer;
            }

            .excel-import-footer {
                padding: 16px 24px;
                border-top: 3px solid var(--border);
                background: var(--surface);
                display: flex;
                justify-content: flex-end;
                gap: 12px;
            }

            .excel-import-btn {
                padding: 10px 20px;
                font-family: var(--font-heading);
                font-weight: 700;
                font-size: 0.95rem;
                border: 3px solid var(--border);
                border-radius: 10px;
                cursor: pointer;
                box-shadow: var(--shadow-sm);
                transition: all 0.15s ease;
            }

            .excel-import-btn:hover {
                transform: translate(-2px, -2px);
                box-shadow: 5px 5px 0px var(--border);
            }

            .excel-import-btn:active {
                transform: translate(2px, 2px);
                box-shadow: 0px 0px 0px var(--border);
            }

            .excel-import-btn-cancel {
                background: #e2e8f0;
                color: var(--text-main);
            }

            .excel-import-btn-cancel:hover {
                background: #cbd5e1;
            }

            .excel-import-btn-confirm {
                background: var(--info);
                color: white;
            }

            .excel-import-btn-confirm:hover {
                background: var(--primary);
            }
        `;
        document.head.appendChild(style);
    }

    // 2. State Variables
    let parsedRows = [];
    let selectedHeaderRowIndex = 0;
    let dynamicFieldsMode = fields.length === 0;
    let targetFields = [...fields];

    // 3. Create Overlay Elements
    const overlay = document.createElement("div");
    overlay.className = "excel-import-modal-overlay";
    overlay.id = "excel-import-wizard-overlay";

    overlay.innerHTML = `
        <div class="excel-import-modal">
            <div class="excel-import-header">
                <h3>${escapeHtml(title)}</h3>
                <button class="excel-import-close-btn" id="excel-import-close-x">&times;</button>
            </div>
            <div class="excel-import-body">
                <!-- Step 0: Upload Drop Zone -->
                <div class="excel-import-upload-zone" id="excel-import-drop-zone">
                    <input type="file" id="excel-import-file-input" accept=".csv, .xlsx, .xls" style="display: none;">
                    <div id="excel-import-upload-text" style="font-weight: 700; font-size: 1.1rem; color: var(--text-main);">📥 Click or Drag & Drop Excel/CSV File Here</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">Supports .csv, .xlsx, .xls formats</div>
                </div>

                <!-- Step 1: Select Header Row -->
                <div class="excel-import-preview-wrapper" id="excel-import-step-preview" style="display: none;">
                    <label>👉 Step 1: Click the row that contains the column headers</label>
                    <div class="excel-import-table-container">
                        <table class="excel-import-table">
                            <thead id="excel-import-table-head"></thead>
                            <tbody id="excel-import-table-body"></tbody>
                        </table>
                    </div>
                </div>

                <!-- Step 2: Mapping Fields -->
                <div class="excel-import-mapping-wrapper" id="excel-import-step-mapping" style="display: none;">
                    <label id="excel-import-mapping-instruction">👉 Step 2: Match Excel columns to target system fields</label>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: -6px; margin-bottom: 8px;">Skip columns you do not wish to import.</p>
                    <div class="excel-import-mapping-grid" id="excel-import-mapping-container"></div>
                </div>
            </div>
            <div class="excel-import-footer">
                <button class="excel-import-btn excel-import-btn-cancel" id="excel-import-btn-close">Cancel</button>
                <button class="excel-import-btn excel-import-btn-confirm" id="excel-import-btn-submit" style="display: none;">Confirm & Import</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 4. Hook Event Listeners
    const closeBtnX = document.getElementById("excel-import-close-x");
    const closeBtnLower = document.getElementById("excel-import-btn-close");
    const dropZone = document.getElementById("excel-import-drop-zone");
    const fileInput = document.getElementById("excel-import-file-input");
    const submitBtn = document.getElementById("excel-import-btn-submit");

    const closeModal = () => {
        overlay.remove();
    };

    closeBtnX.addEventListener("click", closeModal);
    closeBtnLower.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
    });

    dropZone.addEventListener("click", () => fileInput.click());

    // Drag-and-drop support
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    });

    // 5. File Processing & Parsing
    async function processFile(file) {
        if (!file) return;
        const fileName = file.name.toLowerCase();
        const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");
        const isCsv = fileName.endsWith(".csv");

        if (!isExcel && !isCsv) {
            alert("❌ Error: Unsupported file format. Please upload a .csv, .xlsx, or .xls file.");
            return;
        }

        document.getElementById("excel-import-upload-text").innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${Math.round(file.size / 1024)} KB)`;

        const reader = new FileReader();
        if (isExcel) {
            try {
                // Ensure SheetJS is loaded dynamically
                await loadSheetJS();
                reader.onload = function(e) {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        parsedRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                        if (parsedRows.length === 0) {
                            alert("⚠️ Error: Uploaded sheet is empty.");
                            return;
                        }
                        selectedHeaderRowIndex = 0;
                        showStep1();
                    } catch (err) {
                        console.error("Excel Read Error:", err);
                        alert("❌ Error reading Excel file: " + err.message);
                    }
                };
                reader.readAsArrayBuffer(file);
            } catch (err) {
                alert("❌ Loading Excel Library Failed: " + err.message);
            }
        } else {
            reader.onload = function(e) {
                parsedRows = parseCSV(e.target.result);
                if (parsedRows.length === 0) {
                    alert("⚠️ Error: Uploaded file is empty.");
                    return;
                }
                selectedHeaderRowIndex = 0;
                showStep1();
            };
            reader.readAsText(file);
        }
    }

    // Dynamic SheetJS script injector helper
    function loadSheetJS() {
        return new Promise((resolve, reject) => {
            if (window.XLSX) {
                resolve();
                return;
            }
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
            script.onload = () => resolve();
            script.onerror = (e) => reject(new Error("Failed to load SheetJS library"));
            document.head.appendChild(script);
        });
    }

    // Step 1 UI Setup
    function showStep1() {
        document.getElementById("excel-import-step-preview").style.display = "flex";
        renderPreview();
    }

    function renderPreview() {
        const tbody = document.getElementById("excel-import-table-body");
        const thead = document.getElementById("excel-import-table-head");
        tbody.innerHTML = "";
        thead.innerHTML = "";

        if (parsedRows.length === 0) return;

        // Generate columns layout preview
        const maxCols = Math.max(...parsedRows.slice(0, 15).map(r => r.length));
        let headerHtml = "<th>Row No</th>";
        for (let j = 0; j < maxCols; j++) {
            headerHtml += `<th>Column ${j + 1}</th>`;
        }
        thead.innerHTML = `<tr>${headerHtml}</tr>`;

        const previewLimit = Math.min(parsedRows.length, 15);
        for (let i = 0; i < previewLimit; i++) {
            const row = parsedRows[i];
            const isSelected = i === selectedHeaderRowIndex;
            const tr = document.createElement("tr");
            tr.className = isSelected ? "selected-header" : "";
            tr.onclick = () => selectHeader(i);

            let rowHtml = `<td style="font-weight: 700; color: var(--text-muted);">Row ${i + 1}</td>`;
            for (let j = 0; j < maxCols; j++) {
                rowHtml += `<td>${escapeHtml(row[j] || "")}</td>`;
            }
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        }

        generateMappingFields();
    }

    function selectHeader(idx) {
        selectedHeaderRowIndex = idx;
        const rows = document.querySelectorAll("#excel-import-table-body tr");
        rows.forEach((r, i) => {
            if (i === idx) r.className = "selected-header";
            else r.className = "";
        });
        generateMappingFields();
    }

    // Step 2 Mapping Setup
    function generateMappingFields() {
        const container = document.getElementById("excel-import-mapping-container");
        container.innerHTML = "";
        const headerRow = parsedRows[selectedHeaderRowIndex];
        if (!headerRow) return;

        if (dynamicFieldsMode) {
            targetFields = headerRow.map((h, colIdx) => {
                const headerText = String(h || "").trim();
                return {
                    id: headerText || `Column_${colIdx + 1}`,
                    label: headerText || `Column ${colIdx + 1}`,
                    required: false,
                    autoMatches: [headerText]
                };
            }).filter(f => f.id !== "");
            
            document.getElementById("excel-import-mapping-instruction").innerText = "👉 Step 2: Choose which columns to import as fields";
        } else {
            targetFields = fields;
        }

        let html = "";
        headerRow.forEach((colHeader, colIdx) => {
            if (colHeader === undefined || colHeader === null) colHeader = "";
            const cleanHeader = String(colHeader).toLowerCase().trim();

            // Auto Matching Selection
            let selectedVal = "SKIP";
            if (dynamicFieldsMode) {
                selectedVal = String(colHeader || "").trim() || `Column_${colIdx + 1}`;
            } else {
                for (let f of targetFields) {
                    if (f.autoMatches && f.autoMatches.some(m => cleanHeader.includes(m.toLowerCase()) || m.toLowerCase().includes(cleanHeader))) {
                        selectedVal = f.id;
                        break;
                    }
                }
            }

            // Create selector dropdown
            let optionsHtml = `<option value="SKIP" ${selectedVal === 'SKIP' ? 'selected' : ''}>❌ [Skip Column]</option>`;
            targetFields.forEach(f => {
                optionsHtml += `<option value="${f.id}" ${selectedVal === f.id ? 'selected' : ''}>${f.required ? '⭐ ' : ''}${f.label}</option>`;
            });

            html += `
                <div class="excel-import-mapping-card">
                    <span>Column ${colIdx + 1}</span>
                    <div style="font-weight:700; font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: var(--text-main);" title="${colHeader || ''}">
                        "${escapeHtml(colHeader || '[Empty Header]')}"
                    </div>
                    <select id="excel-import-map-${colIdx}">
                        ${optionsHtml}
                    </select>
                </div>
            `;
        });

        container.innerHTML = html;
        document.getElementById("excel-import-step-mapping").style.display = "block";
        submitBtn.style.display = "inline-block";
    }

    // Submit Validation and Processing
    submitBtn.onclick = () => {
        const headerRow = parsedRows[selectedHeaderRowIndex];
        if (!headerRow) return;

        // 1. Gather mapped indexes
        const mappedCols = {};
        headerRow.forEach((col, idx) => {
            const val = document.getElementById("excel-import-map-" + idx).value;
            if (val !== "SKIP") {
                mappedCols[val] = idx;
            }
        });

        // 2. Validate required fields
        const missingFields = [];
        targetFields.forEach(f => {
            if (f.required && mappedCols[f.id] === undefined) {
                missingFields.push(f.label);
            }
        });

        if (missingFields.length > 0) {
            alert("⚠️ Missing Required Mappings:\n\nPlease map columns to these required fields:\n" + missingFields.map(m => "- " + m).join("\n"));
            return;
        }

        // 3. Compile data
        const mappedRows = [];
        for (let i = selectedHeaderRowIndex + 1; i < parsedRows.length; i++) {
            const row = parsedRows[i];
            if (!row || row.length === 0 || (row.length === 1 && row[0] === "")) continue;

            const record = {};
            let hasAnyValue = false;
            // Populate fields based on mappings
            targetFields.forEach(f => {
                const colIdx = mappedCols[f.id];
                if (colIdx !== undefined) {
                    const cellVal = String(row[colIdx] || "").trim();
                    record[f.id] = cellVal;
                    if (cellVal !== "") hasAnyValue = true;
                } else {
                    record[f.id] = "";
                }
            });

            // Ensure we have at least one non-empty value in target fields before saving row
            const hasRequiredData = targetFields.filter(f => f.required).every(f => record[f.id] !== "");
            if (hasAnyValue && hasRequiredData) {
                mappedRows.push(record);
            }
        }

        if (mappedRows.length === 0) {
            alert("⚠️ Error: No valid rows found below the header row containing values.");
            return;
        }

        // 4. Return results and close
        onComplete(mappedRows);
        closeModal();
    };

    // Helper functions inside the closure
    function parseCSV(text) {
        let lines = [];
        let row = [""];
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            let c = text[i];
            let next = text[i+1];
            if (c === '"') {
                if (inQuotes && next === '"') {
                    row[row.length - 1] += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c === ',' && !inQuotes) {
                row.push("");
            } else if ((c === '\r' || c === '\n') && !inQuotes) {
                if (c === '\r' && next === '\n') { i++; }
                lines.push(row);
                row = [""];
            } else {
                row[row.length - 1] += c;
            }
        }
        if (row.length > 1 || row[0] !== "") {
            lines.push(row);
        }
        return lines;
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
