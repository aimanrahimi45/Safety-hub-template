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
      <div style="border: 3px solid var(--border, #2B2D42); border-radius: 14px; background: white; padding: 20px; box-shadow: 3px 3px 0 var(--shadow, #2B2D42); position: relative;" class="skel-card">
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

/**
 * Generates HTML for shimmering table row skeletons with realistic column widths.
 */
export function renderSkeletonTableRows(rows = 4, cols = 7): string {
  let html = '';
  const widths = [40, 75, 60, 45, 80, 55, 35, 70];
  for (let r = 0; r < rows; r++) {
    html += `<tr class="skel-row" style="animation-delay: ${r * 0.12}s !important;">`;
    for (let c = 0; c < cols; c++) {
      const w = widths[(r + c) % widths.length];
      html += `
        <td style="padding: 14px 12px;">
          <div class="cmp-skeleton-shimmer" style="height: 16px; width: ${w}%; border-radius: 4px;"></div>
        </td>
      `;
    }
    html += '</tr>';
  }
  return html;
}
