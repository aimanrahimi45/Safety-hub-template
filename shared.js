/* ==========================================
   Metrod Safety Hub - Shared Layout Component
   ========================================== */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Detect if this is the central index.html hub page
    const path = window.location.pathname.toLowerCase();
    const isHub = path.endsWith("index.html") || path === "/" || path.endsWith("/");

    // 2. Inject global Metrod header bar dynamically on sub-pages
    if (!isHub && !document.querySelector(".header-bar") && !document.querySelector(".header-bar-shared")) {
        const header = document.createElement("div");
        header.className = "header-bar-shared";
        header.innerHTML = `
            <a href="index.html" title="Back to Central Hub">
                <img src="logo-metrod.webp" alt="Metrod Logo">
            </a>
        `;
        document.body.prepend(header);
    }
});
