/**
 * Shared UI helpers and skeleton loader generators for the AmerisPro app.
 */

/**
 * Generates HTML for shimmering wireframe skeleton card placeholders.
 * Used during data fetching and processing states.
 */
export function renderSkeletonCards(count = 3): string {
  let html = '<div style="display: flex; flex-direction: column; gap: 16px;">';
  for (let i = 0; i < count; i++) {
    html += `
      <div style="border: 3px solid var(--border, #2B2D42); border-radius: 14px; background: white; padding: 20px; box-shadow: 3px 3px 0 var(--shadow, #2B2D42); position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div class="cmp-skeleton-shimmer" style="height: 22px; width: 55%; border-radius: 6px;"></div>
          <div class="cmp-skeleton-shimmer" style="height: 26px; width: 90px; border-radius: 20px;"></div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="cmp-skeleton-shimmer" style="height: 14px; width: 95%; border-radius: 4px;"></div>
          <div class="cmp-skeleton-shimmer" style="height: 14px; width: 80%; border-radius: 4px;"></div>
          <div class="cmp-skeleton-shimmer" style="height: 14px; width: 65%; border-radius: 4px;"></div>
        </div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}
