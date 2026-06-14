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
    let systemName = localStorage.getItem("safety_hub_system_name") || "Safety Hub";

    const path = window.location.pathname.toLowerCase();
    const isHub = path.endsWith("index.html") || path === "/" || path.endsWith("/");
    const isPublicForm = path.endsWith("contractor_self.html") || path.endsWith("contractor_handbook.html");
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
        if (originalTitle.includes("Safety Hub")) {
            document.title = originalTitle.replace(/Safety Hub/g, name);
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
    if (typeof GOOGLE_SCRIPT_URL !== "undefined" && GOOGLE_SCRIPT_URL && !GOOGLE_SCRIPT_URL.includes("YOUR_WEB_APP_URL")) {
        fetch(`${GOOGLE_SCRIPT_URL}?action=getBranding&spreadsheetId=${spreadsheetId}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === "SUCCESS") {
                    const newName = data.systemName || "Safety Hub";
                    const newLogo = data.logoUrl || "";
                    
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
            <h2 style="font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0 0 10px 0; border: none; padding: 0;">🛡️ Connect Safety Hub</h2>
            <p style="font-size: 0.9rem; color: #64748b; line-height: 1.5; margin: 0 0 25px 0;">Enter your master Google Spreadsheet ID below to connect this portal dashboard to your secure cloud database.</p>
            
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
            location.reload();
        } catch (err) {
            alert(`❌ Connection Failed:\n\n${err.message}\n\nPlease check the Spreadsheet ID and ensure your Google Apps Script has access to it.`);
            btn.disabled = false;
            btn.innerText = originalText;
        }
    });
}
