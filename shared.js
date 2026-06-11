/* ==========================================
   Safety Hub Portal - Shared Layout Component
   ========================================== */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Get cached branding settings from localStorage
    let logoUrl = localStorage.getItem("safety_hub_logo_url") || "";
    let systemName = localStorage.getItem("safety_hub_system_name") || "Safety Hub";

    // Keep track of the original page title prefix to allow clean dynamic updates
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

        // Detect if this is the central index.html hub page
        const path = window.location.pathname.toLowerCase();
        const isHub = path.endsWith("index.html") || path === "/" || path.endsWith("/");

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
        } else {
            // On sub-pages, inject or update the shared header bar
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
    };

    // Apply branding immediately from cache
    applyBranding(systemName, logoUrl);

    // 2. Fetch latest branding settings from central backend in background
    if (typeof GOOGLE_SCRIPT_URL !== "undefined" && GOOGLE_SCRIPT_URL && !GOOGLE_SCRIPT_URL.includes("YOUR_WEB_APP_URL")) {
        fetch(`${GOOGLE_SCRIPT_URL}?action=getBranding`)
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



